const EMPTY = { configured: false, scheduled: false, lastRunAtMs: null, lastOutcome: null };

function load(nativeModule: unknown) {
  let mod: typeof import('../../index');
  jest.isolateModules(() => {
    jest.doMock('expo-modules-core', () => ({ requireOptionalNativeModule: () => nativeModule }));
    mod = require('../../index');
  });
  return mod!;
}

function fakeNative() {
  return {
    configure: jest.fn(async () => {}),
    schedule: jest.fn(async () => {}),
    cancelAndClear: jest.fn(async () => {}),
    getStatus: jest.fn(async () => ({ configured: true, scheduled: true, lastRunAtMs: 5, lastOutcome: 'SUCCESS' })),
  };
}

it('without the native module every call resolves and the status is empty', async () => {
  const sync = load(null);
  expect(sync.isNativeSyncAvailable).toBe(false);
  await expect(sync.configure({ baseUrl: 'http://x', refreshToken: 't' })).resolves.toBeUndefined();
  await expect(sync.schedule()).resolves.toBeUndefined();
  await expect(sync.cancelAndClear()).resolves.toBeUndefined();
  await expect(sync.getStatus()).resolves.toEqual(EMPTY);
});

it('with the native module calls pass through with the same arguments', async () => {
  const native = fakeNative();
  const sync = load(native);
  expect(sync.isNativeSyncAvailable).toBe(true);
  await sync.configure({ baseUrl: 'http://x', refreshToken: 'tok' });
  expect(native.configure).toHaveBeenCalledWith('http://x', 'tok');
  await sync.cancelAndClear();
  expect(native.cancelAndClear).toHaveBeenCalledTimes(1);
  await expect(sync.getStatus()).resolves.toEqual({ configured: true, scheduled: true, lastRunAtMs: 5, lastOutcome: 'SUCCESS' });
});

it('schedule defaults to 15 minutes', async () => {
  const native = fakeNative();
  await load(native).schedule();
  expect(native.schedule).toHaveBeenCalledWith(15);
});

it('schedule never passes less than 15 minutes', async () => {
  const native = fakeNative();
  const sync = load(native);
  await sync.schedule(5);
  await sync.schedule(60);
  expect(native.schedule.mock.calls).toEqual([[15], [60]]);
});
