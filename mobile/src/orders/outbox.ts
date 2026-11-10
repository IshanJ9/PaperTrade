import { ApiError, type PlaceOrderBody } from '../api/client';
import type { OrderDto } from '../api/types';

export type PlaceOrderInput = PlaceOrderBody;

export type QueuedOrder = {
  client_order_id: string;
  payload: PlaceOrderInput;
  queued_at: number;
  status: 'queued' | 'rejected' | 'expired';
  error?: string;
};

/** Oldest first. `add` keeps the existing entry when the id is already stored. */
export interface OutboxStore {
  list(): Promise<QueuedOrder[]>;
  add(order: QueuedOrder): Promise<void>;
  update(id: string, patch: Partial<Pick<QueuedOrder, 'status' | 'error'>>): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Limit and stop orders carry their own price, so they may wait a day for a connection. */
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A MARKET order means "at today's price, now": sent hours later it would fill at a price the user never saw. */
export const MARKET_MAX_AGE_MS = 5 * 60 * 1000;

const maxAgeMs = (order: PlaceOrderInput) => (order.type === 'MARKET' ? MARKET_MAX_AGE_MS : OUTBOX_MAX_AGE_MS);

type OrderApi = { placeOrder(order: PlaceOrderInput): Promise<OrderDto> };

/** True for a failed fetch (no response at all); false for any answer from the server. */
export function isNetworkError(e: unknown): boolean {
  return !(e instanceof ApiError);
}

export type SubmitResult =
  | { kind: 'sent'; order: OrderDto }
  | { kind: 'queued' }
  | { kind: 'rejected'; error: string; status?: number };

/**
 * Try to send an order. With no connection it is queued under the same client_order_id, so replaying it
 * later (or retrying after a timeout that actually reached the server) can never fill twice.
 */
export async function submitOrder(
  api: OrderApi,
  outbox: OutboxStore,
  input: PlaceOrderInput,
  now: () => number = Date.now,
): Promise<SubmitResult> {
  try {
    return { kind: 'sent', order: await api.placeOrder(input) };
  } catch (e) {
    if (isNetworkError(e)) {
      await outbox.add({ client_order_id: input.client_order_id, payload: input, queued_at: now(), status: 'queued' });
      return { kind: 'queued' };
    }
    const err = e as ApiError;
    return { kind: 'rejected', error: err.message, status: err.status };
  }
}

export interface FlushResult {
  sent: number;
  rejected: number;
  expired: number;
  remaining: number;
}

/** Send queued orders oldest first. Stops (keeping the rest queued) when the server cannot be reached or has no price/session. */
export async function flushOutbox(api: OrderApi, outbox: OutboxStore, now: () => number = Date.now): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, rejected: 0, expired: 0, remaining: 0 };
  for (const item of await outbox.list()) {
    if (item.status !== 'queued') continue;
    if (now() - item.queued_at > maxAgeMs(item.payload)) {
      await outbox.update(item.client_order_id, { status: 'expired' });
      result.expired++;
      continue;
    }
    try {
      await api.placeOrder(item.payload);
      await outbox.remove(item.client_order_id);
      result.sent++;
    } catch (e) {
      if (isNetworkError(e) || (e as ApiError).status === 503 || (e as ApiError).status === 401) break;
      await outbox.update(item.client_order_id, { status: 'rejected', error: (e as ApiError).message });
      result.rejected++;
    }
  }
  result.remaining = (await outbox.list()).filter((x) => x.status === 'queued').length;
  return result;
}
