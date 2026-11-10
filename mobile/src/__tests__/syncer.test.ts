import type { Snapshot } from '../api/types';
import { createSyncer, type LocalStore } from '../sync/syncer';

const snap = (cash: string): Snapshot => ({
  server_time: '2026-11-08T00:00:00Z',
  portfolio: { cash, realized_pnl: '0', unrealized_pnl: '0', equity: cash, positions: [] },
  orders: [], transactions: [], watchlist: ['AAPL'],
});

function fakeStore(): LocalStore & { saved: { snapshot: Snapshot; syncedAt: number } | null } {
  return {
    saved: null,
    async replaceSnapshot(snapshot, syncedAt) { this.saved = { snapshot, syncedAt }; },
    async readSnapshot() { return this.saved; },
    async clear() { this.saved = null; },
  };
}

it('stores the fetched snapshot with the sync time', async () => {
  const store = fakeStore();
  const sync = createSyncer({ snapshot: async () => snap('100') }, store, () => 1234);
  expect(await sync()).toEqual({ ok: true });
  expect(store.saved).toEqual({ snapshot: snap('100'), syncedAt: 1234 });
});

it('keeps the old data and reports the error when the fetch fails', async () => {
  const store = fakeStore();
  await createSyncer({ snapshot: async () => snap('100') }, store, () => 1)();
  const result = await createSyncer({ snapshot: async () => { throw new Error('offline'); } }, store, () => 2)();
  expect(result).toEqual({ ok: false, error: 'offline' });
  expect(store.saved?.snapshot.portfolio.cash).toBe('100');
  expect(store.saved?.syncedAt).toBe(1);
});

it('shares one in-flight request between concurrent calls', async () => {
  const store = fakeStore();
  const snapshot = jest.fn(async () => snap('100'));
  const sync = createSyncer({ snapshot }, store);
  await Promise.all([sync(), sync(), sync()]);
  expect(snapshot).toHaveBeenCalledTimes(1);
  await sync();
  expect(snapshot).toHaveBeenCalledTimes(2);
});
