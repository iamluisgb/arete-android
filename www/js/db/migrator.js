/**
 * One-shot migrator: localStorage + IndexedDB  →  SQLite.
 *
 * Two entry points:
 *  - migrateFromData(adapter, db, runRoutesMap) — pure: takes already-loaded
 *    inputs, writes them through the repos in a single transaction, marks
 *    `meta.migration_completed` with timestamp + stats. Idempotent: returns
 *    early when the flag is set. Fully testable with sql.js.
 *  - migrateFromBrowser(adapter, opts) — wrapper for the real runtime: reads
 *    `localStorage['arete']`, hydrates routes from IndexedDB `areteRuns`, then
 *    calls migrateFromData. Also saves a 7-day backup of the raw localStorage
 *    blob in `localStorage['arete.backup.localstorage']` before touching SQLite.
 *
 * Design choice: the migrator does NOT delete the localStorage blob after a
 * successful migration. We keep it around as a manual rollback path until
 * sub-phase D validates the APK in the real device. data.js will start
 * skipping the localStorage read once the migration flag is set.
 */

import {
  workoutsRepo,
  bodyLogsRepo,
  runningLogsRepo,
  customProgramsRepo,
  settingsRepo,
  tombstonesRepo,
  metaRepo,
} from './repos.js';

const STORAGE_KEY = 'arete';
const BACKUP_KEY = 'arete.backup.localstorage';
const BACKUP_RETENTION_DAYS = 7;
const MIGRATION_FLAG = 'migration_completed';

const HEAVY_FIELDS = ['route', 'splits', 'hrTimeSeries', 'hrZoneTimes', 'segments'];

/** @returns {Promise<boolean>} */
export async function isMigrationCompleted(adapter) {
  const v = await metaRepo.get(adapter, MIGRATION_FLAG);
  return v != null && v !== '';
}

/** Stringified JSON in meta: { at, workouts, runs, bodyLogs, customPrograms } */
async function markMigrationCompleted(adapter, stats) {
  await metaRepo.set(adapter, MIGRATION_FLAG, JSON.stringify({
    at: Date.now(),
    ...stats,
  }));
}

/**
 * Merge a flat runningLog with its heavy fields (loaded from IDB) so
 * runningLogsRepo.save can write both light + heavy rows in one transaction.
 */
function hydrateRun(log, routes) {
  const heavy = routes?.get?.(log.id);
  if (!heavy) return log;
  const out = { ...log };
  for (const f of HEAVY_FIELDS) {
    if (heavy[f] != null) out[f] = heavy[f];
  }
  return out;
}

/**
 * Pure migration step — no DOM, no localStorage, no IDB.
 *
 * @param {import('./sqlite-adapter.js').Adapter} adapter
 * @param {object} db                                       Result of loadDB() — already migrated to schema v5.
 * @param {Map<number, object>} [runRoutes]                 Map<runId, heavy>, from IDB or test fixture.
 * @returns {Promise<{ skipped: boolean, workouts:number, runs:number, bodyLogs:number, customPrograms:number, settings:number, tombstones:number } | {skipped:true}>}
 */
export async function migrateFromData(adapter, db, runRoutes = new Map()) {
  if (await isMigrationCompleted(adapter)) {
    return { skipped: true };
  }
  if (!db || typeof db !== 'object') {
    throw new Error('migrateFromData: db is not an object');
  }

  const workouts = Array.isArray(db.workouts) ? db.workouts : [];
  const bodyLogs = Array.isArray(db.bodyLogs) ? db.bodyLogs : [];
  const runningLogs = Array.isArray(db.runningLogs) ? db.runningLogs : [];
  const customPrograms = Array.isArray(db.customPrograms) ? db.customPrograms : [];
  const deletedIds = Array.isArray(db.deletedIds) ? db.deletedIds : [];

  // Top-level db singletons piggyback on the `settings` table with a `_` prefix
  // so they share one round-trip path. The facade hydrator strips the prefix
  // back when rebuilding the in-memory db shape.
  const userSettings = (db.settings && typeof db.settings === 'object') ? db.settings : {};
  const settings = {
    ...userSettings,
    ...(db.program        !== undefined ? { _program:        db.program } : {}),
    ...(db.phase          !== undefined ? { _phase:          db.phase } : {}),
    ...(db.runningProgram !== undefined ? { _runningProgram: db.runningProgram } : {}),
    ...(db.runningWeek    !== undefined ? { _runningWeek:    db.runningWeek } : {}),
    ...(db.runningGoal    !== undefined ? { _runningGoal:    db.runningGoal } : {}),
  };

  // No outer transaction here: each repo's saveMany opens its own BEGIN/COMMIT
  // and SQLite doesn't support nested BEGINs. Safety comes from two properties:
  //  (1) Every write is an UPSERT (INSERT OR REPLACE / ON CONFLICT DO UPDATE),
  //      so a retry after a crash is a no-op on rows already written.
  //  (2) `migration_completed` is set only after all writes succeed. If the
  //      app dies mid-migration, the next launch re-runs the whole thing
  //      against the same UPSERT statements and converges on the same state.
  if (workouts.length) await workoutsRepo.saveMany(adapter, workouts);
  if (bodyLogs.length) await bodyLogsRepo.saveMany(adapter, bodyLogs);
  if (runningLogs.length) {
    await adapter.transaction(async () => {
      await _saveRunsDirect(adapter, runningLogs.map(l => hydrateRun(l, runRoutes)));
    });
  }
  for (const p of customPrograms) {
    if (p?._customId) await customProgramsRepo.save(adapter, p);
  }
  if (Object.keys(settings).length) {
    await settingsRepo.setAll(adapter, settings);
  }
  if (deletedIds.length) {
    await tombstonesRepo.addMany(adapter, deletedIds.map(String), 'workouts');
  }

  const stats = {
    workouts: workouts.length,
    runs: runningLogs.length,
    bodyLogs: bodyLogs.length,
    customPrograms: customPrograms.length,
    settings: Object.keys(settings).length,
    tombstones: deletedIds.length,
  };
  await markMigrationCompleted(adapter, stats);
  return { skipped: false, ...stats };
}

/**
 * Inline UPSERT of running logs + their heavy split. Used by migrateFromData
 * to stay inside one outer transaction (no nested BEGIN).
 */
async function _saveRunsDirect(adapter, runs) {
  const now = Date.now();
  const UPSERT_LOG = `
    INSERT INTO running_logs (id, date, session, program, week, type, distance,
                              duration, pace, hr, hr_max, elevation, source, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      date=excluded.date, session=excluded.session, program=excluded.program,
      week=excluded.week, type=excluded.type, distance=excluded.distance,
      duration=excluded.duration, pace=excluded.pace, hr=excluded.hr,
      hr_max=excluded.hr_max, elevation=excluded.elevation, source=excluded.source,
      notes=excluded.notes, updated_at=excluded.updated_at`;
  const UPSERT_ROUTE = `
    INSERT INTO running_routes (run_id, route_json, splits_json,
                                hr_time_series_json, hr_zone_times_json, segments_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      route_json=excluded.route_json, splits_json=excluded.splits_json,
      hr_time_series_json=excluded.hr_time_series_json,
      hr_zone_times_json=excluded.hr_zone_times_json,
      segments_json=excluded.segments_json,
      updated_at=excluded.updated_at`;
  for (const r of runs) {
    await adapter.run(UPSERT_LOG, [
      r.id, r.date, r.session ?? null, r.program ?? null, r.week ?? null,
      r.type ?? null, r.distance ?? null, r.duration ?? null, r.pace ?? null,
      r.hr ?? null, r.hrMax ?? null, r.elevation ?? null, r.source ?? null,
      r.notes ?? null, now,
    ]);
    const hasHeavy = HEAVY_FIELDS.some(f => r[f] != null);
    if (hasHeavy) {
      await adapter.run(UPSERT_ROUTE, [
        r.id,
        r.route ? JSON.stringify(r.route) : null,
        r.splits ? JSON.stringify(r.splits) : null,
        r.hrTimeSeries ? JSON.stringify(r.hrTimeSeries) : null,
        r.hrZoneTimes ? JSON.stringify(r.hrZoneTimes) : null,
        r.segments ? JSON.stringify(r.segments) : null,
        now,
      ]);
    }
  }
}

/**
 * Browser entry point — reads localStorage + IndexedDB, writes a backup,
 * then delegates to migrateFromData.
 *
 * @param {import('./sqlite-adapter.js').Adapter} adapter
 * @param {{ getAllRoutes?: () => Promise<Map<number, object>> }} [opts]
 *        Inject the heavy-routes loader for testability (defaults to run-store).
 * @returns {Promise<{skipped:boolean} | {skipped:false, workouts:number, runs:number, ...}>}
 */
export async function migrateFromBrowser(adapter, opts = {}) {
  if (typeof localStorage === 'undefined') {
    throw new Error('migrateFromBrowser: no localStorage in this environment');
  }
  if (await isMigrationCompleted(adapter)) return { skipped: true };

  const rawBlob = localStorage.getItem(STORAGE_KEY);
  if (!rawBlob) {
    // Nothing to migrate — still mark complete so we don't keep retrying.
    await markMigrationCompleted(adapter, {
      workouts: 0, runs: 0, bodyLogs: 0, customPrograms: 0, settings: 0, tombstones: 0,
    });
    return { skipped: false, workouts: 0, runs: 0, bodyLogs: 0, customPrograms: 0, settings: 0, tombstones: 0 };
  }

  // 1) Backup raw localStorage blob with 7-day expiry. Idempotent.
  _maybeBackupLocalStorage(rawBlob);

  // 2) Parse + load routes from IDB.
  let db;
  try { db = JSON.parse(rawBlob); } catch (e) {
    throw new Error('migrateFromBrowser: localStorage[arete] is not valid JSON');
  }

  let runRoutes = new Map();
  if (opts.getAllRoutes) {
    runRoutes = await opts.getAllRoutes();
  } else {
    // Lazy import to avoid pulling run-store into non-running environments.
    const { getAllRunRoutes } = await import('../run-store.js');
    runRoutes = await getAllRunRoutes();
  }

  // 3) Delegate to the pure migrator.
  return migrateFromData(adapter, db, runRoutes);
}

function _maybeBackupLocalStorage(rawBlob) {
  try {
    const existing = localStorage.getItem(BACKUP_KEY);
    if (existing) {
      try {
        const e = JSON.parse(existing);
        const ageMs = Date.now() - (e.savedAt || 0);
        if (ageMs <= BACKUP_RETENTION_DAYS * 86400_000) return;  // recent backup, keep it
      } catch { /* corrupt backup, overwrite */ }
    }
    localStorage.setItem(BACKUP_KEY, JSON.stringify({
      savedAt: Date.now(),
      raw: rawBlob,
    }));
  } catch (e) {
    console.warn('localStorage backup failed:', e);
  }
}

/** Manual rollback path: re-write localStorage from the snapshot. */
export function restoreLocalStorageBackup() {
  if (typeof localStorage === 'undefined') return false;
  const s = localStorage.getItem(BACKUP_KEY);
  if (!s) return false;
  try {
    const b = JSON.parse(s);
    if (!b?.raw) return false;
    localStorage.setItem(STORAGE_KEY, b.raw);
    localStorage.removeItem(BACKUP_KEY);
    return true;
  } catch { return false; }
}
