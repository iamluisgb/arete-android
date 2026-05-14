import { describe, it, expect, beforeEach } from 'vitest';
import { createTestAdapter } from './_sqljs-adapter.js';
import { migrateSchema } from '../www/js/db/schema.js';
import {
  workoutsRepo,
  bodyLogsRepo,
  runningLogsRepo,
  customProgramsRepo,
  settingsRepo,
  tombstonesRepo,
  metaRepo,
} from '../www/js/db/repos.js';

let adapter;
beforeEach(async () => {
  ({ adapter } = await createTestAdapter());
  await migrateSchema(adapter);
});

const sampleWorkout = () => ({
  id: 1715688000000,
  date: '2026-05-10',
  session: 'Día 1 · Fuerza',
  phase: 2,
  program: 'arete',
  notes: 'RPE alto',
  startedAt: 1778414400000,
  endedAt: 1778418900000,
  durationSec: 4500,
  exercises: [
    { name: 'Sentadilla', exerciseId: 'back_squat', sets: [
      { kg: 80, reps: 5, rpe: 8 },
      { kg: 85, reps: 5 },
    ]},
  ],
  prs: [{ exercise: 'Sentadilla', kg: 85, prevKg: 80 }],
});

describe('workoutsRepo', () => {
  it('round-trips a workout through save and loadAll', async () => {
    const w = sampleWorkout();
    await workoutsRepo.save(adapter, w);
    const [loaded] = await workoutsRepo.loadAll(adapter);
    expect(loaded.id).toBe(w.id);
    expect(loaded.session).toBe(w.session);
    expect(loaded.exercises).toEqual(w.exercises);
    expect(loaded.prs).toEqual(w.prs);
    expect(loaded.startedAt).toBe(w.startedAt);
    expect(loaded.durationSec).toBe(w.durationSec);
  });

  it('preserves _historical flag through round-trip', async () => {
    const w = { ...sampleWorkout(), _historical: true };
    await workoutsRepo.save(adapter, w);
    const [loaded] = await workoutsRepo.loadAll(adapter);
    expect(loaded._historical).toBe(true);
  });

  it('upserts on save when id matches', async () => {
    const w = sampleWorkout();
    await workoutsRepo.save(adapter, w);
    await workoutsRepo.save(adapter, { ...w, notes: 'edited' });
    const rows = await workoutsRepo.loadAll(adapter);
    expect(rows.length).toBe(1);
    expect(rows[0].notes).toBe('edited');
  });

  it('saveMany inserts in one transaction', async () => {
    const ws = [
      { ...sampleWorkout(), id: 1 },
      { ...sampleWorkout(), id: 2 },
      { ...sampleWorkout(), id: 3 },
    ];
    await workoutsRepo.saveMany(adapter, ws);
    const rows = await workoutsRepo.loadAll(adapter);
    expect(rows.length).toBe(3);
  });

  it('orders by date DESC, id DESC', async () => {
    await workoutsRepo.saveMany(adapter, [
      { ...sampleWorkout(), id: 1, date: '2026-05-08' },
      { ...sampleWorkout(), id: 2, date: '2026-05-10' },
      { ...sampleWorkout(), id: 3, date: '2026-05-09' },
    ]);
    const rows = await workoutsRepo.loadAll(adapter);
    expect(rows.map(r => r.id)).toEqual([2, 3, 1]);
  });

  it('delete drops the row and writes a tombstone', async () => {
    const w = sampleWorkout();
    await workoutsRepo.save(adapter, w);
    await workoutsRepo.delete(adapter, w.id);
    expect((await workoutsRepo.loadAll(adapter)).length).toBe(0);
    const ids = await tombstonesRepo.loadIds(adapter);
    expect(ids).toContain(String(w.id));
  });
});

// ── body_logs ────────────────────────────────────────────────────────────

describe('bodyLogsRepo', () => {
  it('round-trips arbitrary measurements via measurements_json', async () => {
    const log = {
      id: 1,
      date: '2026-05-10',
      weight: 78.5,
      waist: 82,
      chest: 102,
      notes: 'morning',
    };
    await bodyLogsRepo.save(adapter, log);
    const [loaded] = await bodyLogsRepo.loadAll(adapter);
    expect(loaded.weight).toBe(78.5);
    expect(loaded.waist).toBe(82);
    expect(loaded.chest).toBe(102);
    expect(loaded.notes).toBe('morning');
  });

  it('saveMany + delete works as in workouts', async () => {
    await bodyLogsRepo.saveMany(adapter, [
      { id: 1, date: '2026-05-08', weight: 78 },
      { id: 2, date: '2026-05-09', weight: 78.2 },
    ]);
    await bodyLogsRepo.delete(adapter, 1);
    const rows = await bodyLogsRepo.loadAll(adapter);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(2);
  });
});

// ── running_logs / running_routes (split light/heavy) ────────────────────

describe('runningLogsRepo', () => {
  const sampleRun = () => ({
    id: 100,
    date: '2026-05-10',
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
    notes: 'fluido',
    route: { coords: [[40.4168, -3.7038, 650, 1715688000000]] },
    splits: [{ km: 1, time: 360, pace: 360 }],
    hrTimeSeries: [[1715688000000, 130], [1715688005000, 145]],
    hrZoneTimes: { zone2: 3000, zone3: 600 },
    segments: [],
  });

  it('save splits light fields into running_logs and heavy into running_routes', async () => {
    await runningLogsRepo.save(adapter, sampleRun());
    const [light] = await runningLogsRepo.loadAll(adapter);
    expect(light.distance).toBe(10.05);
    expect(light.route).toBeUndefined();   // light shape has no heavy
    expect(light.splits).toBeUndefined();
    const heavy = await runningLogsRepo.loadRoute(adapter, 100);
    expect(heavy.route.coords[0][0]).toBe(40.4168);
    expect(heavy.splits[0].km).toBe(1);
    expect(heavy.hrTimeSeries.length).toBe(2);
    expect(heavy.hrZoneTimes.zone2).toBe(3000);
  });

  it('save without heavy fields does not create a routes row', async () => {
    const { route, splits, hrTimeSeries, hrZoneTimes, segments, ...lightOnly } = sampleRun();
    await runningLogsRepo.save(adapter, lightOnly);
    const heavy = await runningLogsRepo.loadRoute(adapter, lightOnly.id);
    expect(heavy).toBeNull();
  });

  it('getAllRoutes returns Map<id, heavy>', async () => {
    await runningLogsRepo.save(adapter, sampleRun());
    await runningLogsRepo.save(adapter, { ...sampleRun(), id: 101 });
    const map = await runningLogsRepo.getAllRoutes(adapter);
    expect(map.size).toBe(2);
    expect(map.get(100).route.coords.length).toBe(1);
  });

  it('delete cascades to running_routes via FK', async () => {
    await runningLogsRepo.save(adapter, sampleRun());
    await runningLogsRepo.delete(adapter, 100);
    const heavy = await runningLogsRepo.loadRoute(adapter, 100);
    expect(heavy).toBeNull();
    const ids = await tombstonesRepo.loadIds(adapter);
    expect(ids).toContain('100');
  });
});

// ── custom_programs ──────────────────────────────────────────────────────

describe('customProgramsRepo', () => {
  it('round-trips a program preserving _customId and _meta', async () => {
    const program = {
      _customId: 'custom_kettle_xyz',
      _meta: { name: 'KB custom', sport: 'strength' },
      1: { name: 'Fase 1', sessions: { A: [{ name: 'Swing', sets: 5, reps: '10' }] } },
    };
    await customProgramsRepo.save(adapter, program);
    const [loaded] = await customProgramsRepo.loadAll(adapter);
    expect(loaded._customId).toBe('custom_kettle_xyz');
    expect(loaded._meta.name).toBe('KB custom');
    expect(loaded[1].sessions.A[0].name).toBe('Swing');
  });

  it('throws when saving a program without _customId', async () => {
    await expect(customProgramsRepo.save(adapter, { _meta: {} }))
      .rejects.toThrow(/missing _customId/);
  });
});

// ── settings ─────────────────────────────────────────────────────────────

describe('settingsRepo', () => {
  it('preserves number / string / boolean types', async () => {
    await settingsRepo.setAll(adapter, { height: 175, age: 32, race5k: 0, enabled: true, who: 'luis' });
    const all = await settingsRepo.loadAll(adapter);
    expect(all.height).toBe(175);
    expect(all.age).toBe(32);
    expect(all.race5k).toBe(0);
    expect(all.enabled).toBe(true);
    expect(all.who).toBe('luis');
  });

  it('upserts when called twice', async () => {
    await settingsRepo.setAll(adapter, { height: 175 });
    await settingsRepo.setAll(adapter, { height: 180 });
    expect((await settingsRepo.loadAll(adapter)).height).toBe(180);
  });
});

// ── meta ─────────────────────────────────────────────────────────────────

describe('metaRepo', () => {
  it('get/set survives round-trip', async () => {
    await metaRepo.set(adapter, 'migration_completed', '2026-05-14');
    expect(await metaRepo.get(adapter, 'migration_completed')).toBe('2026-05-14');
  });

  it('returns null for unknown keys', async () => {
    expect(await metaRepo.get(adapter, 'nope')).toBeNull();
  });
});

// ── tombstones ───────────────────────────────────────────────────────────

describe('tombstonesRepo', () => {
  it('addMany inserts multiple ids', async () => {
    await tombstonesRepo.addMany(adapter, ['1', '2', '3']);
    const ids = await tombstonesRepo.loadIds(adapter);
    expect(ids.sort()).toEqual(['1', '2', '3']);
  });

  it('is idempotent on the same (collection, record_id)', async () => {
    await tombstonesRepo.addMany(adapter, ['1', '1', '1']);
    expect((await tombstonesRepo.loadIds(adapter)).length).toBe(1);
  });
});
