import type { Snapshot } from '../api/types';
import type { LocalStore } from './syncer';

/** The slice of expo-sqlite's database that the store needs (tests supply Node's built-in SQLite). */
export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: any[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: any[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: any[]): Promise<T[]>;
}

/**
 * The snapshot cache is ONE row holding the raw GET /snapshot response body. The Kotlin background
 * worker writes the same row, so this DDL is a cross-language contract (see shared/snapshot.fixture.json).
 */
const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  DROP TABLE IF EXISTS meta;
  DROP TABLE IF EXISTS positions;
  DROP TABLE IF EXISTS orders;
  DROP TABLE IF EXISTS transactions;
  DROP TABLE IF EXISTS watchlist;
  CREATE TABLE IF NOT EXISTS snapshot_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    synced_at INTEGER NOT NULL
  );
`;

function parseSnapshot(json: string): Snapshot | null {
  try {
    const value = JSON.parse(json);
    const looksRight = value && typeof value === 'object' && value.portfolio && typeof value.portfolio === 'object';
    return looksRight ? (value as Snapshot) : null;
  } catch {
    return null; // a damaged cache must not crash the app; the next sync rewrites it
  }
}

export async function createSqliteStore(db: SqlDb): Promise<LocalStore> {
  await db.execAsync(SCHEMA);
  return {
    async replaceSnapshot(snapshot, syncedAt) {
      await db.runAsync('INSERT OR REPLACE INTO snapshot_cache VALUES (1, ?, ?)', JSON.stringify(snapshot), syncedAt);
    },
    async readSnapshot() {
      const row = await db.getFirstAsync<{ json: string; synced_at: number }>(
        'SELECT json, synced_at FROM snapshot_cache WHERE id = 1',
      );
      if (!row) return null;
      const snapshot = parseSnapshot(row.json);
      return snapshot ? { snapshot, syncedAt: Number(row.synced_at) } : null;
    },
    async clear() {
      await db.runAsync('DELETE FROM snapshot_cache');
    },
  };
}

/** Opens the app database (papertrade.db). expo-sqlite is loaded lazily so unit tests never touch the native module. */
export async function openLocalDb(): Promise<SqlDb> {
  const SQLite = await import('expo-sqlite');
  return SQLite.openDatabaseAsync('papertrade.db');
}

export async function openSqliteStore(): Promise<LocalStore> {
  return createSqliteStore(await openLocalDb());
}
