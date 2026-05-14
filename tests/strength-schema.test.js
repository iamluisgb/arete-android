import { describe, it, expect } from 'vitest';
import {
  parseLegacySet,
  migrateWorkoutV4ToV5,
  validateWorkoutV5,
  dropRawFromWorkout,
} from '../www/js/strength-schema.js';

describe('parseLegacySet', () => {
  it('parses plain integer reps', () => {
    expect(parseLegacySet({ kg: '80', reps: '5' })).toMatchObject({ kg: 80, reps: 5 });
  });

  it('handles empty fields', () => {
    expect(parseLegacySet({ kg: '', reps: '' })).toMatchObject({ kg: null, reps: null });
  });

  it('parses ranges "10-12"', () => {
    expect(parseLegacySet({ kg: '40', reps: '10-12' })).toMatchObject({ kg: 40, reps: 10, repsMax: 12 });
  });

  it('parses ranges with en-dash "10–12"', () => {
    expect(parseLegacySet({ kg: '40', reps: '10–12' })).toMatchObject({ kg: 40, reps: 10, repsMax: 12 });
  });

  it('parses ranges with slash "10/12"', () => {
    expect(parseLegacySet({ kg: '40', reps: '10/12' })).toMatchObject({ reps: 10, repsMax: 12 });
  });

  it('parses pure mm:ss as duration', () => {
    const r = parseLegacySet({ kg: '', reps: '18:32' });
    expect(r.reps).toBeNull();
    expect(r.durationSec).toBe(18 * 60 + 32);
  });

  it('parses "4R · 18:32" as rounds + duration', () => {
    const r = parseLegacySet({ kg: '24', reps: '4R · 18:32' });
    expect(r).toMatchObject({ kg: 24, reps: 4, durationSec: 1112 });
  });

  it('parses "30s" as 30 second duration', () => {
    const r = parseLegacySet({ kg: '20', reps: '30s' });
    expect(r.durationSec).toBe(30);
    expect(r.reps).toBeNull();
  });

  it('parses "1min" as 60 second duration', () => {
    expect(parseLegacySet({ kg: '', reps: '1min' }).durationSec).toBe(60);
  });

  it('parses "30s/lado" stripping the per-side suffix', () => {
    expect(parseLegacySet({ kg: '16', reps: '30s/lado' }).durationSec).toBe(30);
  });

  it('extracts leading number from "8/lado"', () => {
    expect(parseLegacySet({ kg: '24', reps: '8/lado' }).reps).toBe(8);
  });

  it('handles decimal kg with comma "80,5"', () => {
    expect(parseLegacySet({ kg: '80,5', reps: '5' }).kg).toBe(80.5);
  });

  it('handles decimal kg with dot "80.5"', () => {
    expect(parseLegacySet({ kg: '80.5', reps: '5' }).kg).toBe(80.5);
  });

  it('returns null reps for unparseable free text like "Total reps"', () => {
    const r = parseLegacySet({ kg: '', reps: 'Total reps' });
    expect(r.reps).toBeNull();
    expect(r._raw.reps).toBe('Total reps');
  });

  it('always preserves the original strings in _raw', () => {
    const r = parseLegacySet({ kg: '80', reps: '10-12' });
    expect(r._raw).toEqual({ kg: '80', reps: '10-12' });
  });

  it('handles null/undefined input', () => {
    expect(parseLegacySet(null)).toMatchObject({ kg: null, reps: null });
    expect(parseLegacySet(undefined)).toMatchObject({ kg: null, reps: null });
  });
});

describe('migrateWorkoutV4ToV5', () => {
  it('typechecks sets from a real v4 workout', () => {
    const v4 = {
      id: 1715000000000,
      date: '2026-05-10',
      session: 'Sesión A',
      phase: 1,
      program: 'arete',
      exercises: [
        { name: 'Sentadilla', sets: [{ kg: '80', reps: '5' }, { kg: '80', reps: '5' }] },
        { name: 'Curl con Barra', sets: [{ kg: '20', reps: '10-12' }] },
      ],
    };
    migrateWorkoutV4ToV5(v4);
    expect(validateWorkoutV5(v4)).toBeNull();
    expect(v4.exercises[0].sets[0].kg).toBe(80);
    expect(v4.exercises[0].sets[0].reps).toBe(5);
    expect(v4.exercises[1].sets[0].repsMax).toBe(12);
  });

  it('assigns exerciseId from name when in catalog', () => {
    const v4 = {
      id: 1, date: '2026-05-10', session: 'A', phase: 1, program: 'arete',
      exercises: [{ name: 'Sentadilla', sets: [{ kg: '80', reps: '5' }] }],
    };
    migrateWorkoutV4ToV5(v4);
    expect(v4.exercises[0].exerciseId).toBe('back_squat');
  });

  it('leaves exerciseId as null when name not in catalog', () => {
    const v4 = {
      id: 1, date: '2026-05-10', session: 'A', phase: 1, program: 'arete',
      exercises: [{ name: 'Ejercicio Misterioso XYZ', sets: [{ kg: '', reps: '10' }] }],
    };
    migrateWorkoutV4ToV5(v4);
    expect(v4.exercises[0].exerciseId).toBeNull();
  });

  it('matches accent-insensitive (Sentadilla Búlgara → bulgarian_squat)', () => {
    const v4 = {
      id: 1, date: '2026-05-10', session: 'A', phase: 1, program: 'arete',
      exercises: [{ name: 'Sentadilla Búlgara', sets: [{ kg: '20', reps: '10' }] }],
    };
    migrateWorkoutV4ToV5(v4);
    expect(v4.exercises[0].exerciseId).toBe('bulgarian_squat');
  });

  it('reconstructs startedAt from date and flags _historical', () => {
    const v4 = {
      id: 1, date: '2026-05-10', session: 'A', phase: 1, program: 'arete',
      exercises: [{ name: 'Sentadilla', sets: [{ kg: '80', reps: '5' }] }],
    };
    migrateWorkoutV4ToV5(v4);
    expect(v4.startedAt).toBe(Date.parse('2026-05-10T12:00:00'));
    expect(v4._historical).toBe(true);
  });

  it('is idempotent — running twice produces the same result', () => {
    const v4 = {
      id: 1, date: '2026-05-10', session: 'A', phase: 1, program: 'arete',
      exercises: [{ name: 'Sentadilla', sets: [{ kg: '80', reps: '5' }] }],
    };
    migrateWorkoutV4ToV5(v4);
    const snapshot = JSON.parse(JSON.stringify(v4));
    migrateWorkoutV4ToV5(v4);
    expect(v4).toEqual(snapshot);
  });

  it('preserves _raw on every migrated set', () => {
    const v4 = {
      id: 1, date: '2026-05-10', session: 'A', phase: 1, program: 'arete',
      exercises: [{ name: 'Sentadilla', sets: [{ kg: '80', reps: '5' }] }],
    };
    migrateWorkoutV4ToV5(v4);
    expect(v4.exercises[0].sets[0]._raw).toEqual({ kg: '80', reps: '5' });
  });
});

describe('validateWorkoutV5', () => {
  const good = () => ({
    id: 1, date: '2026-05-10', session: 'A', phase: 1, program: 'arete',
    exercises: [{ name: 'Sentadilla', sets: [{ kg: 80, reps: 5 }] }],
  });

  it('accepts a clean v5 workout', () => {
    expect(validateWorkoutV5(good())).toBeNull();
  });

  it('rejects string kg', () => {
    const w = good();
    w.exercises[0].sets[0].kg = '80';
    expect(validateWorkoutV5(w)).toMatch(/kg debe ser número/);
  });

  it('rejects rpe outside 0-10', () => {
    const w = good();
    w.exercises[0].sets[0].rpe = 11;
    expect(validateWorkoutV5(w)).toMatch(/rpe fuera/);
  });

  it('rejects bad date format', () => {
    const w = good();
    w.date = '10-05-2026';
    expect(validateWorkoutV5(w)).toMatch(/date/);
  });

  it('rejects endedAt before startedAt', () => {
    const w = good();
    w.startedAt = 2000; w.endedAt = 1000;
    expect(validateWorkoutV5(w)).toMatch(/endedAt < startedAt/);
  });

  it('rejects repsMax smaller than reps', () => {
    const w = good();
    w.exercises[0].sets[0].repsMax = 3;  // reps is 5
    expect(validateWorkoutV5(w)).toMatch(/repsMax < reps/);
  });

  it('accepts null kg for bodyweight exercises', () => {
    const w = good();
    w.exercises[0].sets[0] = { kg: null, reps: 10 };
    expect(validateWorkoutV5(w)).toBeNull();
  });
});

describe('dropRawFromWorkout', () => {
  it('strips _raw from every set', () => {
    const w = {
      id: 1, date: '2026-05-10', exercises: [
        { name: 'Sentadilla', sets: [{ kg: 80, reps: 5, _raw: { kg: '80', reps: '5' } }] },
      ],
    };
    dropRawFromWorkout(w);
    expect(w.exercises[0].sets[0]._raw).toBeUndefined();
    expect(w.exercises[0].sets[0].kg).toBe(80);
  });
});
