import { mergeDB } from './utils.js';
import { stripHeavyFields, splitAndStoreRoutes, clearRunStore, getAllRunRoutes } from './run-store.js';
import { migrateWorkoutV4ToV5 } from './strength-schema.js';

const STORAGE_KEY = 'arete';
const BACKUP_KEY = 'arete.backup.v4';
const BACKUP_RETENTION_DAYS = 7;

const isCapacitor = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

/** Helper: read from localStorage or Capacitor Preferences fallback */
export async function safeGet(key, fallback = null) {
  try {
    const Preferences = isCapacitor ? window.Capacitor?.Plugins?.Preferences : null;
    if (Preferences) {
      const { value } = await Preferences.get({ key });
      return value ?? fallback;
    }
    return localStorage.getItem(STORAGE_KEY + '.' + key) ?? fallback;
  } catch (e) {
    console.warn('safeGet failed:', e);
    return fallback;
  }
}

/** Helper: write to localStorage or Capacitor Preferences fallback */
export async function safeSet(key, value) {
  try {
    const strVal = value === null ? '' : String(value);
    const Preferences = isCapacitor ? window.Capacitor?.Plugins?.Preferences : null;
    if (Preferences) {
      await Preferences.set({ key, value: strVal });
    }
    localStorage.setItem(STORAGE_KEY + '.' + key, strVal);
  } catch (e) {
    console.warn('safeSet failed:', e);
  }
}

let _onSave = null;
let _onQuotaError = null;
let _onExternalChange = null;
/** @param {Function} fn - Callback invoked after every saveDB */
export function setOnSave(fn) { _onSave = fn; }
/** @param {Function} fn - Callback invoked when localStorage is full */
export function setOnQuotaError(fn) { _onQuotaError = fn; }
/** @param {Function} fn - Callback invoked when another tab changes the data */
export function setOnExternalChange(fn) { _onExternalChange = fn; }

// Detect writes from other tabs (PWA only; Capacitor is single-process).
if (typeof window !== 'undefined' && !isCapacitor) {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && _onExternalChange) _onExternalChange();
  });
}

// Raw localStorage wrapper — used by both the PWA path and the one-shot
// import-from-localStorage step on Android. WebView localStorage gives 50MB+.
const Storage = {
  getItem(key) { return localStorage.getItem(key); },
  setItem(key, value) { localStorage.setItem(key, value); },
  removeItem(key) { localStorage.removeItem(key); },
};

const CURRENT_SCHEMA = 5;

/**
 * Factory for a fresh default db. Returns a *new* object every call so
 * `loadDB()` users can safely push() into `workouts`/`bodyLogs`/etc without
 * leaking state into the next caller. (The previous shared-DEFAULTS object
 * caused tests to see push() results from earlier tests.)
 */
function defaults() {
  return {
    schemaVersion: CURRENT_SCHEMA,
    program: 'arete',
    phase: 1,
    workouts: [],
    bodyLogs: [],
    deletedIds: [],
    customPrograms: [],
    runningLogs: [],
    runningProgram: '',
    runningWeek: 1,
    runningGoal: { type: 'km', target: 0, enabled: false },
    settings: { height: 175, age: 32, race5k: 0, maxHR: 0 },
  };
}

/** Schema migrations — each takes a db object and mutates it in place */
const migrations = [
  // v1 → v2: ensure all workouts have a program field; ensure settings exists
  (db) => {
    for (const w of (db.workouts || [])) {
      if (!w.program) w.program = db.program || 'arete';
    }
    if (!db.settings || typeof db.settings !== 'object') {
      db.settings = { height: 175, age: 32 };
    }
    if (!db.runningLogs) db.runningLogs = [];
    if (!db.customPrograms) db.customPrograms = [];
  },
  // v2 → v3: add race5k to settings for personalized pace zones
  (db) => {
    if (!db.settings) db.settings = {};
    if (!db.settings.race5k) db.settings.race5k = 0;
  },
  // v3 → v4: add maxHR to settings for HR zone calculation
  (db) => {
    if (!db.settings) db.settings = {};
    if (!db.settings.maxHR) {
      db.settings.maxHR = db.settings.age ? 220 - db.settings.age : 0;
    }
  },
  // v4 → v5: strength workouts schema v5 — typed numeric sets, exerciseId,
  // startedAt timestamps. Non-destructive: per-set `_raw` keeps the v4 string.
  (db) => {
    for (const w of (db.workouts || [])) {
      migrateWorkoutV4ToV5(w);
    }
  },
];

/** Run pending migrations on a loaded db object */
export function migrateDB(db) {
  const from = db.schemaVersion || 1;
  for (let v = from; v < CURRENT_SCHEMA; v++) {
    const fn = migrations[v - 1];
    if (fn) fn(db);
  }
  db.schemaVersion = CURRENT_SCHEMA;
  return db;
}

/** Snapshot the raw db blob before migrating across a schema bump. */
function _maybeBackupBeforeMigration(rawJson, fromVersion) {
  if (fromVersion >= CURRENT_SCHEMA) return;
  try {
    const existing = Storage.getItem(BACKUP_KEY);
    if (existing) {
      const e = JSON.parse(existing);
      const ageMs = Date.now() - (e.savedAt || 0);
      if (ageMs > BACKUP_RETENTION_DAYS * 86400_000) {
        Storage.removeItem(BACKUP_KEY);
      } else {
        return;
      }
    }
    Storage.setItem(BACKUP_KEY, JSON.stringify({
      savedAt: Date.now(),
      fromVersion,
      raw: rawJson,
    }));
  } catch (e) {
    console.warn('pre-migration backup failed:', e);
  }
}

/** @returns {{savedAt:number, fromVersion:number, raw:string}|null} */
export function getPreMigrationBackup() {
  try {
    const s = Storage.getItem(BACKUP_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

/** Restore the pre-migration snapshot. Returns true on success. */
export function restorePreMigrationBackup() {
  const b = getPreMigrationBackup();
  if (!b || !b.raw) return false;
  Storage.setItem(STORAGE_KEY, b.raw);
  Storage.removeItem(BACKUP_KEY);
  return true;
}

// ────────────────────────────────────────────────────────────────
// PWA path — localStorage (synchronous, current behaviour)
// ────────────────────────────────────────────────────────────────

function _loadFromLocalStorage() {
  try {
    const raw = Storage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.workouts) {
        _maybeBackupBeforeMigration(raw, d.schemaVersion || 1);
        const db = { ...defaults(), ...d };
        return migrateDB(db);
      }
    }
    return defaults();
  } catch (e) {
    console.warn('loadDB: corrupt storage data, using defaults', e);
    return defaults();
  }
}

function _saveToLocalStorage(db) {
  const dbForStorage = db.runningLogs?.length
    ? { ...db, runningLogs: db.runningLogs.map(stripHeavyFields) }
    : db;
  Storage.setItem(STORAGE_KEY, JSON.stringify(dbForStorage));
}

// ────────────────────────────────────────────────────────────────
// Android path — SQLite (async, lazy-imported)
// ────────────────────────────────────────────────────────────────

let _sqliteAdapterPromise = null;
async function _getAdapter() {
  if (!_sqliteAdapterPromise) {
    _sqliteAdapterPromise = (async () => {
      const { openDB } = await import('./db/sqlite-adapter.js');
      const { migrateSchema } = await import('./db/schema.js');
      const adapter = await openDB();
      await migrateSchema(adapter);
      return adapter;
    })();
  }
  return _sqliteAdapterPromise;
}

async function _loadFromSqlite() {
  const adapter = await _getAdapter();
  const { isMigrationCompleted, migrateFromData } = await import('./db/migrator.js');

  // One-shot import from legacy storage the first time the app runs on Android
  // after this upgrade. After this, SQLite is the source of truth.
  if (!(await isMigrationCompleted(adapter))) {
    const legacy = _loadFromLocalStorage();   // also writes arete.backup.v4 if v4→v5 fires
    const runRoutes = await getAllRunRoutes();
    await migrateFromData(adapter, legacy, runRoutes);
  }

  return _hydrateFromSqlite(adapter);
}

async function _hydrateFromSqlite(adapter) {
  const {
    workoutsRepo, bodyLogsRepo, runningLogsRepo, customProgramsRepo,
    settingsRepo, tombstonesRepo,
  } = await import('./db/repos.js');

  const [workouts, bodyLogs, runningLogs, customPrograms, settingsRaw, deletedIds] = await Promise.all([
    workoutsRepo.loadAll(adapter),
    bodyLogsRepo.loadAll(adapter),
    runningLogsRepo.loadAll(adapter),
    customProgramsRepo.loadAll(adapter),
    settingsRepo.loadAll(adapter),
    tombstonesRepo.loadIds(adapter),
  ]);

  // Split _-prefixed top-level singletons from user settings.
  const {
    _program, _phase, _runningProgram, _runningWeek, _runningGoal,
    ...userSettings
  } = settingsRaw;

  return {
    schemaVersion: CURRENT_SCHEMA,
    program:        _program        ?? defaults().program,
    phase:          _phase          ?? defaults().phase,
    runningProgram: _runningProgram ?? defaults().runningProgram,
    runningWeek:    _runningWeek    ?? defaults().runningWeek,
    runningGoal:    _runningGoal    ?? defaults().runningGoal,
    settings: { ...defaults().settings, ...userSettings },
    workouts,
    bodyLogs,
    runningLogs,
    customPrograms,
    deletedIds,
  };
}

async function _saveToSqlite(db) {
  const adapter = await _getAdapter();
  const {
    workoutsRepo, bodyLogsRepo, runningLogsRepo, customProgramsRepo,
    settingsRepo, tombstonesRepo,
  } = await import('./db/repos.js');

  // Full-blob save: UPSERT every collection. O(N) cost in number of records;
  // expected <100ms for the realistic 200-workout ceiling. If profiling shows
  // this dominating frame time, the next step is per-record dirty tracking.
  if (db.workouts?.length) await workoutsRepo.saveMany(adapter, db.workouts);
  if (db.bodyLogs?.length) await bodyLogsRepo.saveMany(adapter, db.bodyLogs);
  if (db.runningLogs?.length) {
    for (const run of db.runningLogs) await runningLogsRepo.save(adapter, run);
  }
  if (db.customPrograms?.length) {
    for (const p of db.customPrograms) {
      if (p?._customId) await customProgramsRepo.save(adapter, p);
    }
  }

  // Flatten top-level singletons into settings table with `_` prefix.
  const flatSettings = {
    ...(db.settings || {}),
    ...(db.program        !== undefined ? { _program:        db.program } : {}),
    ...(db.phase          !== undefined ? { _phase:          db.phase } : {}),
    ...(db.runningProgram !== undefined ? { _runningProgram: db.runningProgram } : {}),
    ...(db.runningWeek    !== undefined ? { _runningWeek:    db.runningWeek } : {}),
    ...(db.runningGoal    !== undefined ? { _runningGoal:    db.runningGoal } : {}),
  };
  if (Object.keys(flatSettings).length) {
    await settingsRepo.setAll(adapter, flatSettings);
  }

  if (db.deletedIds?.length) {
    await tombstonesRepo.addMany(adapter, db.deletedIds.map(String), 'workouts');
  }
}

// ────────────────────────────────────────────────────────────────
// Public facade
// ────────────────────────────────────────────────────────────────

/** Load the database. Always async; resolves to the same `db` shape on both platforms. */
export async function loadDB() {
  if (!isCapacitor) return _loadFromLocalStorage();
  return _loadFromSqlite();
}

/** Track a deleted item ID so mergeDB never resurrects it */
export function markDeleted(db, id) {
  if (!db.deletedIds) db.deletedIds = [];
  if (!db.deletedIds.includes(id)) db.deletedIds.push(id);
}

/** @returns {boolean} true if db has valid minimal structure */
export function validateDB(db) {
  return db && typeof db === 'object' && Array.isArray(db.workouts) && Array.isArray(db.bodyLogs);
}

/** Prune deletedIds that no longer match any live record (max 500) */
export function pruneDeletedIds(db) {
  if (!db.deletedIds || db.deletedIds.length <= 500) return;
  const liveIds = new Set([
    ...(db.workouts || []).map(w => w.id),
    ...(db.bodyLogs || []).map(b => b.id),
    ...(db.runningLogs || []).map(r => r.id),
  ]);
  const recent = db.deletedIds.slice(-200);
  db.deletedIds = [...new Set([...recent, ...db.deletedIds.filter(id => liveIds.has(id))])];
}

/** Monotonic revision counter — incremented on every saveDB */
let _saveRevision = 0;
export function getSaveRevision() { return _saveRevision; }

/**
 * Persist db. Always returns a Promise but UI callers can fire-and-forget:
 * a serial queue chains saves in arrival order so back-to-back saves never race.
 * Boot-time callers that need ordering can still `await saveDB(db)`.
 */
let _saveQueue = Promise.resolve();
export function saveDB(db) {
  _saveQueue = _saveQueue
    .then(() => _doSave(db))
    .catch(e => { console.error('saveDB queue failed:', e); });
  return _saveQueue;
}

async function _doSave(db) {
  if (!validateDB(db)) { console.error('saveDB: invalid db, aborting save', db); return; }
  pruneDeletedIds(db);
  try {
    if (isCapacitor) {
      await _saveToSqlite(db);
    } else {
      _saveToLocalStorage(db);
    }
    _saveRevision++;
  } catch (e) {
    console.error('saveDB: storage write failed', e);
    if (_onQuotaError) _onQuotaError(db);
    return;
  }
  if (_onSave) _onSave(db);
}

/** Heavy fields loader, platform-agnostic. Used by export tooling. */
export async function getAllRoutes() {
  if (!isCapacitor) return getAllRunRoutes();
  const adapter = await _getAdapter();
  const { runningLogsRepo } = await import('./db/repos.js');
  return runningLogsRepo.getAllRoutes(adapter);
}

/** Download db as a JSON file (reconstructs full running logs with heavy fields) */
export async function exportData(db) {
  let fullLogs = db.runningLogs;
  if (db.runningLogs?.length) {
    const routes = await getAllRoutes();
    if (routes.size > 0) {
      fullLogs = db.runningLogs.map(l => {
        const heavy = routes.get(l.id);
        return heavy ? { ...l, ...heavy } : l;
      });
    }
  }
  const fullDB = { ...db, runningLogs: fullLogs };
  const b = new Blob([JSON.stringify(fullDB, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `arete-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Validate imported data structure before merging */
export function validateImportData(d) {
  if (!d || typeof d !== 'object') return 'Datos inválidos';
  if (!Array.isArray(d.workouts)) return 'Falta el array de workouts';
  for (let i = 0; i < d.workouts.length; i++) {
    const w = d.workouts[i];
    if (!w || typeof w !== 'object') return `Workout #${i} inválido`;
    if (w.id == null) return `Workout #${i} sin id`;
    if (!Array.isArray(w.exercises)) return `Workout #${i} sin exercises[]`;
  }
  if (d.bodyLogs && !Array.isArray(d.bodyLogs)) return 'bodyLogs no es un array';
  if (d.runningLogs && !Array.isArray(d.runningLogs)) return 'runningLogs no es un array';
  if (d.deletedIds && !Array.isArray(d.deletedIds)) return 'deletedIds no es un array';
  if (d.customPrograms && !Array.isArray(d.customPrograms)) return 'customPrograms no es un array';
  return null;
}

/** Import and merge a JSON backup from a file input event */
export function importData(event, db, onSuccess) {
  const f = event.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result);
      const err = validateImportData(d);
      if (err) { alert(`Formato no válido: ${err}`); return; }
      Object.assign(db, mergeDB(db, d));
      if (isCapacitor) {
        // SQLite path: heavy fields live in repos, no IDB split needed.
        await saveDB(db);
      } else {
        // PWA path: split heavy into IDB before persisting the light db blob.
        const stripped = await splitAndStoreRoutes(db.runningLogs);
        db.runningLogs = stripped;
        await saveDB(db);
      }
      alert('Datos importados');
      location.reload();
    } catch (e) {
      console.warn('importData failed:', e);
      alert('Error al leer el archivo');
    }
  };
  r.readAsText(f);
}

/** Wipe all data after double confirmation */
export async function clearAllData() {
  if (!confirm('¿Borrar TODOS los datos?')) return;
  if (!confirm('Última oportunidad. ¿Borrar todo?')) return;
  Storage.removeItem(STORAGE_KEY);
  try { await clearRunStore(); } catch { /* swallow */ }
  if (isCapacitor) {
    try {
      const adapter = await _getAdapter();
      for (const t of ['workouts', 'body_logs', 'running_logs', 'running_routes',
                       'custom_programs', 'settings', 'deleted_records', 'meta']) {
        await adapter.run(`DELETE FROM ${t}`);
      }
    } catch (e) {
      console.warn('SQLite clearAllData failed:', e);
    }
  }
  location.reload();
}
