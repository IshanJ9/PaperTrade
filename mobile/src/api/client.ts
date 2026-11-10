import type { OrderType, Side } from '../orders/validate';
import type { HistoryDto, OrderDto, PortfolioDto, QuoteDto, Snapshot } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Tokens = { access: string; refresh: string };

export interface TokenStore {
  getAccess(): Promise<string | null>;
  getRefresh(): Promise<string | null>;
  set(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

export interface ApiOptions {
  baseUrl: string;
  tokens: TokenStore;
  fetchImpl?: typeof fetch;
  onAuthLost?: () => void;
  onTokensChanged?: (tokens: Tokens) => void;
}

export type PlaceOrderBody = {
  client_order_id: string;
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: number;
  price?: string;
};

type TokenResponse = { access_token: string; refresh_token: string };

// Shape checks. A hotel/captive-portal Wi-Fi can answer 200 with a page that is not ours; treating
// that as data would overwrite the offline cache or make the outbox think an order was placed.
const bad = (what: string) => new TypeError(`Unexpected ${what} from the server (is a captive portal in the way?)`);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSnapshot = (v: unknown): v is Snapshot =>
  isObject(v) && isObject(v.portfolio) && Array.isArray(v.orders) && Array.isArray(v.transactions) && Array.isArray(v.watchlist);
const isOrder = (v: unknown): v is OrderDto => isObject(v) && typeof v.id === 'number' && typeof v.status === 'string';
const isTokenResponse = (v: unknown): v is TokenResponse =>
  isObject(v) && typeof v.access_token === 'string' && typeof v.refresh_token === 'string';

export function createApi({ baseUrl, tokens, fetchImpl = fetch, onAuthLost, onTokensChanged }: ApiOptions) {
  async function send(path: string, init: { method?: string; body?: unknown; auth: boolean }) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (init.auth) {
      const access = await tokens.getAccess();
      if (access) headers.Authorization = `Bearer ${access}`;
    }
    return fetchImpl(`${baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  async function parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, typeof data?.detail === 'string' ? data.detail : `HTTP ${res.status}`);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw bad('response (not JSON)'); // not an ApiError: callers treat it like a failed connection
    }
  }

  // One refresh at a time: concurrent 401s wait for the same request, so a rotating refresh token is used once.
  let refreshing: Promise<boolean> | null = null;
  function refreshTokens(): Promise<boolean> {
    if (!refreshing) {
      refreshing = (async () => {
        const refresh = await tokens.getRefresh();
        if (!refresh) return false;
        const res = await send('/auth/refresh', { method: 'POST', auth: false, body: { refresh_token: refresh } });
        if (res.status === 401) {
          await tokens.clear();
          onAuthLost?.();
          return false;
        }
        const data = await parse<unknown>(res); // other failures throw, tokens stay
        if (!isTokenResponse(data)) throw bad('refresh response');
        const next = { access: data.access_token, refresh: data.refresh_token };
        await tokens.set(next);
        onTokensChanged?.(next);
        return true;
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function request<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
    const auth = init.auth !== false;
    let res = await send(path, { method: init.method, body: init.body, auth });
    if (res.status === 401 && auth && (await refreshTokens())) {
      res = await send(path, { method: init.method, body: init.body, auth }); // retried once, never in a loop
    }
    return parse<T>(res);
  }

  async function authenticate(path: string, email: string, password: string) {
    const data = await request<unknown>(path, { method: 'POST', auth: false, body: { email, password } });
    if (!isTokenResponse(data)) throw bad('sign-in response');
    const next = { access: data.access_token, refresh: data.refresh_token };
    await tokens.set(next);
    onTokensChanged?.(next);
  }

  return {
    register: (email: string, password: string) => authenticate('/auth/register', email, password),
    login: (email: string, password: string) => authenticate('/auth/login', email, password),
    async logout() {
      try {
        const refresh = await tokens.getRefresh();
        if (refresh) await send('/auth/logout', { method: 'POST', auth: false, body: { refresh_token: refresh } });
      } catch {
        // best effort: the local sign-out below must happen even offline
      } finally {
        await tokens.clear();
      }
    },
    /** A separate refresh-token family for the background worker; revoked when this session logs out. */
    async backgroundToken(): Promise<string> {
      const refresh = await tokens.getRefresh();
      if (!refresh) throw new ApiError(401, 'not signed in');
      const data = await request<{ refresh_token: string }>('/auth/background-token', {
        method: 'POST',
        auth: false,
        body: { refresh_token: refresh },
      });
      return data.refresh_token;
    },
    me: () => request<{ id: number; email: string }>('/me'),
    quotes: (symbols: string[]) => request<Record<string, QuoteDto>>(`/quotes?symbols=${symbols.join(',')}`),
    snapshot: async () => {
      const data = await request<unknown>('/snapshot');
      if (!isSnapshot(data)) throw bad('snapshot');
      return data;
    },
    portfolio: () => request<PortfolioDto>('/portfolio'),
    history: (symbol: string, range: '1D' | '1W' | '1M') =>
      request<HistoryDto>(`/history?symbol=${symbol}&range=${range}`),
    placeOrder: async (o: PlaceOrderBody) => {
      const data = await request<unknown>('/orders', { method: 'POST', body: o });
      if (!isOrder(data)) throw bad('order response');
      return data;
    },
    cancelOrder: (id: number) => request<void>(`/orders/${id}`, { method: 'DELETE' }),
    setWatchlist: (symbols: string[]) => request<{ symbols: string[] }>('/watchlist', { method: 'PUT', body: { symbols } }),
  };
}

export type Api = ReturnType<typeof createApi>;
