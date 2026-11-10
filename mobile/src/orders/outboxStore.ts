import type { SqlDb } from '../sync/sqliteStore';
import type { OutboxStore, QueuedOrder } from './outbox';

type Row = { client_order_id: string; payload: string; queued_at: number; status: QueuedOrder['status']; error: string | null };

export async function createSqliteOutbox(db: SqlDb): Promise<OutboxStore> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS outbox (
      client_order_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      queued_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    );
  `);
  return {
    async list() {
      const rows = await db.getAllAsync<Row>('SELECT * FROM outbox ORDER BY queued_at ASC, rowid ASC');
      return rows.map((r) => ({
        client_order_id: r.client_order_id,
        payload: JSON.parse(r.payload),
        queued_at: Number(r.queued_at),
        status: r.status,
        ...(r.error ? { error: r.error } : {}),
      }));
    },
    async add(o) {
      await db.runAsync(
        'INSERT OR IGNORE INTO outbox (client_order_id, payload, queued_at, status, error) VALUES (?, ?, ?, ?, ?)',
        o.client_order_id,
        JSON.stringify(o.payload),
        o.queued_at,
        o.status,
        o.error ?? null,
      );
    },
    async update(id, patch) {
      if (patch.status !== undefined) await db.runAsync('UPDATE outbox SET status = ? WHERE client_order_id = ?', patch.status, id);
      if (patch.error !== undefined) await db.runAsync('UPDATE outbox SET error = ? WHERE client_order_id = ?', patch.error, id);
    },
    async remove(id) {
      await db.runAsync('DELETE FROM outbox WHERE client_order_id = ?', id);
    },
    async clear() {
      await db.runAsync('DELETE FROM outbox');
    },
  };
}
