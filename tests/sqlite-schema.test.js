import { describe, it, expect } from 'vitest';
import { createTestAdapter } from './_sqljs-adapter.js';
import { migrateSchema, SCHEMA_VERSION, DOMAIN_TABLES } from '../www/js/db/schema.js';

describe('migrateSchema', () => {
  it('applies DDL from v0 to current version on a fresh DB', async () => {
    const { adapter } = await createTestAdapter();
    const result = await migrateSchema(adapter);
    expect(result).toEqual({ from: 0, to: SCHEMA_VERSION });
  });

  it('writes schema_version into meta', async () => {
    const { adapter } = await createTestAdapter();
    await migrateSchema(adapter);
    const rows = await adapter.query("SELECT value FROM meta WHERE key='schema_version'");
    expect(parseInt(rows[0].value, 10)).toBe(SCHEMA_VERSION);
  });

  it('is idempotent (second run is a no-op)', async () => {
    const { adapter } = await createTestAdapter();
    await migrateSchema(adapter);
    const second = await migrateSchema(adapter);
    expect(second).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
  });

  it('creates every domain table', async () => {
    const { adapter } = await createTestAdapter();
    await migrateSchema(adapter);
    for (const t of DOMAIN_TABLES) {
      const rows = await adapter.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [t]
      );
      expect(rows.length, `table ${t} should exist`).toBe(1);
    }
  });

  it('creates indices on date columns', async () => {
    const { adapter } = await createTestAdapter();
    await migrateSchema(adapter);
    const rows = await adapter.query(
      `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'`
    );
    const names = rows.map(r => r.name).sort();
    expect(names).toContain('idx_workouts_date');
    expect(names).toContain('idx_body_logs_date');
    expect(names).toContain('idx_running_logs_date');
  });
});
