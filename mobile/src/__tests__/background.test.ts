import { ApiError, type TokenStore, type Tokens } from '../api/client';
import type { Snapshot } from '../api/types';
import { runBackgroundSync, startBackgroundSync, stopBackgroundSync } from '../sync/background';
import type { LocalStore } from '../sync/syncer';

const status = (over = {}) => ({ configured: false, scheduled: false, lastRunAtMs: null, lastOutcome: null, ...over });

function fakeNative(initial = status(), available = true) {
  const calls: string[] = [];
  return {
    calls,
    isNativeSyncAvailable: available,
    configure: jest.fn(async (o: { baseUrl: string; refreshToken: string }) => {
      calls.push(`configure:${o.baseUrl}:${o.refreshToken}`);
    }),
    schedule: jest.fn(async (m?: number) => {
      calls.push(`schedule:${m}`);
    }),
    cancelAndClear: jest.fn(async () => {
      calls.push('cancelAndClear');
    }),
    getStatus: jest.fn(async () => initial),
  };
}

function fakeApi(calls: string[]) {
  return {
    backgroundToken: jest.fn(async () => {
      calls.push('backgroundToken');
      return 'child-token';
    }),
  };
}

const ios = () => ({ register: jest.fn(async () => {}), unregister: jest.fn(async () => {}) });

describe('startBackgroundSync', () => {
  it('android: gets a background token, configures, then schedules, in that order', async () => {
    const native = fakeNative();
    const api = fakeApi(native.calls);
    await startBackgroundSync({ platform: 'android', baseUrl: 'http://x', api, native, ios: ios() });
    expect(native.calls).toEqual(['backgroundToken', 'configure:http://x:child-token', 'schedule:15']);
  });

  it('android: does nothing when already configured and scheduled', async () => {
    const native = fakeNative(status({ configured: true, scheduled: true }));
    const api = fakeApi(native.calls);
    await startBackgroundSync({ platform: 'android', baseUrl: 'http://x', api, native, ios: ios() });
    expect(native.calls).toEqual([]);
  });

  it('android: reconfigures when the worker lost its credentials', async () => {
    const native = fakeNative(status({ configured: false, scheduled: true }));
    const api = fakeApi(native.calls);
    await startBackgroundSync({ platform: 'android', baseUrl: 'http://x', api, native, ios: ios() });
    expect(native.calls).toEqual(['backgroundToken', 'configure:http://x:child-token', 'schedule:15']);
  });

  it('android without the native module does nothing', async () => {
    const native = fakeNative(status(), false);
    const api = fakeApi(native.calls);
    await startBackgroundSync({ platform: 'android', baseUrl: 'http://x', api, native, ios: ios() });
    expect(native.calls).toEqual([]);
    expect(api.backgroundToken).not.toHaveBeenCalled();
  });

  it('ios registers the JS task and never touches the native module', async () => {
    const native = fakeNative();
    const api = fakeApi(native.calls);
    const i = ios();
    await startBackgroundSync({ platform: 'ios', baseUrl: 'http://x', api, native, ios: i });
    expect(i.register).toHaveBeenCalledTimes(1);
    expect(native.getStatus).not.toHaveBeenCalled();
    expect(api.backgroundToken).not.toHaveBeenCalled();
  });

  it('ios registration failure is swallowed', async () => {
    const i = ios();
    i.register.mockRejectedValue(new Error('not available in Expo Go'));
    const native = fakeNative();
    await expect(
      startBackgroundSync({ platform: 'ios', baseUrl: 'http://x', api: fakeApi([]), native, ios: i }),
    ).resolves.toBeUndefined();
  });

  it('other platforms (web) do nothing', async () => {
    const native = fakeNative();
    const i = ios();
    await startBackgroundSync({ platform: 'web', baseUrl: 'http://x', api: fakeApi([]), native, ios: i });
    expect(i.register).not.toHaveBeenCalled();
    expect(native.calls).toEqual([]);
  });
});

describe('stopBackgroundSync', () => {
  it('clears native state and unregisters ios', async () => {
    const native = fakeNative();
    const i = ios();
    await stopBackgroundSync({ native, ios: i });
    expect(native.cancelAndClear).toHaveBeenCalledTimes(1);
    expect(i.unregister).toHaveBeenCalledTimes(1);
  });

  it('ignores errors from either side', async () => {
    const native = fakeNative();
    native.cancelAndClear.mockRejectedValue(new Error('boom'));
    const i = ios();
    i.unregister.mockRejectedValue(new Error('boom'));
    await expect(stopBackgroundSync({ native, ios: i })).resolves.toBeUndefined();
    expect(i.unregister).toHaveBeenCalledTimes(1);
  });
});

describe('runBackgroundSync', () => {
  const snapshot: Snapshot = {
    server_time: 't',
    portfolio: { cash: '1', realized_pnl: '0', unrealized_pnl: '0', equity: '1', positions: [] },
    orders: [],
    transactions: [],
    watchlist: [],
  };

  function tokens(refresh: string | null): TokenStore {
    let current: Tokens | null = refresh ? { access: 'a', refresh } : null;
    return {
      getAccess: async () => current?.access ?? null,
      getRefresh: async () => current?.refresh ?? null,
      set: async (t) => {
        current = t;
      },
      clear: async () => {
        current = null;
      },
    };
  }

  function store() {
    const saved: { snapshot: Snapshot; syncedAt: number }[] = [];
    const s: LocalStore & { saved: typeof saved } = {
      saved,
      replaceSnapshot: async (snap, at) => {
        saved.push({ snapshot: snap, syncedAt: at });
      },
      readSnapshot: async () => saved[saved.length - 1] ?? null,
      clear: async () => {
        saved.length = 0;
      },
    };
    return s;
  }

  function api(snap: () => Promise<Snapshot>) {
    return { snapshot: jest.fn(snap), placeOrder: jest.fn(), cancelOrder: jest.fn() } as any;
  }

  it('not_configured without a refresh token', async () => {
    const a = api(async () => snapshot);
    expect(await runBackgroundSync({ tokens: tokens(null), api: a, store: store() })).toBe('not_configured');
    expect(a.snapshot).not.toHaveBeenCalled();
  });

  it('writes the snapshot on success', async () => {
    const s = store();
    const result = await runBackgroundSync({ tokens: tokens('r'), api: api(async () => snapshot), store: s, now: () => 99 });
    expect(result).toBe('success');
    expect(s.saved).toEqual([{ snapshot, syncedAt: 99 }]);
  });

  it('auth_lost when the session was rejected', async () => {
    const s = store();
    const result = await runBackgroundSync({
      tokens: tokens('r'),
      api: api(async () => {
        throw new ApiError(401, 'expired');
      }),
      store: s,
    });
    expect(result).toBe('auth_lost');
    expect(s.saved).toEqual([]);
  });

  it('failed on a network error and leaves the cache untouched', async () => {
    const s = store();
    await s.replaceSnapshot(snapshot, 1);
    const result = await runBackgroundSync({
      tokens: tokens('r'),
      api: api(async () => {
        throw new TypeError('offline');
      }),
      store: s,
    });
    expect(result).toBe('failed');
    expect(s.saved).toEqual([{ snapshot, syncedAt: 1 }]);
  });

  it('never places or cancels orders', async () => {
    const a = api(async () => snapshot);
    await runBackgroundSync({ tokens: tokens('r'), api: a, store: store() });
    expect(a.placeOrder).not.toHaveBeenCalled();
    expect(a.cancelOrder).not.toHaveBeenCalled();
  });
});
