import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Snapshot } from '../api/types';
import { importWorkerSnapshot, parseWorkerFile } from '../sync/workerSnapshot';
import type { LocalStore } from '../sync/syncer';

const fixtureText = readFileSync(resolve(__dirname, '../../../shared/snapshot.fixture.json'), 'utf8');
const fixture: Snapshot = JSON.parse(fixtureText);

// Kotlin writes {"synced_at": <ms>, "snapshot": <raw response body>}, so the body keeps the server's formatting.
const envelope = (syncedAt: number, body = fixtureText) => `{"synced_at":${syncedAt},"snapshot":${body}}`;

function memoryStore(cached: { snapshot: Snapshot; syncedAt: number } | null = null) {
  const store: LocalStore & { saved: { snapshot: Snapshot; syncedAt: number } | null } = {
    saved: cached,
    replaceSnapshot: async (snapshot, syncedAt) => {
      store.saved = { snapshot, syncedAt };
    },
    readSnapshot: async () => store.saved,
    clear: async () => {
      store.saved = null;
    },
  };
  return store;
}

describe('parseWorkerFile', () => {
  it('reads the snapshot and the sync time', () => {
    expect(parseWorkerFile(envelope(1234))).toEqual({ snapshot: fixture, syncedAt: 1234 });
  });

  it.each(['', 'not json', '[]', 'null', '{}', '{"synced_at":1}', '{"synced_at":"x","snapshot":{}}', '{"synced_at":1,"snapshot":{}}'])(
    'rejects a damaged file (%p)',
    (text) => {
      expect(parseWorkerFile(text)).toBeNull();
    },
  );
});

describe('importWorkerSnapshot', () => {
  it('imports a worker snapshot newer than the cache', async () => {
    const store = memoryStore({ snapshot: fixture, syncedAt: 100 });
    expect(await importWorkerSnapshot({ readText: async () => envelope(200), store })).toBe(true);
    expect(store.saved?.syncedAt).toBe(200);
  });

  it('imports into an empty cache', async () => {
    const store = memoryStore();
    expect(await importWorkerSnapshot({ readText: async () => envelope(5), store })).toBe(true);
    expect(store.saved).toEqual({ snapshot: fixture, syncedAt: 5 });
  });

  it('never replaces a newer or equal cache with older worker data', async () => {
    const store = memoryStore({ snapshot: fixture, syncedAt: 300 });
    expect(await importWorkerSnapshot({ readText: async () => envelope(300), store })).toBe(false);
    expect(await importWorkerSnapshot({ readText: async () => envelope(299), store })).toBe(false);
    expect(store.saved?.syncedAt).toBe(300);
  });

  it('does nothing when there is no file, a damaged file, or reading throws', async () => {
    const store = memoryStore();
    expect(await importWorkerSnapshot({ readText: async () => null, store })).toBe(false);
    expect(await importWorkerSnapshot({ readText: async () => 'garbage', store })).toBe(false);
    expect(
      await importWorkerSnapshot({
        readText: async () => {
          throw new Error('permission denied');
        },
        store,
      }),
    ).toBe(false);
    expect(store.saved).toBeNull();
  });
});
