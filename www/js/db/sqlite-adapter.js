/**
 * Async wrapper over @capacitor-community/sqlite@8.x for Areté.
 *
 * Why a wrapper?
 *  - Hides the plugin's verbose Connection API behind 3 verbs: run/query/transaction.
 *  - Lets us swap implementations in tests (sql.js, in-memory) without touching repos.
 *  - Centralizes connection lifecycle (open, retain, close on app suspend).
 *
 * Repos depend on the abstract `Adapter` interface, not on this concrete file.
 * The test suite provides a sql.js-backed adapter that exposes the same shape.
 *
 * @typedef {Object} Adapter
 * @property {(sql: string, params?: any[]) => Promise<void>}                 run
 * @property {(sql: string, params?: any[]) => Promise<Object[]>}             query
 * @property {(fn: (adapter: Adapter) => Promise<void>) => Promise<void>}     transaction
 * @property {() => Promise<void>}                                            close
 */

const DB_NAME = 'arete';
const DB_VERSION = 1;          // Plugin's own version cursor — bump only on hard breaks
const ENCRYPTED = false;        // Set true in Fase 3 with SQLCipher
const MODE = 'no-encryption';

let _connection = null;
let _connectionPromise = null;

/** Get the lazily-initialised CapacitorSQLite plugin. Throws when off-Capacitor. */
function getPlugin() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (!cap?.isNativePlatform?.()) {
    throw new Error('sqlite-adapter: not running on Capacitor native platform');
  }
  const plugin = cap.Plugins?.CapacitorSQLite;
  if (!plugin) {
    throw new Error('sqlite-adapter: @capacitor-community/sqlite plugin not registered');
  }
  return plugin;
}

/**
 * Open (or re-use) the singleton SQLite connection.
 * The plugin holds connections by name; we keep just one to keep the API simple.
 * @returns {Promise<Adapter>}
 */
export function openDB() {
  if (_connection) return Promise.resolve(_connection);
  if (_connectionPromise) return _connectionPromise;

  _connectionPromise = (async () => {
    const plugin = getPlugin();

    // The plugin owns the file. We claim it as a "connection" and reuse it.
    const isInCache = await plugin.isConnection({ database: DB_NAME, readonly: false });
    if (!isInCache.result) {
      await plugin.createConnection({
        database: DB_NAME,
        version: DB_VERSION,
        encrypted: ENCRYPTED,
        mode: MODE,
        readonly: false,
      });
    }
    await plugin.open({ database: DB_NAME, readonly: false });

    // WAL improves write throughput on Android — see SQLite docs.
    try { await plugin.execute({ database: DB_NAME, statements: 'PRAGMA journal_mode = WAL' }); } catch (e) { /* not critical */ }
    // Enforce foreign keys (off by default in SQLite).
    await plugin.execute({ database: DB_NAME, statements: 'PRAGMA foreign_keys = ON' });

    _connection = makeAdapter(plugin);
    return _connection;
  })();

  return _connectionPromise;
}

/** Build the adapter that wraps the plugin's API in our 3-verb shape. */
function makeAdapter(plugin) {
  /** @type {Adapter} */
  const adapter = {
    async run(sql, params = []) {
      const res = await plugin.run({
        database: DB_NAME,
        statement: sql,
        values: params,
        transaction: false,
      });
      if (res?.changes?.lastId === -1 && res?.changes?.changes === -1) {
        throw new Error(`sqlite-adapter.run: failed for "${sql.slice(0, 60)}..."`);
      }
    },

    async query(sql, params = []) {
      const res = await plugin.query({
        database: DB_NAME,
        statement: sql,
        values: params,
      });
      return res?.values || [];
    },

    async transaction(fn) {
      await plugin.execute({ database: DB_NAME, statements: 'BEGIN TRANSACTION' });
      try {
        await fn(adapter);
        await plugin.execute({ database: DB_NAME, statements: 'COMMIT' });
      } catch (e) {
        try { await plugin.execute({ database: DB_NAME, statements: 'ROLLBACK' }); } catch { /* swallow */ }
        throw e;
      }
    },

    async close() {
      try { await plugin.close({ database: DB_NAME, readonly: false }); } catch { /* swallow */ }
      try { await plugin.closeConnection({ database: DB_NAME, readonly: false }); } catch { /* swallow */ }
      _connection = null;
      _connectionPromise = null;
    },
  };
  return adapter;
}

/** For tests + diagnostics: drop the cached adapter without closing the DB. */
export function _resetForTests() {
  _connection = null;
  _connectionPromise = null;
}
