import { ApiError, createApi, type TokenStore, type Tokens } from '../api/client';

function memoryTokens(initial: Tokens | null = { access: 'a1', refresh: 'r1' }) {
  let current = initial;
  const store: TokenStore & { current: () => Tokens | null; setCalls: Tokens[] } = {
    setCalls: [],
    current: () => current,
    getAccess: async () => current?.access ?? null,
    getRefresh: async () => current?.refresh ?? null,
    set: async (t) => {
      current = t;
      store.setCalls.push(t);
    },
    clear: async () => {
      current = null;
    },
  };
  return store;
}

type Scripted = { status: number; body?: unknown; notJson?: boolean } | Error;
const res = (status: number, body: unknown = {}, notJson = false) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => {
    if (notJson) throw new SyntaxError('Unexpected token < in JSON');
    return body;
  },
});

function fakeFetch(script: Scripted[]) {
  const calls: { url: string; init: any }[] = [];
  const fn = jest.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    const next = script.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    if (next instanceof Error) throw next;
    return res(next.status, next.body, next.notJson) as any;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const BASE = 'http://api.test';

it('login stores the tokens and notifies', async () => {
  const tokens = memoryTokens(null);
  const changed = jest.fn();
  const f = fakeFetch([{ status: 200, body: { access_token: 'A', refresh_token: 'R' } }]);
  const api = createApi({ baseUrl: BASE, tokens, fetchImpl: f.fn, onTokensChanged: changed });
  await api.login('a@b.co', 'pw');
  expect(tokens.current()).toEqual({ access: 'A', refresh: 'R' });
  expect(changed).toHaveBeenCalledWith({ access: 'A', refresh: 'R' });
  expect(f.calls[0].url).toBe(`${BASE}/auth/login`);
});

it('retries once with a refreshed token after a 401', async () => {
  const tokens = memoryTokens();
  const f = fakeFetch([
    { status: 401, body: { detail: 'expired' } },
    { status: 200, body: { access_token: 'a2', refresh_token: 'r2' } },
    { status: 200, body: { ok: 1 } },
  ]);
  const api = createApi({ baseUrl: BASE, tokens, fetchImpl: f.fn });
  await expect(api.me()).resolves.toEqual({ ok: 1 });
  expect(tokens.current()).toEqual({ access: 'a2', refresh: 'r2' });
  expect(f.calls[1].url).toBe(`${BASE}/auth/refresh`);
  expect(JSON.parse(f.calls[1].init.body)).toEqual({ refresh_token: 'r1' });
  expect(f.calls[2].init.headers.Authorization).toBe('Bearer a2');
});

it('concurrent 401s share a single refresh call', async () => {
  const tokens = memoryTokens();
  const f = fakeFetch([
    { status: 401 },
    { status: 401 },
    { status: 401 },
    { status: 200, body: { access_token: 'a2', refresh_token: 'r2' } },
    { status: 200, body: { n: 1 } },
    { status: 200, body: { n: 2 } },
    { status: 200, body: { n: 3 } },
  ]);
  const api = createApi({ baseUrl: BASE, tokens, fetchImpl: f.fn });
  await Promise.all([api.me(), api.me(), api.me()]);
  expect(f.calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
});

it('refresh rejected: clears tokens, calls onAuthLost and throws ApiError 401', async () => {
  const tokens = memoryTokens();
  const lost = jest.fn();
  const f = fakeFetch([{ status: 401, body: { detail: 'expired' } }, { status: 401, body: { detail: 'invalid refresh token' } }]);
  const api = createApi({ baseUrl: BASE, tokens, fetchImpl: f.fn, onAuthLost: lost });
  await expect(api.me()).rejects.toMatchObject({ status: 401 });
  expect(tokens.current()).toBeNull();
  expect(lost).toHaveBeenCalledTimes(1);
});

it('a network error during refresh keeps the tokens and rethrows', async () => {
  const tokens = memoryTokens();
  const lost = jest.fn();
  const f = fakeFetch([{ status: 401 }, new TypeError('Network request failed')]);
  const api = createApi({ baseUrl: BASE, tokens, fetchImpl: f.fn, onAuthLost: lost });
  await expect(api.me()).rejects.toThrow('Network request failed');
  expect(tokens.current()).toEqual({ access: 'a1', refresh: 'r1' });
  expect(lost).not.toHaveBeenCalled();
});

it('does not loop: a second 401 after a successful refresh is thrown', async () => {
  const tokens = memoryTokens();
  const f = fakeFetch([
    { status: 401 },
    { status: 200, body: { access_token: 'a2', refresh_token: 'r2' } },
    { status: 401, body: { detail: 'still no' } },
  ]);
  const api = createApi({ baseUrl: BASE, tokens, fetchImpl: f.fn });
  const error = await api.me().catch((e) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.status).toBe(401);
  expect(f.calls).toHaveLength(3);
});

it('logout clears the tokens even when the request fails', async () => {
  const tokens = memoryTokens();
  const f = fakeFetch([new TypeError('offline')]);
  const api = createApi({ baseUrl: BASE, tokens, fetchImpl: f.fn });
  await api.logout();
  expect(tokens.current()).toBeNull();
  expect(f.calls[0].url).toBe(`${BASE}/auth/logout`);
});

it('backgroundToken posts the current refresh token and returns the child token', async () => {
  const tokens = memoryTokens();
  const f = fakeFetch([{ status: 200, body: { refresh_token: 'child-1' } }]);
  const api = createApi({ baseUrl: BASE, tokens, fetchImpl: f.fn });
  await expect(api.backgroundToken()).resolves.toBe('child-1');
  expect(f.calls[0].url).toBe(`${BASE}/auth/background-token`);
  expect(JSON.parse(f.calls[0].init.body)).toEqual({ refresh_token: 'r1' });
});

it('history requests the symbol and range', async () => {
  const tokens = memoryTokens();
  const f = fakeFetch([{ status: 200, body: { symbol: 'AAPL', range: '1W', points: [] } }]);
  const api = createApi({ baseUrl: BASE, tokens, fetchImpl: f.fn });
  await api.history('AAPL', '1W');
  expect(f.calls[0].url).toBe(`${BASE}/history?symbol=AAPL&range=1W`);
});


describe('responses that are not what the server would send', () => {
  const validSnapshot = {
    server_time: 't',
    portfolio: { cash: '1', realized_pnl: '0', unrealized_pnl: '0', equity: '1', positions: [] },
    orders: [],
    transactions: [],
    watchlist: [],
  };

  it('a 200 page that is not JSON (captive portal) is a network-style error, never data', async () => {
    const f = fakeFetch([{ status: 200, notJson: true }]);
    const api = createApi({ baseUrl: BASE, tokens: memoryTokens(), fetchImpl: f.fn });
    const error = await api.snapshot().catch((e) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it('a JSON body without the snapshot shape is rejected', async () => {
    const f = fakeFetch([{ status: 200, body: {} }]);
    const api = createApi({ baseUrl: BASE, tokens: memoryTokens(), fetchImpl: f.fn });
    await expect(api.snapshot()).rejects.toBeInstanceOf(TypeError);
  });

  it('a real snapshot is accepted', async () => {
    const f = fakeFetch([{ status: 200, body: validSnapshot }]);
    const api = createApi({ baseUrl: BASE, tokens: memoryTokens(), fetchImpl: f.fn });
    await expect(api.snapshot()).resolves.toEqual(validSnapshot);
  });

  it('an order response without an id and status is rejected, a real one accepted', async () => {
    const order = { client_order_id: 'order-00000001', symbol: 'AAPL', side: 'BUY', type: 'MARKET', quantity: 1 } as const;
    const bad = createApi({ baseUrl: BASE, tokens: memoryTokens(), fetchImpl: fakeFetch([{ status: 201, body: {} }]).fn });
    await expect(bad.placeOrder(order)).rejects.toBeInstanceOf(TypeError);
    const good = createApi({
      baseUrl: BASE,
      tokens: memoryTokens(),
      fetchImpl: fakeFetch([{ status: 201, body: { id: 3, symbol: 'AAPL', side: 'BUY', type: 'MARKET', quantity: 1, price: null, status: 'FILLED' } }]).fn,
    });
    await expect(good.placeOrder(order)).resolves.toMatchObject({ id: 3, status: 'FILLED' });
  });

  it('a refresh response without tokens does not store anything', async () => {
    const tokens = memoryTokens();
    const f = fakeFetch([{ status: 401 }, { status: 200, body: {} }]);
    const api = createApi({ baseUrl: BASE, tokens, fetchImpl: f.fn });
    await expect(api.me()).rejects.toBeInstanceOf(TypeError);
    expect(tokens.current()).toEqual({ access: 'a1', refresh: 'r1' });
  });
});
