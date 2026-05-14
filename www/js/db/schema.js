/**
 * SQLite schema for Areté Android (FEAT-006 Fase 1).
 *
 * Design choices:
 *  - Heavy/structured fields (exercises, sets, route coords, splits, HR series)
 *    are stored as TEXT columns containing JSON. Reason: query granularity is
 *    "whole workout" / "whole run", never "all bench-press sets across all
 *    workouts". Normalizing to workout_exercises + workout_sets would add 3
 *    tables + joins without benefit for current use cases. SQLite 3.38+
 *    supports JSON operators (->, ->>) if cross-record queries ever appear.
 *  - `updated_at` on every domain table (epoch ms): scaffolding for FEAT-006
 *    Fase 4 sync (LWW per record).
 *  - `meta` table holds schema_version and migration flags as a key-value
 *    store. This is the only "by hand" table we have to read/write outside
 *    of a repo abstraction.
 *  - PRAGMA: WAL is set at runtime by sqlite-adapter (not in the schema DDL)
 *    because it's a connection-level pragma, not part of the schema.
 *
 * Versioning: SCHEMA_VERSION is the SQLite-internal schema version, separate
 * from CURRENT_SCHEMA in data.js (which versions the localStorage JSON blob).
 * On every plugin open, migrateSchema() runs missing DDL up to SCHEMA_VERSION.
 */

export const SCHEMA_VERSION = 1;

/**
 * DDL statements applied in order on a fresh database (v0 → v1).
 * Each entry is one full SQL statement.
 */
const DDL_V1 = [
  `CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS workouts (
    id             INTEGER PRIMARY KEY,
    date           TEXT    NOT NULL,
    session        TEXT,
    phase          INTEGER,
    program        TEXT,
    notes          TEXT,
    started_at     INTEGER,
    ended_at       INTEGER,
    duration_sec   INTEGER,
    bodyweight_kg  REAL,
    historical     INTEGER DEFAULT 0,
    exercises_json TEXT    NOT NULL,
    prs_json       TEXT,
    updated_at     INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workouts_date    ON workouts(date)`,
  `CREATE INDEX IF NOT EXISTS idx_workouts_program ON workouts(program)`,

  `CREATE TABLE IF NOT EXISTS body_logs (
    id                INTEGER PRIMARY KEY,
    date              TEXT    NOT NULL,
    measurements_json TEXT    NOT NULL,
    notes             TEXT,
    updated_at        INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_body_logs_date ON body_logs(date)`,

  `CREATE TABLE IF NOT EXISTS running_logs (
    id          INTEGER PRIMARY KEY,
    date        TEXT    NOT NULL,
    session     TEXT,
    program     TEXT,
    week        INTEGER,
    type        TEXT,
    distance    REAL,
    duration    INTEGER,
    pace        INTEGER,
    hr          INTEGER,
    hr_max      INTEGER,
    elevation   REAL,
    source      TEXT,
    notes       TEXT,
    updated_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_running_logs_date ON running_logs(date)`,

  `CREATE TABLE IF NOT EXISTS running_routes (
    run_id              INTEGER PRIMARY KEY REFERENCES running_logs(id) ON DELETE CASCADE,
    route_json          TEXT,
    splits_json         TEXT,
    hr_time_series_json TEXT,
    hr_zone_times_json  TEXT,
    segments_json       TEXT,
    updated_at          INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS custom_programs (
    custom_id  TEXT PRIMARY KEY,
    meta_json  TEXT NOT NULL,
    data_json  TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS deleted_records (
    collection  TEXT NOT NULL,
    record_id   TEXT NOT NULL,
    deleted_at  INTEGER NOT NULL,
    PRIMARY KEY (collection, record_id)
  )`,
];

/** All DDL ordered by version. Index = version after applying. */
const SCHEMA_HISTORY = [DDL_V1];

/**
 * Apply pending DDL migrations to reach SCHEMA_VERSION.
 *
 * @param {{ run: (sql: string, params?: any[]) => Promise<void>,
 *           query: (sql: string, params?: any[]) => Promise<any[]>,
 *           transaction: (fn: () => Promise<void>) => Promise<void> }} adapter
 *           SQLite adapter (sqlite-adapter.js or a sql.js-backed test double).
 */
export async function migrateSchema(adapter) {
  // 1) Ensure meta exists so we can read schema_version.
  await adapter.run(SCHEMA_HISTORY[0][0]);

  // 2) Read current version (default 0 if absent).
  const rows = await adapter.query(
    "SELECT value FROM meta WHERE key = 'schema_version'"
  );
  const currentVersion = rows.length ? parseInt(rows[0].value, 10) : 0;

  if (currentVersion >= SCHEMA_VERSION) return { from: currentVersion, to: currentVersion };

  // 3) Apply each missing version inside one transaction per step.
  for (let v = currentVersion; v < SCHEMA_VERSION; v++) {
    const statements = SCHEMA_HISTORY[v];
    await adapter.transaction(async () => {
      for (const sql of statements) {
        await adapter.run(sql);
      }
      await adapter.run(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
        [String(v + 1)]
      );
    });
  }

  return { from: currentVersion, to: SCHEMA_VERSION };
}

/** Names of all domain tables (excludes meta + deleted_records + settings). */
export const DOMAIN_TABLES = [
  'workouts',
  'body_logs',
  'running_logs',
  'running_routes',
  'custom_programs',
];
