/**
 * Strength workout schema v5 — types, validator, and legacy parser.
 *
 * v4 → v5 changes:
 *  - `kg` and `reps` go from free-text strings to numbers (with `repsMax` for ranges).
 *  - New optional fields: rpe, rir, tempo, restSec, completedAt, isWarmup, isFailure.
 *  - New workout-level fields: startedAt, endedAt, durationSec, bodyweightKg.
 *  - New exercise field: exerciseId (canonical slug from exercise-catalog).
 *
 * Migration is additive and reversible — v4 strings are preserved in `set._raw`
 * for one schema version so a broken parser can be diagnosed without data loss.
 *
 * @typedef {Object} SetV5
 * @property {number|null} kg              Weight in kilograms. null for bodyweight-only.
 * @property {number|null} reps            Repetition count. null for time-based sets.
 * @property {number|null} [repsMax]       Upper bound when the prescription was a range (e.g. "10-12" → reps:10, repsMax:12).
 * @property {number|null} [durationSec]   Duration in seconds when the set is time-based (e.g. "18:32" plank, "30s" swing).
 * @property {number}      [rpe]           Rate of Perceived Exertion (1-10, Borg CR10).
 * @property {number}      [rir]           Reps In Reserve (0-5). Mutually exclusive with rpe in practice.
 * @property {string}      [tempo]         4-digit tempo like "30X1" (eccentric-pause-concentric-pause).
 * @property {number}      [restSec]       Seconds of rest AFTER this set.
 * @property {number}      [completedAt]   Epoch ms when the set was marked done.
 * @property {boolean}     [isWarmup]      Distinguishes warm-up sets from working sets.
 * @property {boolean}     [isFailure]     Set carried to muscular failure.
 * @property {string}      [_raw]          Original v4 string preserved through migration. Deprecated in v6.
 *
 * @typedef {Object} ExerciseV5
 * @property {string}   name              Display name (may be free text; legacy).
 * @property {string|null} [exerciseId]   Canonical slug from exercise-catalog.js. null = no match.
 * @property {string}   [type]            "main" | "assist" | "extra" | "hiit" | "density"
 * @property {string}   [mode]            "sets" | "result" | "interval" | "tabata" | "rounds" | "ladder" | "pyramid" | "amrap" | "emom" | "superset"
 * @property {SetV5[]}  sets
 * @property {number}   [rounds]
 * @property {string}   [rest]            Free-text rest (legacy HIIT field).
 * @property {object[]} [exercises]       Sub-exercises (legacy HIIT field).
 *
 * @typedef {Object} WorkoutV5
 * @property {number}        id
 * @property {string}        date          "YYYY-MM-DD" (legacy, conserved alongside startedAt).
 * @property {string}        session
 * @property {number}        phase
 * @property {string}        program
 * @property {string}        [notes]
 * @property {number}        [startedAt]   Epoch ms. Real when set by training.js; estimated (midday local) when migrated.
 * @property {number}        [endedAt]     Epoch ms.
 * @property {number}        [durationSec] Denormalized for fast queries.
 * @property {number}        [bodyweightKg]
 * @property {ExerciseV5[]}  exercises
 * @property {object[]}      [prs]
 * @property {boolean}       [_historical] true when migrated from v4 with estimated timestamps.
 */

import { findExerciseId } from './exercise-catalog.js';

/**
 * Parse a legacy v4 set object `{ kg: string, reps: string }` into v5 numeric fields.
 *
 * Patterns observed in real workouts (audit 2026-05-14):
 *  - "5"            → { reps: 5 }
 *  - "10-12"        → { reps: 10, repsMax: 12 }
 *  - "10/12"        → { reps: 10, repsMax: 12 }
 *  - "18:32"        → { durationSec: 1112 }     (mm:ss, common for plank/timed work)
 *  - "30s"          → { durationSec: 30 }       (e.g. "30s/lado")
 *  - "1min"         → { durationSec: 60 }
 *  - "4R · 18:32"   → { reps: 4, durationSec: 1112 }  (rounds + total time)
 *  - "" / null      → { reps: null }
 *
 * The original string is conserved in `_raw` for one schema version so a
 * broken parser can be diagnosed without data loss.
 *
 * @param {{ kg?: string|number, reps?: string|number }} legacySet
 * @returns {SetV5}
 */
export function parseLegacySet(legacySet) {
  const raw = legacySet || {};
  const out = { kg: null, reps: null, _raw: { kg: raw.kg ?? '', reps: raw.reps ?? '' } };

  // ── kg ────────────────────────────────────────────────
  const kgRaw = String(raw.kg ?? '').trim().replace(',', '.');
  if (kgRaw === '') {
    out.kg = null;
  } else {
    const n = parseFloat(kgRaw);
    out.kg = Number.isFinite(n) ? n : null;
  }

  // ── reps ──────────────────────────────────────────────
  const repsRaw = String(raw.reps ?? '').trim().toLowerCase();
  if (repsRaw === '') {
    out.reps = null;
    return out;
  }

  // "4R · 18:32" / "4r 18:32" — rounds + total time
  const roundsTime = repsRaw.match(/^(\d+)\s*r[\s·.,-]+(\d+):(\d{1,2})/);
  if (roundsTime) {
    out.reps = parseInt(roundsTime[1], 10);
    out.durationSec = parseInt(roundsTime[2], 10) * 60 + parseInt(roundsTime[3], 10);
    return out;
  }

  // "mm:ss" pure duration (no leading rep count)
  const mmss = repsRaw.match(/^(\d+):(\d{1,2})$/);
  if (mmss) {
    out.reps = null;
    out.durationSec = parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
    return out;
  }

  // "30s" / "45 seg" / "1min" / "2 min" / "1h"
  const durUnit = repsRaw.match(/^(\d+(?:\.\d+)?)\s*(s|seg|m|min|h|hr)\b/);
  if (durUnit) {
    const val = parseFloat(durUnit[1]);
    const unit = durUnit[2];
    let secs = val;
    if (unit === 'm' || unit === 'min') secs = val * 60;
    else if (unit === 'h' || unit === 'hr') secs = val * 3600;
    out.reps = null;
    out.durationSec = Math.round(secs);
    return out;
  }

  // "10-12" / "10–12" / "10 a 12" / "10/12" — range
  const range = repsRaw.match(/^(\d+)\s*(?:-|–|\/|a)\s*(\d+)/);
  if (range) {
    out.reps = parseInt(range[1], 10);
    out.repsMax = parseInt(range[2], 10);
    return out;
  }

  // Plain number (possibly with trailing "/lado", "x", suffix — take the leading int)
  const plain = repsRaw.match(/^(\d+)/);
  if (plain) {
    out.reps = parseInt(plain[1], 10);
    return out;
  }

  // Unparseable free text ("Total reps", "Práctica", etc.) — keep null, _raw conserves it.
  return out;
}

/**
 * Migrate one v4 workout to v5 in place.
 * Idempotent: a v5 workout passed in is returned unchanged.
 *
 * @param {object} w  A workout object from `db.workouts`.
 * @returns {WorkoutV5}
 */
export function migrateWorkoutV4ToV5(w) {
  if (!w || typeof w !== 'object') return w;
  if (w._schemaV5) return w;  // already migrated

  // Sets: parse legacy strings to numeric fields
  for (const ex of (w.exercises || [])) {
    if (Array.isArray(ex.sets)) {
      ex.sets = ex.sets.map(s => {
        // If already migrated (has _raw + numeric kg/reps), pass through.
        if (s && s._raw && (typeof s.kg === 'number' || s.kg === null)) return s;
        return parseLegacySet(s);
      });
    }
    // Canonical exerciseId from free-text name
    if (ex.name && ex.exerciseId === undefined) {
      ex.exerciseId = findExerciseId(ex.name);
    }
  }

  // Estimate startedAt from `date` (midday local) if missing.
  // Mark as historical so exporters know this timestamp is approximate.
  if (!w.startedAt && w.date) {
    const ts = Date.parse(w.date + 'T12:00:00');
    if (Number.isFinite(ts)) {
      w.startedAt = ts;
      w._historical = true;
    }
  }

  w._schemaV5 = true;
  return w;
}

/**
 * Strip per-set `_raw` field. Run this when bumping to v6 (one version later)
 * once we're confident the parser handled everything. NOT called automatically.
 * @param {WorkoutV5} w
 */
export function dropRawFromWorkout(w) {
  for (const ex of (w.exercises || [])) {
    for (const s of (ex.sets || [])) {
      if (s && '_raw' in s) delete s._raw;
    }
  }
  return w;
}

/**
 * Validate a v5 workout structure. Returns null when valid, otherwise a
 * human-readable error string. Cheap: used in tests + during dev to detect
 * regressions when training.js evolves.
 *
 * @param {object} w
 * @returns {string|null}
 */
export function validateWorkoutV5(w) {
  if (!w || typeof w !== 'object') return 'Workout no es un objeto';
  if (w.id == null) return 'Workout sin id';
  if (typeof w.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) return 'date debe ser "YYYY-MM-DD"';
  if (!Array.isArray(w.exercises)) return 'exercises debe ser un array';

  if (w.startedAt != null && !Number.isFinite(w.startedAt)) return 'startedAt debe ser número (epoch ms)';
  if (w.endedAt != null && !Number.isFinite(w.endedAt)) return 'endedAt debe ser número (epoch ms)';
  if (w.startedAt != null && w.endedAt != null && w.endedAt < w.startedAt) return 'endedAt < startedAt';
  if (w.durationSec != null && (!Number.isFinite(w.durationSec) || w.durationSec < 0)) return 'durationSec inválido';

  for (let i = 0; i < w.exercises.length; i++) {
    const ex = w.exercises[i];
    if (!ex || typeof ex !== 'object') return `Exercise #${i} no es objeto`;
    if (!ex.name) return `Exercise #${i} sin name`;
    if (!Array.isArray(ex.sets)) return `Exercise #${i} sin sets[]`;

    for (let j = 0; j < ex.sets.length; j++) {
      const s = ex.sets[j];
      if (!s || typeof s !== 'object') return `Set ${i}.${j} no es objeto`;
      if (s.kg != null && !Number.isFinite(s.kg)) return `Set ${i}.${j} kg debe ser número o null (got ${typeof s.kg})`;
      if (s.reps != null && !Number.isFinite(s.reps)) return `Set ${i}.${j} reps debe ser número o null (got ${typeof s.reps})`;
      if (s.repsMax != null) {
        if (!Number.isFinite(s.repsMax)) return `Set ${i}.${j} repsMax debe ser número`;
        if (s.reps != null && s.repsMax < s.reps) return `Set ${i}.${j} repsMax < reps`;
      }
      if (s.rpe != null && (!Number.isFinite(s.rpe) || s.rpe < 0 || s.rpe > 10)) return `Set ${i}.${j} rpe fuera de 0-10`;
      if (s.rir != null && (!Number.isFinite(s.rir) || s.rir < 0)) return `Set ${i}.${j} rir inválido`;
      if (s.restSec != null && (!Number.isFinite(s.restSec) || s.restSec < 0)) return `Set ${i}.${j} restSec inválido`;
    }
  }
  return null;
}
