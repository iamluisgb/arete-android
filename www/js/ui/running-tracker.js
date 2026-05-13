/**
 * GPS Running Tracker Engine
 * Handles live GPS tracking with distance, pace, splits, and route recording.
 * Runs in background by default (screen can sleep). Wake Lock is opt-in via
 * toggleWakeLock() to keep the screen on when the user wants it.
 */

const isCapacitor = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

// ── Haversine distance (meters) ─────────────────────────
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Tracker ─────────────────────────────────────────────

export class GpsTracker {
  constructor() {
    this.state = 'idle'; // idle | tracking | paused
    this._watchId = null;
    this._startTime = 0;
    this._pauseStart = 0;
    this._totalPaused = 0;
    this._timerRaf = null;
    this._timerInterval = null;
    this._lastGpsTime = 0;         // timestamp of last GPS callback
    this._areteLocation = null;    // Capacitor native plugin reference
    this._areteLocationListener = null;
    this._bgActive = false;        // is the native foreground service running?
    this._wakeLock = null;
    this._wakeLockEnabled = false; // opt-in: user toggles this
    this._visibilityHandler = null;
    this._swMessageHandler = null;
    this._runStartWallTime = 0; // Date.now() at start, for SW notification

    // Auto-pause
    this._autoPauseEnabled = true;
    this._autoPaused = false;
    this._autoPauseStart = 0;       // performance.now() when auto-paused
    this._totalAutoPaused = 0;      // ms accumulated in auto-pause
    this._stillSince = 0;           // timestamp when speed first dropped below threshold
    this._onAutoPause = null;

    // Accumulated data
    this.elapsed = 0;      // seconds (excluding pauses)
    this.distance = 0;     // km
    this.currentPace = 0;  // sec/km (rolling avg)
    this.avgPace = 0;      // sec/km (global)
    this.splits = [];      // { km, time, pace, elevation }
    this.coords = [];      // [[lat, lng, alt, timestamp], ...]

    // Internal
    this._lastPos = null;
    this._lastSplitDist = 0;
    this._lastSplitTime = 0;
    this._recentPoints = []; // for instantaneous pace calc

    // Callbacks
    this._onUpdate = null;
    this._onSplit = null;
    this._onError = null;
    this._onGapDetected = null;
    this.gapSeconds = 0;
  }

  onUpdate(cb)       { this._onUpdate = cb; }
  onSplit(cb)        { this._onSplit = cb; }
  onError(cb)        { this._onError = cb; }
  onAutoPause(cb)    { this._onAutoPause = cb; }
  onGapDetected(cb)  { this._onGapDetected = cb; }

  get autoPauseEnabled() { return this._autoPauseEnabled; }
  get isAutoPaused() { return this._autoPaused; }

  toggleAutoPause() {
    this._autoPauseEnabled = !this._autoPauseEnabled;
    // If disabling while auto-paused, resume immediately
    if (!this._autoPauseEnabled && this._autoPaused) {
      this._autoResume();
    }
    return this._autoPauseEnabled;
  }

  // ── Start tracking ──────────────────────────────────────

  start() {
    if (this.state === 'tracking') return;

    if (!navigator.geolocation) {
      this._onError?.('GPS no disponible en este dispositivo');
      return false;
    }

    this.state = 'tracking';
    this._startTime = performance.now();
    this._totalPaused = 0;
    this._autoPaused = false;
    this._autoPauseStart = 0;
    this._totalAutoPaused = 0;
    this._stillSince = 0;
    this.elapsed = 0;
    this.distance = 0;
    this.currentPace = 0;
    this.avgPace = 0;
    this.gapSeconds = 0;
    this.splits = [];
    this.coords = [];
    this._lastPos = null;
    this._lastSplitDist = 0;
    this._lastSplitTime = 0;
    this._recentPoints = [];

    this._runStartWallTime = Date.now();
    this._startGps();
    // Start the native foreground service NOW while the app is in foreground.
    // Android 14+ blocks `foregroundServiceType=location` from being launched
    // once the app is backgrounded — even with permission granted. Starting it
    // here keeps it alive across screen-off / Doze.
    this._startGpsBackground();
    this._startTimer();
    this._bindVisibility();
    this._bindSwMessages();
    // Auto-enable wake lock on start (user can toggle off)
    this._wakeLockEnabled = true;
    this._acquireWakeLock();
    return true;
  }

  // ── Pause / Resume ──────────────────────────────────────

  pause() {
    if (this.state !== 'tracking') return;
    // Settle any active auto-pause into the total
    if (this._autoPaused) {
      this._totalAutoPaused += performance.now() - this._autoPauseStart;
      this._autoPaused = false;
      this._autoPauseStart = 0;
    }
    this.state = 'paused';
    this._pauseStart = performance.now();
    this._stopGps();
    this._stopGpsBackground();
    this._stopTimer();
    this._swPost({ type: 'run-clear' });
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'tracking';
    this._totalPaused += performance.now() - this._pauseStart;
    this._startGps();
    // Re-arm the native FGS. If we're in background when resume is triggered,
    // this would normally fail on Android 14+, but Capacitor briefly grants
    // the activity-visibility grace period when the user taps the resume
    // button, so it's safe here.
    this._startGpsBackground();
    this._startTimer();
    if (document.visibilityState === 'hidden') {
      this._swPost({ type: 'run-start-live', startedAt: this._runStartWallTime, distance: this.distance * 1000 });
      this._stopGps();
    }
  }

  // ── Stop tracking ───────────────────────────────────────

  stop() {
    if (this.state === 'idle') return null;

    if (this.state === 'paused') {
      this._totalPaused += performance.now() - this._pauseStart;
    }

    this._stopGps();
    this._stopGpsBackground();
    this._stopTimer();
    this._releaseWakeLock();
    this._unbindVisibility();
    this._unbindSwMessages();
    this._swPost({ type: 'run-clear' });
    this._wakeLockEnabled = false;
    this._updateElapsed();
    this.state = 'idle';

    return this.getResult();
  }

  // ── Get result object ───────────────────────────────────

  getResult() {
    return {
      distance: Math.round(this.distance * 1000) / 1000,
      duration: Math.round(this.elapsed),
      pace: this.distance > 0 ? Math.round(this.elapsed / this.distance) : 0,
      avgSpeed: this.elapsed > 0 ? Math.round((this.distance / (this.elapsed / 3600)) * 10) / 10 : 0,
      splits: [...this.splits],
      route: {
        coords: this.coords.map(c => [
          Math.round(c[0] * 1e6) / 1e6,
          Math.round(c[1] * 1e6) / 1e6,
          Math.round((c[2] || 0) * 10) / 10,
          c[3]
        ])
      },
      elevation: this._calcTotalElevation(),
      source: 'gps'
    };
  }

  // ── Serialize / Restore (survive page reload) ───────────

  serialize() {
    return {
      state: this.state,
      startedAt: this._startTime,
      totalPaused: this._totalPaused,
      pauseStart: this._pauseStart,
      elapsed: this.elapsed,
      distance: this.distance,
      currentPace: this.currentPace,
      avgPace: this.avgPace,
      splits: this.splits,
      coords: this.coords,
      lastPos: this._lastPos,
      lastSplitDist: this._lastSplitDist,
      lastSplitTime: this._lastSplitTime,
      recentPoints: this._recentPoints,
      wakeLockEnabled: this._wakeLockEnabled,
      autoPauseEnabled: this._autoPauseEnabled,
      totalAutoPaused: this._totalAutoPaused + (this._autoPaused ? performance.now() - this._autoPauseStart : 0),
      // Wall-clock anchor: convert performance.now() to Date.now() for cross-reload
      wallClockAnchor: Date.now(),
      perfNowAnchor: performance.now(),
    };
  }

  restore(snap) {
    if (!snap || !snap.state || snap.state === 'idle') return false;

    // Reconstruct performance.now()-based times using wall-clock delta
    const wallDelta = Date.now() - snap.wallClockAnchor; // ms since snapshot
    const perfOffset = performance.now() - (snap.perfNowAnchor + wallDelta);

    this.state = snap.state;
    this._startTime = snap.startedAt + perfOffset;
    this._totalPaused = snap.totalPaused;
    this._pauseStart = snap.pauseStart ? snap.pauseStart + perfOffset : 0;
    this.elapsed = snap.elapsed;
    this.distance = snap.distance;
    this.currentPace = snap.currentPace;
    this.avgPace = snap.avgPace;
    this.splits = snap.splits || [];
    this.coords = snap.coords || [];
    this._lastPos = snap.lastPos;
    this._lastSplitDist = snap.lastSplitDist;
    this._lastSplitTime = snap.lastSplitTime;
    this._recentPoints = snap.recentPoints || [];
    this._wakeLockEnabled = snap.wakeLockEnabled ?? true;
    this._autoPauseEnabled = snap.autoPauseEnabled ?? true;
    this._totalAutoPaused = snap.totalAutoPaused || 0;
    this._autoPaused = false;
    this._autoPauseStart = 0;
    this._stillSince = 0;

    // If was tracking, resume GPS + timer
    if (this.state === 'tracking') {
      this._updateElapsed();
      // Try to recover any GPS points the native service buffered while we were dead
      this.resyncFromService().catch(() => {});
      this._startGps();
      this._startGpsBackground();
      this._startTimer();
      this._bindVisibility();
      this._bindSwMessages();
      if (this._wakeLockEnabled) this._acquireWakeLock();
    } else if (this.state === 'paused') {
      // Paused: just recalc elapsed, don't start GPS
      this._updateElapsed();
      this._bindVisibility();
    }

    return true;
  }

  // ── Wake Lock (opt-in: keeps screen on) ─────────────────
  // Called by the UI when user taps the lock/unlock button.
  // Returns the new state (true = screen stays on, false = screen can sleep).

  async toggleWakeLock() {
    this._wakeLockEnabled = !this._wakeLockEnabled;
    if (this._wakeLockEnabled) {
      await this._acquireWakeLock();
    } else {
      this._releaseWakeLock();
    }
    return this._wakeLockEnabled;
  }

  get wakeLockActive() {
    return this._wakeLockEnabled && this._wakeLock !== null;
  }

  async _acquireWakeLock() {
    if (isCapacitor) {
      const App = window.Capacitor?.Plugins?.App;
      if (App) {
        try { await App.keepAwake(); } catch (e) {}
      }
    } else if (!('wakeLock' in navigator)) {
      return;
    } else {
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => {
          this._wakeLock = null;
        });
      } catch (e) {
        console.warn('Wake Lock failed:', e.message);
      }
    }
  }

  _releaseWakeLock() {
    if (isCapacitor) {
      const App = window.Capacitor?.Plugins?.App;
      if (App) App.resumeForeground?.().catch(() => {});
    } else if (this._wakeLock) {
      this._wakeLock.release();
      this._wakeLock = null;
    }
  }

  // ── Visibility handling (restart GPS on foreground) ──────

  _swPost(msg) {
    if (navigator.serviceWorker?.controller) navigator.serviceWorker.controller.postMessage(msg);
  }

  _bindVisibility() {
    this._visibilityHandler = () => {
      if (this.state !== 'tracking') return;
      if (document.visibilityState === 'hidden') {
        // Native FGS keeps running; just stop the WebView watcher to avoid
        // duplicate points and let the service feed us via locationUpdate events.
        this._swPost({ type: 'run-start-live', startedAt: this._runStartWallTime, distance: this.distance * 1000 });
        if (isCapacitor) this._stopGps();
      } else {
        // Back to foreground: drain anything the service buffered while we
        // were suspended, then resume the lighter WebView watcher.
        if (isCapacitor) {
          this.resyncFromService().catch(() => {});
        }
        this._startGps();
        navigator.geolocation.getCurrentPosition(
          pos => this._onPosition(pos),
          () => {},
          { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
        );
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  _unbindVisibility() {
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  // Listen for SW heartbeat pings to request GPS in background
  _bindSwMessages() {
    this._swMessageHandler = (event) => {
      if (event.data?.type === 'run-gps-poll' && this.state === 'tracking') {
        navigator.geolocation.getCurrentPosition(
          pos => {
            this._onPosition(pos);
            this._swPost({ type: 'run-update', distance: this.distance * 1000 });
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 3000, timeout: 5000 }
        );
      }
    };
    navigator.serviceWorker?.addEventListener('message', this._swMessageHandler);
  }

  _unbindSwMessages() {
    if (this._swMessageHandler) {
      navigator.serviceWorker?.removeEventListener('message', this._swMessageHandler);
      this._swMessageHandler = null;
    }
  }

  // ── GPS watcher ─────────────────────────────────────────

  _startGps() {
    this._watchId = navigator.geolocation.watchPosition(
      pos => this._onPosition(pos),
      err => {
        const msgs = {
          1: 'Permiso GPS denegado',
          2: 'GPS no disponible',
          3: 'Timeout GPS'
        };
        this._onError?.(msgs[err.code] || 'Error GPS');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }

  // Native foreground service for background tracking. Uses
  // FusedLocationProviderClient on a partial wake lock, with its own
  // notification — survives Doze and screen-off because it lives outside the
  // WebView. Locations buffered on disk are drained on resume.
  async _startGpsBackground() {
    if (!isCapacitor) return;
    if (this._bgActive) return;
    try {
      // Ensure ACCESS_FINE_LOCATION is granted before starting the FGS.
      // On Android 14+, calling startForeground(...FOREGROUND_SERVICE_TYPE_LOCATION)
      // without runtime location permission throws SecurityException and kills
      // the process. Use Capacitor's Geolocation plugin to request it cleanly.
      const Geolocation = window.Capacitor?.Plugins?.Geolocation;
      if (Geolocation) {
        let perm = await Geolocation.checkPermissions().catch(() => null);
        if (perm && perm.location !== 'granted') {
          perm = await Geolocation.requestPermissions({ permissions: ['location'] })
            .catch(() => null);
        }
        if (!perm || perm.location !== 'granted') {
          // User denied or plugin unavailable — skip the FGS. The foreground
          // navigator.geolocation.watchPosition path will keep working until
          // the screen locks.
          return;
        }
      }
      const plugin = await this._getNativePlugin();
      if (!plugin) return;
      // Drop any leftover buffer from a previous session
      try { await plugin.clearBuffer(); } catch (e) {}
      this._areteLocationListener = await plugin.addListener('locationUpdate', (pos) => {
        this._onPosition({
          coords: {
            latitude: pos.lat,
            longitude: pos.lng,
            accuracy: pos.accuracy,
            speed: pos.speed,
            heading: pos.heading,
            altitude: pos.altitude,
          },
          timestamp: pos.timestamp,
        });
      });
      await plugin.start();
      this._bgActive = true;
    } catch (e) {
      this._onError?.('No se pudo iniciar GPS en segundo plano');
    }
  }

  async _stopGpsBackground() {
    if (!isCapacitor) return;
    if (this._areteLocationListener) {
      try { await this._areteLocationListener.remove(); } catch (e) {}
      this._areteLocationListener = null;
    }
    if (this._bgActive) {
      try {
        const plugin = await this._getNativePlugin();
        if (plugin) await plugin.stop();
      } catch (e) {}
      this._bgActive = false;
    }
  }

  // Drain any GPS points the native service buffered while the WebView was
  // suspended (screen lock for >5min, app killed, etc.). Replays them through
  // _onPosition so distance/splits stay consistent.
  async resyncFromService() {
    if (!isCapacitor) return 0;
    try {
      const plugin = await this._getNativePlugin();
      if (!plugin) return 0;
      const result = await plugin.getBufferedLocations();
      const list = result?.locations || [];
      // Skip points older than the last one we already processed
      const since = this._lastGpsTime || 0;
      let applied = 0;
      for (const pos of list) {
        if (pos.timestamp <= since) continue;
        this._onPosition({
          coords: {
            latitude: pos.lat,
            longitude: pos.lng,
            accuracy: pos.accuracy,
            speed: pos.speed,
            heading: pos.heading,
            altitude: pos.altitude,
          },
          timestamp: pos.timestamp,
        });
        applied++;
      }
      await plugin.clearBuffer();
      return applied;
    } catch (e) {
      return 0;
    }
  }

  _getNativePlugin() {
    if (this._areteLocation) return this._areteLocation;
    const plugin = window.Capacitor?.Plugins?.AreteLocation;
    if (plugin) this._areteLocation = plugin;
    return plugin || null;
  }

  _stopGps() {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
  }

  _onPosition(pos) {
    if (this.state !== 'tracking') return;
    const now = Date.now();
    const prevGpsTime = this._lastGpsTime;
    this._lastGpsTime = now;

    // Detect GPS gaps (> 15s without a fix)
    if (prevGpsTime > 0 && now - prevGpsTime > 15000) {
      const gapSec = (now - prevGpsTime) / 1000;
      this.gapSeconds += gapSec;
      this._onGapDetected?.(gapSec);
    }

    const { latitude: lat, longitude: lng, altitude: alt, accuracy, speed } = pos.coords;
    const ts = pos.timestamp;

    // ── Auto-pause detection ──────────────────────────────
    // Runs BEFORE the accuracy filter because standing still degrades GPS
    // accuracy — readings >30m would otherwise never reach the evaluator
    // and the user would stay "running" forever. Stillness detection only
    // needs coarse lat/lng/speed; precision is for tracking, not pausing.
    // Also tolerates _lastPos === null by falling back to GPS speed alone,
    // so a session that starts with poor accuracy can still auto-pause.
    if (this._autoPauseEnabled) {
      const hasSpeed = speed !== null && speed >= 0;
      let isStill = null;
      if (hasSpeed) {
        isStill = speed < 0.5;   // < 0.5 m/s ≈ 1.8 km/h
      } else if (this._lastPos) {
        const d = haversine(this._lastPos[0], this._lastPos[1], lat, lng);
        isStill = d < 2;          // < 2m movement
      }

      if (isStill === true) {
        if (!this._stillSince) this._stillSince = ts;
        if (!this._autoPaused && ts - this._stillSince > 5000) {
          this._autoPauseAt();
        }
        if (this._autoPaused) {
          this._updateElapsed();
          this._onUpdate?.({
            elapsed: this.elapsed, distance: this.distance,
            currentPace: this.currentPace, avgPace: this.avgPace,
            lat, lng, splits: this.splits, autoPaused: true
          });
          return;
        }
      } else if (isStill === false) {
        this._stillSince = 0;
        if (this._autoPaused) this._autoResume();
      }
      // isStill === null: neither speed nor _lastPos available — skip detection
    }

    // Filter out inaccurate readings (for distance/pace calc only — auto-pause already ran)
    if (accuracy > 30) return;

    const point = [lat, lng, alt || 0, ts];

    // ── Normal tracking ───────────────────────────────────
    this.coords.push(point);

    if (this._lastPos) {
      const d = haversine(this._lastPos[0], this._lastPos[1], lat, lng);

      // Filter GPS drift: ignore jumps > 100m between points
      if (d > 100) {
        this._lastPos = point;
        return;
      }

      // Filter micro-movements (< 1m)
      if (d < 1) return;

      this.distance += d / 1000; // to km
    }

    this._lastPos = point;

    // Track recent points for instantaneous pace (last 15 seconds)
    this._recentPoints.push({ lat, lng, time: ts });
    const cutoff = ts - 15000;
    this._recentPoints = this._recentPoints.filter(p => p.time >= cutoff);
    this._calcCurrentPace();

    // Global avg pace
    this._updateElapsed();
    if (this.distance > 0.01) {
      this.avgPace = this.elapsed / this.distance;
    }

    // Check for split completion
    this._checkSplit();

    this._onUpdate?.({
      elapsed: this.elapsed,
      distance: this.distance,
      currentPace: this.currentPace,
      avgPace: this.avgPace,
      lat, lng,
      splits: this.splits,
      autoPaused: false
    });
  }

  // ── Auto-pause internals ──────────────────────────────

  _autoPauseAt() {
    this._autoPaused = true;
    this._autoPauseStart = performance.now();
    this._onAutoPause?.(true);
  }

  _autoResume() {
    if (!this._autoPaused) return;
    this._totalAutoPaused += performance.now() - this._autoPauseStart;
    this._autoPaused = false;
    this._autoPauseStart = 0;
    this._stillSince = 0;
    this._recentPoints = []; // reset pace window after pause
    this._onAutoPause?.(false);
  }

  // ── Pace calculation ────────────────────────────────────

  _calcCurrentPace() {
    if (this._recentPoints.length < 2) { this.currentPace = 0; return; }

    const first = this._recentPoints[0];
    const last = this._recentPoints[this._recentPoints.length - 1];
    const dt = (last.time - first.time) / 1000; // seconds
    if (dt < 3) { return; } // need at least 3s of data

    const dist = haversine(first.lat, first.lng, last.lat, last.lng) / 1000; // km
    if (dist > 0.001) {
      this.currentPace = dt / dist; // sec/km
    }
  }

  // ── Splits ──────────────────────────────────────────────

  _checkSplit() {
    const nextKm = this.splits.length + 1;
    if (this.distance >= nextKm) {
      this._updateElapsed();
      const splitTime = this.elapsed - this._lastSplitTime;
      const splitPace = splitTime; // 1 km, so pace = time

      const split = {
        km: nextKm,
        time: Math.round(splitTime),
        pace: Math.round(splitPace),
        elevation: this._calcSplitElevation(nextKm)
      };

      this.splits.push(split);
      this._lastSplitTime = this.elapsed;
      this._lastSplitDist = nextKm;

      this._onSplit?.(split);
    }
  }

  _calcSplitElevation(km) {
    const startIdx = Math.max(0, this.coords.length - 100);
    let gain = 0;
    for (let i = startIdx + 1; i < this.coords.length; i++) {
      const diff = (this.coords[i][2] || 0) - (this.coords[i - 1][2] || 0);
      if (diff > 0) gain += diff;
    }
    return Math.round(gain);
  }

  _calcTotalElevation() {
    let gain = 0;
    for (let i = 1; i < this.coords.length; i++) {
      const diff = (this.coords[i][2] || 0) - (this.coords[i - 1][2] || 0);
      if (diff > 1) gain += diff; // filter noise < 1m
    }
    return Math.round(gain);
  }

  // ── Timer ───────────────────────────────────────────────
  // RAF for smooth UI when screen is on.
  // setInterval as fallback for background (RAF is suspended on screen off).
  // Elapsed time uses performance.now() so it's always accurate regardless.

  _startTimer() {
    const tick = () => {
      this._updateElapsed();
      this._emitUpdate();
      this._timerRaf = requestAnimationFrame(tick);
    };
    this._timerRaf = requestAnimationFrame(tick);

    this._timerInterval = setInterval(() => {
      this._updateElapsed();
      this._emitUpdate();
    }, 1000);
  }

  _stopTimer() {
    if (this._timerRaf) {
      cancelAnimationFrame(this._timerRaf);
      this._timerRaf = null;
    }
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  _emitUpdate() {
    this._onUpdate?.({
      elapsed: this.elapsed,
      distance: this.distance,
      currentPace: this.currentPace,
      avgPace: this.avgPace,
      splits: this.splits,
      elevation: this._calcTotalElevation()
    });
  }

  _updateElapsed() {
    const autoPauseNow = this._autoPaused ? performance.now() - this._autoPauseStart : 0;
    const totalAuto = this._totalAutoPaused + autoPauseNow;
    if (this.state === 'tracking') {
      this.elapsed = (performance.now() - this._startTime - this._totalPaused - totalAuto) / 1000;
    } else if (this.state === 'paused') {
      this.elapsed = (this._pauseStart - this._startTime - this._totalPaused - totalAuto) / 1000;
    }
  }
}
