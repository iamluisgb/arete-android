// @vitest-environment jsdom
//
// Tests for www/js/data.js — the public facade.
// Covers the PWA path (localStorage) end-to-end and the serial save queue.
// The Android (SQLite) path is exercised by the lower-level migrator/repos
// tests and validated on-device in sub-phase D.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadDB,
  saveDB,
  validateDB,
  validateImportData,
  pruneDeletedIds,
  markDeleted,
  setOnSave,
  getSaveRevision,
  getPreMigrationBackup,
  restorePreMigrationBackup,
} from '../www/js/data.js';

beforeEach(() => {
  localStorage.clear();
  // Reset the OnSave callback between tests so previous tests don't leak.
  setOnSave(null);
});

describe('loadDB (PWA path)', () => {
  it('returns DEFAULTS when localStorage is empty', async () => {
    const db = await loadDB();
    expect(db.schemaVersion).toBe(5);
    expect(db.program).toBe('arete');
    expect(db.phase).toBe(1);
    expect(db.workouts).toEqual([]);
    expect(db.settings.height).toBe(175);
  });

  it('returns DEFAULTS when localStorage is corrupt', async () => {
    localStorage.setItem('arete', '{not json');
    const db = await loadDB();
    expect(db.schemaVersion).toBe(5);
    expect(db.workouts).toEqual([]);
  });

  it('loads + applies migrations on a v4 blob', async () => {
    const v4 = {
      schemaVersion: 4,
      program: 'arete',
      phase: 1,
      workouts: [{
        id: 1, date: '2026-05-10', session: 'A', phase: 1, program: 'arete',
        exercises: [{ name: 'Sentadilla', sets: [{ kg: '80', reps: '5' }] }],
      }],
      bodyLogs: [],
      settings: { height: 175, age: 32, race5k: 0, maxHR: 188 },
    };
    localStorage.setItem('arete', JSON.stringify(v4));
    const db = await loadDB();
    expect(db.schemaVersion).toBe(5);
    expect(db.workouts[0].exercises[0].sets[0].kg).toBe(80);   // typed
    expect(db.workouts[0].exercises[0].sets[0].reps).toBe(5);
    expect(db.workouts[0].exercises[0].exerciseId).toBe('back_squat');
  });

  it('writes a v4 → v5 backup when migrating', async () => {
    const v4 = {
      schemaVersion: 4, workouts: [{ id: 1, date: '2026-05-10', exercises: [{ name: 'x', sets: [] }] }], bodyLogs: [],
    };
    localStorage.setItem('arete', JSON.stringify(v4));
    await loadDB();
    const backup = getPreMigrationBackup();
    expect(backup).toBeTruthy();
    expect(backup.fromVersion).toBe(4);
    expect(JSON.parse(backup.raw).schemaVersion).toBe(4);
  });
});

describe('saveDB → loadDB round-trip (PWA)', () => {
  it('persists workouts across a load cycle', async () => {
    const db = await loadDB();
    db.workouts.push({
      id: 1, date: '2026-05-10', session: 'A', phase: 1, program: 'arete',
      exercises: [{ name: 'Sentadilla', exerciseId: 'back_squat', sets: [{ kg: 80, reps: 5 }] }],
    });
    await saveDB(db);

    const reloaded = await loadDB();
    expect(reloaded.workouts.length).toBe(1);
    expect(reloaded.workouts[0].exercises[0].sets[0].kg).toBe(80);
  });

  it('returns a Promise that resolves after the write', async () => {
    const db = await loadDB();
    db.workouts.push({ id: 99, date: '2026-05-10', exercises: [] });
    const ret = saveDB(db);
    expect(ret).toBeInstanceOf(Promise);
    await ret;
    const reloaded = await loadDB();
    expect(reloaded.workouts.length).toBe(1);
  });

  it('invokes the onSave callback after each save', async () => {
    const spy = vi.fn();
    setOnSave(spy);
    const db = await loadDB();
    db.workouts.push({ id: 1, date: '2026-05-10', exercises: [] });
    await saveDB(db);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('bumps getSaveRevision on every successful save', async () => {
    const before = getSaveRevision();
    const db = await loadDB();
    db.workouts.push({ id: 1, date: '2026-05-10', exercises: [] });
    await saveDB(db);
    await saveDB(db);
    expect(getSaveRevision()).toBe(before + 2);
  });
});

describe('serial save queue', () => {
  it('serializes back-to-back saves in arrival order', async () => {
    const order = [];
    setOnSave((db) => order.push(db.__tag));

    // Distinct db objects so each save records its own tag — using one
    // mutated db would test the wrong thing (queue keeps a reference, not a
    // snapshot, which is the same shape as real callers).
    const dbA = await loadDB(); dbA.__tag = 'A';
    const dbB = await loadDB(); dbB.__tag = 'B';
    const dbC = await loadDB(); dbC.__tag = 'C';
    const p1 = saveDB(dbA);
    const p2 = saveDB(dbB);
    const p3 = saveDB(dbC);
    await Promise.all([p1, p2, p3]);

    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('a thrown error in one save does not stop subsequent ones (queue recovers)', async () => {
    // Force a save error on the second call by stubbing validateDB indirectly:
    // we pass an invalid db. The queue should keep advancing for valid ones.
    const okCallbacks = [];
    setOnSave((db) => okCallbacks.push(db?.__tag));

    const dbOk = await loadDB();
    dbOk.__tag = 'first';
    saveDB(dbOk);

    // Skip an explicit save with a known-bad shape (validateDB returns false).
    // saveDB returns the queue Promise; the error is logged in _doSave and
    // the queue continues for the next caller.
    saveDB({ workouts: 'not an array', bodyLogs: [] });

    const dbOk2 = await loadDB();
    dbOk2.__tag = 'third';
    await saveDB(dbOk2);

    // The first and third were valid; the second is rejected by validateDB
    // and never invokes onSave.
    expect(okCallbacks).toEqual(['first', 'third']);
  });
});

describe('pure helpers', () => {
  it('validateDB recognises a valid db', () => {
    expect(validateDB({ workouts: [], bodyLogs: [] })).toBe(true);
    expect(validateDB({ workouts: [], bodyLogs: 'no' })).toBe(false);
    expect(validateDB(null)).toBeFalsy();
  });

  it('validateImportData catches malformed input', () => {
    expect(validateImportData(null)).toMatch(/inválidos/);
    expect(validateImportData({})).toMatch(/workouts/);
    expect(validateImportData({ workouts: [{}] })).toMatch(/#0 sin id/);
    expect(validateImportData({ workouts: [{ id: 1 }] })).toMatch(/#0 sin exercises/);
    expect(validateImportData({ workouts: [{ id: 1, exercises: [] }] })).toBeNull();
  });

  it('markDeleted appends without duplicates', () => {
    const db = { deletedIds: [] };
    markDeleted(db, 'a');
    markDeleted(db, 'a');
    markDeleted(db, 'b');
    expect(db.deletedIds).toEqual(['a', 'b']);
  });

  it('pruneDeletedIds trims when over 500', () => {
    const db = {
      deletedIds: Array.from({ length: 700 }, (_, i) => `id-${i}`),
      workouts: [], bodyLogs: [], runningLogs: [],
    };
    pruneDeletedIds(db);
    // Should compact down to at most 200 (recent slice) + IDs still live (zero here).
    expect(db.deletedIds.length).toBeLessThanOrEqual(200);
    expect(db.deletedIds[db.deletedIds.length - 1]).toBe('id-699');  // most recent kept
  });
});

describe('pre-migration backup', () => {
  it('restorePreMigrationBackup rolls back to the v4 blob', async () => {
    const v4 = {
      schemaVersion: 4, workouts: [{ id: 1, date: '2026-05-10', exercises: [] }], bodyLogs: [],
    };
    localStorage.setItem('arete', JSON.stringify(v4));
    await loadDB();   // triggers backup + migration to v5

    // After load, localStorage[arete] is still v4 (we did NOT call saveDB).
    // Now restore:
    expect(restorePreMigrationBackup()).toBe(true);
    const raw = localStorage.getItem('arete');
    expect(JSON.parse(raw).schemaVersion).toBe(4);
    // Backup is cleared after restore
    expect(getPreMigrationBackup()).toBeNull();
  });
});
