// ── BLE Heart Rate Monitor ───────────────────────────────

export class HRMonitor {
  constructor() {
    this._state = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
    this._device = null;
    this._char = null;
    this._onUpdate = null;
    this._onStateChange = null;
    this._onZoneChange = null;
    this._zones = [];
    this._currentZone = null;
    this._reconnecting = false;
    this.reset();
  }

  // ── Public API ─────────────────────────────────────────

  get state() { return this._state; }
  get hr() { return this._hr; }
  get hrAvg() { return this._hrAvg; }
  get hrMax() { return this._hrMax; }
  get sampleCount() { return this._sampleCount; }
  get deviceName() { return this._device?.name || ''; }
  get timeSeries() { return this._timeSeries; }
  get zoneTimes() { return { ...this._zoneTimes }; }

  set onUpdate(fn) { this._onUpdate = fn; }
  set onStateChange(fn) { this._onStateChange = fn; }
  set onZoneChange(fn) { this._onZoneChange = fn; }

  setZones(zones) { this._zones = zones; }

  reset() {
    this._hr = 0;
    this._hrAvg = 0;
    this._hrMax = 0;
    this._sampleCount = 0;
    this._currentZone = null;
    // Time-series: 1 sample per 5 seconds (max ~720/hour ≈ 2KB)
    this._timeSeries = [];      // [hr, hr, hr, ...] at 5s intervals
    this._lastSeriesTime = 0;
    // Zone time tracking (seconds in each zone)
    this._zoneTimes = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
    this._zoneEnteredAt = 0;
  }

  async requestConnection() {
    if (!navigator.bluetooth) throw new Error('Bluetooth no disponible');
    if (this._state === 'connected') return;

    this._setState('connecting');
    try {
      this._device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
      });
      this._device.addEventListener('gattserverdisconnected', () => this._onDisconnected());
      await this._connectGatt();
    } catch (e) {
      this._setState('disconnected');
      if (e.name !== 'NotFoundError') console.warn('HR connect failed:', e);
      throw e;
    }
  }

  disconnect() {
    this._reconnecting = false;
    // Settle zone time before disconnecting
    this._settleZoneTime();
    if (this._char) {
      try { this._char.stopNotifications(); } catch { /* ignore */ }
      this._char.removeEventListener('characteristicvaluechanged', this._onCharChanged);
      this._char = null;
    }
    if (this._device?.gatt?.connected) {
      try { this._device.gatt.disconnect(); } catch { /* ignore */ }
    }
    this._setState('disconnected');
  }

  serialize() {
    this._settleZoneTime();
    return {
      hrAvg: this._hrAvg,
      hrMax: this._hrMax,
      sampleCount: this._sampleCount,
      deviceName: this.deviceName,
      timeSeries: this._timeSeries,
      zoneTimes: { ...this._zoneTimes },
      lastSeriesTime: this._lastSeriesTime,
    };
  }

  restore(snap) {
    if (!snap) return;
    this._hrAvg = snap.hrAvg || 0;
    this._hrMax = snap.hrMax || 0;
    this._sampleCount = snap.sampleCount || 0;
    this._timeSeries = snap.timeSeries || [];
    this._zoneTimes = snap.zoneTimes || { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
    this._lastSeriesTime = snap.lastSeriesTime || 0;
  }

  // ── Internal ───────────────────────────────────────────

  async _connectGatt() {
    const server = await this._device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    this._char = await service.getCharacteristic('heart_rate_measurement');
    this._onCharChanged = this._handleCharChanged.bind(this);
    this._char.addEventListener('characteristicvaluechanged', this._onCharChanged);
    await this._char.startNotifications();
    this._reconnecting = false;
    this._setState('connected');
  }

  _handleCharChanged(event) {
    const value = event.target.value;
    const flags = value.getUint8(0);
    const hr = (flags & 0x01) ? value.getUint16(1, true) : value.getUint8(1);

    if (hr <= 0 || hr > 250) return; // sanity check

    const now = Date.now();
    this._hr = hr;
    this._sampleCount++;
    this._hrAvg = this._hrAvg + (hr - this._hrAvg) / this._sampleCount;
    if (hr > this._hrMax) this._hrMax = hr;

    // Time-series: record 1 sample every 5 seconds
    if (now - this._lastSeriesTime >= 5000) {
      this._timeSeries.push(hr);
      this._lastSeriesTime = now;
    }

    // Zone detection + zone time tracking
    const zone = this._estimateZone(hr);
    if (zone !== this._currentZone) {
      this._settleZoneTime();
      const prev = this._currentZone;
      this._currentZone = zone;
      this._zoneEnteredAt = now;
      if (prev !== null && this._onZoneChange) this._onZoneChange(zone, prev);
    }

    if (this._onUpdate) {
      this._onUpdate({
        hr, hrAvg: this._hrAvg, hrMax: this._hrMax, zone,
        zoneTimes: this._zoneTimes, zoneEnteredAt: this._zoneEnteredAt,
      });
    }
  }

  /** Flush elapsed time in current zone into _zoneTimes */
  _settleZoneTime() {
    if (this._currentZone && this._zoneEnteredAt > 0) {
      const elapsed = (Date.now() - this._zoneEnteredAt) / 1000;
      this._zoneTimes[this._currentZone] = (this._zoneTimes[this._currentZone] || 0) + elapsed;
      this._zoneEnteredAt = Date.now();
    }
  }

  _estimateZone(hr) {
    if (!this._zones.length || hr <= 0) return 'Z1';
    for (let i = this._zones.length - 1; i >= 0; i--) {
      if (hr >= this._zones[i].min) return this._zones[i].zone;
    }
    return 'Z1';
  }

  _onDisconnected() {
    this._settleZoneTime();
    this._char = null;
    this._setState('disconnected');
    // Auto-reconnect (no user gesture needed for previously paired device)
    if (!this._reconnecting && this._device) {
      this._reconnecting = true;
      this._attemptReconnect();
    }
  }

  async _attemptReconnect() {
    const MAX_RETRIES = 5;
    const DELAY = 2000;
    for (let i = 0; i < MAX_RETRIES && this._reconnecting; i++) {
      try {
        this._setState('connecting');
        await this._connectGatt();
        return; // success
      } catch {
        await new Promise(r => setTimeout(r, DELAY));
      }
    }
    this._reconnecting = false;
    this._setState('disconnected');
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    if (this._onStateChange) this._onStateChange(state);
  }
}
