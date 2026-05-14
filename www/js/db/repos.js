/**
 * Repositories — one object per collection — over the SQLite Adapter interface.
 *
 * Each repo exposes a tiny CRUD surface tailored to how the UI uses it.
 * Repos own the mapping between row tuples and JS objects (`rowToWorkout`,
 * `workoutToRow`, etc.) so the rest of the app never sees raw SQL.
 *
 * Soft-delete: every delete writes to `deleted_records` so the merge logic in
 * data.js (`deletedIds`) keeps working unchanged.
 */

const TOMBSTONE_SQL =
  `INSERT OR REPLACE INTO deleted_records (collection, record_id, deleted_at)
   VALUES (?, ?, ?)`;

function nowMs() { return Date.now(); }

function parseJson(s, fallback = null) {
  if (s == null || s === '') return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

// ── workouts ──────────────────────────────────────────────────────────────

function rowToWorkout(r) {
  return {
    id: r.id,
    date: r.date,
    session: r.session ?? '',
    phase: r.phase,
    program: r.program,
    notes: r.notes ?? '',
    startedAt: r.started_at ?? undefined,
    endedAt: r.ended_at ?? undefined,
    durationSec: r.duration_sec ?? undefined,
    bodyweightKg: r.bodyweight_kg ?? undefined,
    _historical: r.historical === 1 || r.historical === true || undefined,
    exercises: parseJson(r.exercises_json, []),
    prs: parseJson(r.prs_json, undefined),
  };
}

function workoutToRow(w) {
  return [
    w.id,
    w.date,
    w.session ?? null,
    w.phase ?? null,
    w.program ?? null,
    w.notes ?? null,
    w.startedAt ?? null,
    w.endedAt ?? null,
    w.durationSec ?? null,
    w.bodyweightKg ?? null,
    w._historical ? 1 : 0,
    JSON.stringify(w.exercises || []),
    w.prs ? JSON.stringify(w.prs) : null,
    nowMs(),
  ];
}

const UPSERT_WORKOUT = `
  INSERT INTO workouts (id, date, session, phase, program, notes,
                        started_at, ended_at, duration_sec, bodyweight_kg, historical,
                        exercises_json, prs_json, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    date=excluded.date, session=excluded.session, phase=excluded.phase,
    program=excluded.program, notes=excluded.notes,
    started_at=excluded.started_at, ended_at=excluded.ended_at,
    duration_sec=excluded.duration_sec, bodyweight_kg=excluded.bodyweight_kg,
    historical=excluded.historical,
    exercises_json=excluded.exercises_json, prs_json=excluded.prs_json,
    updated_at=excluded.updated_at`;

export const workoutsRepo = {
  async loadAll(adapter) {
    const rows = await adapter.query('SELECT * FROM workouts ORDER BY date DESC, id DESC');
    return rows.map(rowToWorkout);
  },
  async save(adapter, workout) {
    await adapter.run(UPSERT_WORKOUT, workoutToRow(workout));
  },
  async saveMany(adapter, workouts) {
    await adapter.transaction(async () => {
      for (const w of workouts) await adapter.run(UPSERT_WORKOUT, workoutToRow(w));
    });
  },
  async delete(adapter, id) {
    await adapter.transaction(async () => {
      await adapter.run('DELETE FROM workouts WHERE id = ?', [id]);
      await adapter.run(TOMBSTONE_SQL, ['workouts', String(id), nowMs()]);
    });
  },
};

// ── body_logs ─────────────────────────────────────────────────────────────

function rowToBodyLog(r) {
  return {
    id: r.id,
    date: r.date,
    notes: r.notes ?? '',
    ...parseJson(r.measurements_json, {}),
  };
}

function bodyLogToRow(b) {
  const { id, date, notes, ...measurements } = b;
  return [
    id,
    date,
    JSON.stringify(measurements || {}),
    notes ?? null,
    nowMs(),
  ];
}

const UPSERT_BODY_LOG = `
  INSERT INTO body_logs (id, date, measurements_json, notes, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    date=excluded.date, measurements_json=excluded.measurements_json,
    notes=excluded.notes, updated_at=excluded.updated_at`;

export const bodyLogsRepo = {
  async loadAll(adapter) {
    const rows = await adapter.query('SELECT * FROM body_logs ORDER BY date DESC, id DESC');
    return rows.map(rowToBodyLog);
  },
  async save(adapter, log) {
    await adapter.run(UPSERT_BODY_LOG, bodyLogToRow(log));
  },
  async saveMany(adapter, logs) {
    await adapter.transaction(async () => {
      for (const b of logs) await adapter.run(UPSERT_BODY_LOG, bodyLogToRow(b));
    });
  },
  async delete(adapter, id) {
    await adapter.transaction(async () => {
      await adapter.run('DELETE FROM body_logs WHERE id = ?', [id]);
      await adapter.run(TOMBSTONE_SQL, ['body_logs', String(id), nowMs()]);
    });
  },
};

// ── running_logs + running_routes (split light/heavy) ─────────────────────

const HEAVY_FIELDS = ['route', 'splits', 'hrTimeSeries', 'hrZoneTimes', 'segments'];

function rowToRunLog(r) {
  return {
    id: r.id,
    date: r.date,
    session: r.session ?? '',
    program: r.program,
    week: r.week ?? null,
    type: r.type,
    distance: r.distance,
    duration: r.duration,
    pace: r.pace,
    hr: r.hr,
    hrMax: r.hr_max,
    elevation: r.elevation,
    source: r.source,
    notes: r.notes ?? '',
  };
}

function runLogLightToRow(run) {
  return [
    run.id,
    run.date,
    run.session ?? null,
    run.program ?? null,
    run.week ?? null,
    run.type ?? null,
    run.distance ?? null,
    run.duration ?? null,
    run.pace ?? null,
    run.hr ?? null,
    run.hrMax ?? null,
    run.elevation ?? null,
    run.source ?? null,
    run.notes ?? null,
    nowMs(),
  ];
}

const UPSERT_RUN_LOG = `
  INSERT INTO running_logs (id, date, session, program, week, type, distance,
                            duration, pace, hr, hr_max, elevation, source, notes, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    date=excluded.date, session=excluded.session, program=excluded.program,
    week=excluded.week, type=excluded.type, distance=excluded.distance,
    duration=excluded.duration, pace=excluded.pace, hr=excluded.hr,
    hr_max=excluded.hr_max, elevation=excluded.elevation, source=excluded.source,
    notes=excluded.notes, updated_at=excluded.updated_at`;

const UPSERT_RUN_ROUTE = `
  INSERT INTO running_routes (run_id, route_json, splits_json,
                              hr_time_series_json, hr_zone_times_json, segments_json, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(run_id) DO UPDATE SET
    route_json=excluded.route_json,
    splits_json=excluded.splits_json,
    hr_time_series_json=excluded.hr_time_series_json,
    hr_zone_times_json=excluded.hr_zone_times_json,
    segments_json=excluded.segments_json,
    updated_at=excluded.updated_at`;

function extractHeavy(run) {
  const heavy = {};
  let has = false;
  for (const f of HEAVY_FIELDS) {
    if (run[f] != null) { heavy[f] = run[f]; has = true; }
  }
  return has ? heavy : null;
}

export const runningLogsRepo = {
  /** Returns light logs (no route/splits/hr/segments). Mirrors the localStorage shape. */
  async loadAll(adapter) {
    const rows = await adapter.query('SELECT * FROM running_logs ORDER BY date DESC, id DESC');
    return rows.map(rowToRunLog);
  },

  /** Save a run: light fields → running_logs, heavy → running_routes (if present). */
  async save(adapter, run) {
    await adapter.transaction(async () => {
      await adapter.run(UPSERT_RUN_LOG, runLogLightToRow(run));
      const heavy = extractHeavy(run);
      if (heavy) {
        await adapter.run(UPSERT_RUN_ROUTE, [
          run.id,
          heavy.route ? JSON.stringify(heavy.route) : null,
          heavy.splits ? JSON.stringify(heavy.splits) : null,
          heavy.hrTimeSeries ? JSON.stringify(heavy.hrTimeSeries) : null,
          heavy.hrZoneTimes ? JSON.stringify(heavy.hrZoneTimes) : null,
          heavy.segments ? JSON.stringify(heavy.segments) : null,
          nowMs(),
        ]);
      }
    });
  },

  async saveMany(adapter, runs) {
    await adapter.transaction(async () => {
      for (const r of runs) await this.save(adapter, r);
    });
  },

  /** Return all heavy data as Map<id, heavy>. Mirrors run-store.getAllRunRoutes(). */
  async getAllRoutes(adapter) {
    const rows = await adapter.query('SELECT * FROM running_routes');
    const map = new Map();
    for (const r of rows) {
      const heavy = {};
      if (r.route_json) heavy.route = parseJson(r.route_json);
      if (r.splits_json) heavy.splits = parseJson(r.splits_json);
      if (r.hr_time_series_json) heavy.hrTimeSeries = parseJson(r.hr_time_series_json);
      if (r.hr_zone_times_json) heavy.hrZoneTimes = parseJson(r.hr_zone_times_json);
      if (r.segments_json) heavy.segments = parseJson(r.segments_json);
      map.set(r.run_id, heavy);
    }
    return map;
  },

  async loadRoute(adapter, runId) {
    const rows = await adapter.query('SELECT * FROM running_routes WHERE run_id = ?', [runId]);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      route: parseJson(r.route_json),
      splits: parseJson(r.splits_json),
      hrTimeSeries: parseJson(r.hr_time_series_json),
      hrZoneTimes: parseJson(r.hr_zone_times_json),
      segments: parseJson(r.segments_json),
    };
  },

  async delete(adapter, id) {
    await adapter.transaction(async () => {
      // FK with ON DELETE CASCADE drops the route row too.
      await adapter.run('DELETE FROM running_logs WHERE id = ?', [id]);
      await adapter.run(TOMBSTONE_SQL, ['running_logs', String(id), nowMs()]);
    });
  },
};

// ── custom_programs ───────────────────────────────────────────────────────

function rowToCustomProgram(r) {
  const program = parseJson(r.data_json, {});
  program._customId = r.custom_id;
  program._meta = parseJson(r.meta_json, program._meta);
  return program;
}

const UPSERT_CUSTOM_PROGRAM = `
  INSERT INTO custom_programs (custom_id, meta_json, data_json, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(custom_id) DO UPDATE SET
    meta_json=excluded.meta_json,
    data_json=excluded.data_json,
    updated_at=excluded.updated_at`;

export const customProgramsRepo = {
  async loadAll(adapter) {
    const rows = await adapter.query('SELECT * FROM custom_programs');
    return rows.map(rowToCustomProgram);
  },
  async save(adapter, program) {
    if (!program?._customId) throw new Error('customProgramsRepo.save: missing _customId');
    const { _customId, _meta, ...rest } = program;
    await adapter.run(UPSERT_CUSTOM_PROGRAM, [
      _customId,
      JSON.stringify(_meta || {}),
      JSON.stringify(rest),
      nowMs(),
    ]);
  },
  async delete(adapter, customId) {
    await adapter.transaction(async () => {
      await adapter.run('DELETE FROM custom_programs WHERE custom_id = ?', [customId]);
      await adapter.run(TOMBSTONE_SQL, ['custom_programs', customId, nowMs()]);
    });
  },
};

// ── settings (key-value) ──────────────────────────────────────────────────

export const settingsRepo = {
  async loadAll(adapter) {
    const rows = await adapter.query('SELECT key, value FROM settings');
    const out = {};
    for (const r of rows) {
      // values stored as JSON-encoded primitives so numbers/booleans survive roundtrip
      out[r.key] = parseJson(r.value, r.value);
    }
    return out;
  },
  async setAll(adapter, settings) {
    await adapter.transaction(async () => {
      for (const [k, v] of Object.entries(settings || {})) {
        await adapter.run(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
          [k, JSON.stringify(v)]
        );
      }
    });
  },
};

// ── deleted_records (tombstones) ──────────────────────────────────────────

export const tombstonesRepo = {
  /** Returns a flat array of record IDs (string), matching db.deletedIds shape. */
  async loadIds(adapter) {
    const rows = await adapter.query('SELECT record_id FROM deleted_records');
    return rows.map(r => r.record_id);
  },
  async addMany(adapter, ids, collection = 'workouts') {
    if (!ids?.length) return;
    await adapter.transaction(async () => {
      for (const id of ids) {
        await adapter.run(TOMBSTONE_SQL, [collection, String(id), nowMs()]);
      }
    });
  },
};

// ── meta (schema_version + migration flags) ───────────────────────────────

export const metaRepo = {
  async get(adapter, key) {
    const rows = await adapter.query('SELECT value FROM meta WHERE key = ?', [key]);
    return rows.length ? rows[0].value : null;
  },
  async set(adapter, key, value) {
    await adapter.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [key, value]
    );
  },
};
