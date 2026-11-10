import { ApiError } from '../api/client';
import type { OrderDto } from '../api/types';
import {
  MARKET_MAX_AGE_MS,
  OUTBOX_MAX_AGE_MS,
  flushOutbox,
  isNetworkError,
  submitOrder,
  type OutboxStore,
  type PlaceOrderInput,
  type QueuedOrder,
} from '../orders/outbox';
import { createSqliteOutbox } from '../orders/outboxStore';
import { createNodeSqlite } from './helpers/nodeSqlite';

const NOW = 1_800_000_000_000;

function input(id: string): PlaceOrderInput {
  return { client_order_id: id, symbol: 'AAPL', side: 'BUY', type: 'MARKET', quantity: 1 };
}

function memoryOutbox(): OutboxStore & { items: QueuedOrder[] } {
  const store = {
    items: [] as QueuedOrder[],
    async list() { return [...store.items]; },
    async add(o: QueuedOrder) { if (!store.items.some((x) => x.client_order_id === o.client_order_id)) store.items.push(o); },
    async update(id: string, patch: Partial<Pick<QueuedOrder, 'status' | 'error'>>) {
      store.items = store.items.map((x) => (x.client_order_id === id ? { ...x, ...patch } : x));
    },
    async remove(id: string) { store.items = store.items.filter((x) => x.client_order_id !== id); },
    async clear() { store.items = []; },
  };
  return store;
}

/** A fake server: idempotent on client_order_id, with scripted failures. */
function fakeApi(failures: (Error | null)[] = []) {
  const seen = new Map<string, OrderDto>();
  const sentIds: string[] = [];
  const queue = [...failures];
  return {
    sentIds,
    placeOrder: async (o: PlaceOrderInput): Promise<OrderDto> => {
      const failure = queue.shift();
      if (failure) throw failure;
      sentIds.push(o.client_order_id);
      if (!seen.has(o.client_order_id)) {
        seen.set(o.client_order_id, { id: seen.size + 1, symbol: o.symbol, side: o.side, type: o.type, quantity: o.quantity, price: null, status: 'FILLED' });
      }
      return seen.get(o.client_order_id)!;
    },
  };
}

const offline = () => new TypeError('Network request failed');

function queued(id: string, at = NOW): QueuedOrder {
  return { client_order_id: id, payload: input(id), queued_at: at, status: 'queued' };
}

function queuedLimit(id: string, at = NOW): QueuedOrder {
  return { ...queued(id, at), payload: { ...input(id), type: 'LIMIT', price: '100.00' } };
}

it('classifies network errors versus API errors', () => {
  expect(isNetworkError(offline())).toBe(true);
  expect(isNetworkError(new ApiError(422, 'bad'))).toBe(false);
});

it('sends immediately when online', async () => {
  const outbox = memoryOutbox();
  const r = await submitOrder(fakeApi(), outbox, input('order-00000001'), () => NOW);
  expect(r).toMatchObject({ kind: 'sent', order: { status: 'FILLED' } });
  expect(outbox.items).toEqual([]);
});

it('queues on a network error and keeps the same client_order_id', async () => {
  const outbox = memoryOutbox();
  const r = await submitOrder(fakeApi([offline()]), outbox, input('order-00000002'), () => NOW);
  expect(r).toEqual({ kind: 'queued' });
  expect(outbox.items).toEqual([queued('order-00000002')]);
});

it('queuing the same order twice keeps one entry', async () => {
  const outbox = memoryOutbox();
  await submitOrder(fakeApi([offline(), offline()]), outbox, input('order-00000003'), () => NOW);
  await submitOrder(fakeApi([offline(), offline()]), outbox, input('order-00000003'), () => NOW + 5);
  expect(outbox.items).toHaveLength(1);
});

it('does not queue API rejections, including 503', async () => {
  const outbox = memoryOutbox();
  const bad = await submitOrder(fakeApi([new ApiError(422, 'unknown symbol')]), outbox, input('order-00000004'), () => NOW);
  expect(bad).toEqual({ kind: 'rejected', error: 'unknown symbol', status: 422 });
  const noPrice = await submitOrder(fakeApi([new ApiError(503, 'no live price available for this symbol')]), outbox, input('order-00000005'), () => NOW);
  expect(noPrice).toMatchObject({ kind: 'rejected', status: 503 });
  expect(outbox.items).toEqual([]);
});

it('flush sends oldest first and removes sent items', async () => {
  const outbox = memoryOutbox();
  outbox.items = [queued('a-1', NOW - 20), queued('b-2', NOW - 10), queued('c-3', NOW - 5)];
  const api = fakeApi();
  expect(await flushOutbox(api, outbox, () => NOW)).toEqual({ sent: 3, rejected: 0, expired: 0, remaining: 0 });
  expect(api.sentIds).toEqual(['a-1', 'b-2', 'c-3']);
  expect(outbox.items).toEqual([]);
});

it('flush stops at the first network error and keeps the rest queued in order', async () => {
  const outbox = memoryOutbox();
  outbox.items = [queued('a-1', NOW - 20), queued('b-2', NOW - 10), queued('c-3', NOW - 5)];
  const api = fakeApi([null, offline()]); // a-1 ok, b-2 hits a network error
  expect(await flushOutbox(api, outbox, () => NOW)).toEqual({ sent: 1, rejected: 0, expired: 0, remaining: 2 });
  expect(outbox.items.map((x) => x.client_order_id)).toEqual(['b-2', 'c-3']);
});

it('flush stops on 503 and 401 without marking the order rejected', async () => {
  for (const status of [503, 401]) {
    const outbox = memoryOutbox();
    outbox.items = [queued('a-1')];
    await flushOutbox(fakeApi([new ApiError(status, 'x')]), outbox, () => NOW);
    expect(outbox.items[0].status).toBe('queued');
  }
});

it('flush marks 4xx as rejected with the message and continues', async () => {
  const outbox = memoryOutbox();
  outbox.items = [queued('a-1', NOW - 20), queued('b-2', NOW - 10)];
  const api = fakeApi([new ApiError(422, 'unknown symbol')]);
  expect(await flushOutbox(api, outbox, () => NOW)).toEqual({ sent: 1, rejected: 1, expired: 0, remaining: 0 });
  expect(outbox.items).toEqual([{ ...queued('a-1', NOW - 20), status: 'rejected', error: 'unknown symbol' }]);
});

it('flush never sends a limit or stop order older than 24h and marks it expired', async () => {
  const outbox = memoryOutbox();
  outbox.items = [queuedLimit('old-1', NOW - OUTBOX_MAX_AGE_MS - 1), queuedLimit('fresh-2', NOW - OUTBOX_MAX_AGE_MS)];
  const api = fakeApi();
  const result = await flushOutbox(api, outbox, () => NOW);
  expect(result).toEqual({ sent: 1, rejected: 0, expired: 1, remaining: 0 });
  expect(api.sentIds).toEqual(['fresh-2']);
  expect(outbox.items.map((x) => [x.client_order_id, x.status])).toEqual([['old-1', 'expired']]);
});

it('a queued MARKET order expires after minutes, not a day: it must not execute at a much later price', async () => {
  const outbox = memoryOutbox();
  outbox.items = [queued('stale-m', NOW - MARKET_MAX_AGE_MS - 1), queued('fresh-m', NOW - MARKET_MAX_AGE_MS)];
  const api = fakeApi();
  expect(await flushOutbox(api, outbox, () => NOW)).toEqual({ sent: 1, rejected: 0, expired: 1, remaining: 0 });
  expect(api.sentIds).toEqual(['fresh-m']);
  expect(MARKET_MAX_AGE_MS).toBeLessThan(OUTBOX_MAX_AGE_MS);
});

it('a limit order queued 23 hours ago is still sent', async () => {
  const outbox = memoryOutbox();
  outbox.items = [queuedLimit('lim', NOW - 23 * 60 * 60 * 1000)];
  const api = fakeApi();
  await flushOutbox(api, outbox, () => NOW);
  expect(api.sentIds).toEqual(['lim']);
});

it('flush ignores items that are already rejected or expired', async () => {
  const outbox = memoryOutbox();
  outbox.items = [{ ...queued('r-1'), status: 'rejected', error: 'no' }, { ...queued('e-2'), status: 'expired' }];
  const api = fakeApi();
  expect(await flushOutbox(api, outbox, () => NOW)).toEqual({ sent: 0, rejected: 0, expired: 0, remaining: 0 });
  expect(api.sentIds).toEqual([]);
});

it('flushing twice after a partial failure never double-sends an id', async () => {
  const outbox = memoryOutbox();
  outbox.items = [queued('a-1', NOW - 20), queued('b-2', NOW - 10)];
  const api = fakeApi([null, offline()]);
  await flushOutbox(api, outbox, () => NOW);
  await flushOutbox(api, outbox, () => NOW);
  expect(api.sentIds).toEqual(['a-1', 'b-2']);
  expect(outbox.items).toEqual([]);
});

it('clear empties the outbox', async () => {
  const outbox = memoryOutbox();
  outbox.items = [queued('a-1')];
  await outbox.clear();
  expect(await outbox.list()).toEqual([]);
});

describe('sqlite outbox', () => {
  it('round-trips, preserves oldest-first order and updates status', async () => {
    const outbox = await createSqliteOutbox(createNodeSqlite());
    await outbox.add(queued('b-2', 200));
    await outbox.add(queued('a-1', 100));
    expect((await outbox.list()).map((x) => x.client_order_id)).toEqual(['a-1', 'b-2']);
    await outbox.update('a-1', { status: 'rejected', error: 'nope' });
    expect((await outbox.list())[0]).toEqual({ ...queued('a-1', 100), status: 'rejected', error: 'nope' });
    await outbox.remove('b-2');
    expect(await outbox.list()).toHaveLength(1);
    await outbox.clear();
    expect(await outbox.list()).toEqual([]);
  });

  it('adding an existing id keeps the original entry', async () => {
    const outbox = await createSqliteOutbox(createNodeSqlite());
    await outbox.add(queued('a-1', 100));
    await outbox.add(queued('a-1', 999));
    expect(await outbox.list()).toEqual([queued('a-1', 100)]);
  });
});
