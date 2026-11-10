// Test-only adapter: Node's built-in SQLite behind the same async interface expo-sqlite exposes.
import { DatabaseSync } from 'node:sqlite';
import type { SqlDb } from '../../sync/sqliteStore';

export type TestDb = SqlDb & { raw: DatabaseSync };

export function createNodeSqlite(): TestDb {
  const raw = new DatabaseSync(':memory:');
  return {
    raw,
    async execAsync(sql) {
      raw.exec(sql);
    },
    async runAsync(sql, ...params) {
      return raw.prepare(sql).run(...(params as any[]));
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]) {
      return raw.prepare(sql).all(...(params as any[])) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]) {
      return ((raw.prepare(sql).get(...(params as any[])) as T | undefined) ?? null) as T | null;
    },
  };
}
