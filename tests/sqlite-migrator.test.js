import { describe, it, expect, beforeEach } from 'vitest';
import { createTestAdapter } from './_sqljs-adapter.js';
import { migrateSchema } from '../www/js/db/schema.js';
import {
  migrateFromData,
  isMigrationCompleted,
} from '../www/js/db/migrator.js';
import {
  workoutsRepo,
  bodyLogsRepo,
  runningLogsRepo,
  customProgramsRepo,
  settingsRepo,
  tombstonesRepo,
} from '../www/js/db/repos.js';

let adapter;
beforeEach(async () => {
  ({ adapter } = await createTestAdapter());
  await migrateSchema(adapter);
});

/** A representative v5 db blob shaped exactly as loadDB() returns it. */
function realisticDB() {
  return {
    schemaVersion: 5,
    program: 'arete',
    phase: 2,
    workouts: [
      {
        id: 1715000000000,
        date: '2026-05-08',
        session: 'Día 1 · Superior',
        phase: 2,
        program: 'arete',
        notes: 'fluido',
        startedAt: 1778414400000,
        endedAt: 1778418900000,
        durationSec: 4500,
        exercises: [
          { name: 'Press Banca', exerciseId: 'bench_press', sets: [
            { kg: 80, reps: 5 }, { kg: 85, reps: 5 },
          ]},
        ],
        prs: [{ exercise: 'Press Banca', kg: 85, prevKg: 82.5 }],
      },
      {
        id: 1715000060000,
        date: '2026-05-10',
        session: 'Día 2 · Inferior',
        phase: 2,
        program: 'arete',
        exercises: [
          { name: 'Sentadilla', exerciseId: 'back_squat', sets: [
            { kg: 100, reps: 5 },
          ]},
        ],
      },
    ],
    bodyLogs: [
      { id: 2000000000000, date: '2026-05-09', weight: 78.5, waist: 82, notes: 'morning' },
    ],
    runningLogs: [
      {
        id: 3000000000000,
        date: '2026-05-09',
        session: 'easy',
        program: 'media-maraton-1h40',
        week: 3,
        type: 'zona2',
        distance: 10.05,
        duration: 3600,
        pace: 358,
        hr: 145,
        hrMax: 165,
        elevation: 120,
        source: 'gps',
      },
      {
        id: 3000000060000,
        date: '2026-05-12',
        session: 'tempo',
        type: 'tempo',
        distance: 6.0,
        duration: 1620,
        pace: 270,
        source: 'manual',
      },
    ],
    customPrograms: [
      {
        _customId: 'custom_kettle_123',
        _meta: { name: 'KB custom', sport: 'strength' },
        1: { name: 'Fase 1', sessions: { A: [{ name: 'Swing', sets: 5, reps: '10' }] } },
      },
    ],
    settings: { height: 175, age: 32, race5k: 0, maxHR: 188 },
    deletedIds: ['del-1', 'del-2', 'del-3'],
  };
}

function realisticRoutes() {
  return new Map([
    [3000000000000, {
      route: { coords: [[40.4168, -3.7038, 650, 1715688000000]] },
      splits: [{ km: 1, time: 358, pace: 358 }],
      hrTimeSeries: [[1715688000000, 130]],
      hrZoneTimes: { zone2: 3000 },
      segments: [],
    }],
    // run #2 has no heavy data (manual run)
  ]);
}

describe('migrateFromData', () => {
  it('writes every collection into SQLite and returns stats', async () => {
    const db = realisticDB();
    const result = await migrateFromData(adapter, db, realisticRoutes());
    expect(result).toMatchObject({
      skipped: false,
      workouts: 2,
      runs: 2,
      bodyLogs: 1,
      customPrograms: 1,
      settings: 4,
      tombstones: 3,
    });
  });

  it('marks migration_completed in meta', async () => {
    await migrateFromData(adapter, realisticDB(), realisticRoutes());
    expect(await isMigrationCompleted(adapter)).toBe(true);
  });

  it('is idempotent — second call returns skipped:true and does not duplicate data', async () => {
    await migrateFromData(adapter, realisticDB(), realisticRoutes());
    const second = await migrateFromData(adapter, realisticDB(), realisticRoutes());
    expect(second).toEqual({ skipped: true });

    expect((await workoutsRepo.loadAll(adapter)).length).toBe(2);
    expect((await runningLogsRepo.loadAll(adapter)).length).toBe(2);
  });

  it('round-trips workouts with full v5 shape preserved', async () => {
    await migrateFromData(adapter, realisticDB(), realisticRoutes());
    const ws = await workoutsRepo.loadAll(adapter);
    const pressBanca = ws.find(w => w.id === 1715000000000);
    expect(pressBanca.exercises[0].exerciseId).toBe('bench_press');
    expect(pressBanca.exercises[0].sets[0].kg).toBe(80);
    expect(pressBanca.prs[0].kg).toBe(85);
    expect(pressBanca.startedAt).toBe(1778414400000);
  });

  it('splits running heavy fields into running_routes', async () => {
    await migrateFromData(adapter, realisticDB(), realisticRoutes());
    const heavy = await runningLogsRepo.loadRoute(adapter, 3000000000000);
    expect(heavy.route.coords[0][0]).toBe(40.4168);
    expect(heavy.splits[0].km).toBe(1);
    expect(heavy.hrZoneTimes.zone2).toBe(3000);
  });

  it('does not create running_routes row when the run has no heavy data', async () => {
    await migrateFromData(adapter, realisticDB(), realisticRoutes());
    const heavy = await runningLogsRepo.loadRoute(adapter, 3000000060000);
    expect(heavy).toBeNull();
  });

  it('migrates settings preserving primitive types', async () => {
    await migrateFromData(adapter, realisticDB(), realisticRoutes());
    const s = await settingsRepo.loadAll(adapter);
    expect(s.height).toBe(175);
    expect(s.age).toBe(32);
    expect(s.race5k).toBe(0);
    expect(s.maxHR).toBe(188);
  });

  it('migrates deletedIds into the tombstones table', async () => {
    await migrateFromData(adapter, realisticDB(), realisticRoutes());
    const ids = await tombstonesRepo.loadIds(adapter);
    expect(ids.sort()).toEqual(['del-1', 'del-2', 'del-3']);
  });

  it('migrates custom programs preserving _customId + _meta', async () => {
    await migrateFromData(adapter, realisticDB(), realisticRoutes());
    const [cp] = await customProgramsRepo.loadAll(adapter);
    expect(cp._customId).toBe('custom_kettle_123');
    expect(cp._meta.name).toBe('KB custom');
  });

  it('handles an empty db without crashing', async () => {
    const result = await migrateFromData(adapter, {
      workouts: [], bodyLogs: [], runningLogs: [], customPrograms: [], deletedIds: [], settings: {},
    });
    expect(result).toMatchObject({ skipped: false, workouts: 0, runs: 0 });
    expect(await isMigrationCompleted(adapter)).toBe(true);
  });

  it('throws when db is not an object', async () => {
    await expect(migrateFromData(adapter, null)).rejects.toThrow(/not an object/);
  });

  it('skips runs that have a missing route entry in the routes map', async () => {
    // db has run 3000000000000 but the routes map is empty
    await migrateFromData(adapter, realisticDB(), new Map());
    // The light row is written, but no heavy row exists
    const heavy = await runningLogsRepo.loadRoute(adapter, 3000000000000);
    expect(heavy).toBeNull();
    expect((await runningLogsRepo.loadAll(adapter)).length).toBe(2);
  });

  it('a corrupted record_completion (manual meta delete) re-runs idempotently', async () => {
    await migrateFromData(adapter, realisticDB(), realisticRoutes());
    // Simulate someone clearing the flag (or pre-migration state)
    await adapter.run("DELETE FROM meta WHERE key='migration_completed'");
    const second = await migrateFromData(adapter, realisticDB(), realisticRoutes());
    expect(second).toMatchObject({ skipped: false, workouts: 2 });
    // Still only 2 workouts (UPSERT semantics)
    expect((await workoutsRepo.loadAll(adapter)).length).toBe(2);
  });
});
