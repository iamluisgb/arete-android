/**
 * Test-only adapter that backs the same Adapter interface as
 * www/js/db/sqlite-adapter.js using sql.js (SQLite compiled to WASM).
 *
 * Used in vitest because @capacitor-community/sqlite needs a real Android
 * runtime. sql.js gives us a real SQLite engine in pure JS so round-trip
 * tests against the actual SQL we write are meaningful.
 */

import initSqlJs from 'sql.js';

let _SQL = null;

export async function createTestAdapter() {
  if (!_SQL) _SQL = await initSqlJs();
  const db = new _SQL.Database();
  db.run('PRAGMA foreign_keys = ON');

  /** Convert sql.js's `[{columns, values}]` to plain row objects. */
  function rowify(result) {
    if (!result?.length) return [];
    const { columns, values } = result[0];
    return values.map(v => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
  }

  /** @type {import('../www/js/db/sqlite-adapter.js').Adapter} */
  const adapter = {
    async run(sql, params = []) {
      db.run(sql, params);
    },
    async query(sql, params = []) {
      return rowify(db.exec(sql, params));
    },
    async transaction(fn) {
      db.run('BEGIN');
      try {
        await fn(adapter);
        db.run('COMMIT');
      } catch (e) {
        try { db.run('ROLLBACK'); } catch { /* swallow */ }
        throw e;
      }
    },
    async close() {
      db.close();
    },
  };
  return { adapter, db };
}
