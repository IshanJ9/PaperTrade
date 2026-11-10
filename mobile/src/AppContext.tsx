import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { syncModule } from '../modules/papertrade-sync';
import { startBackgroundSync, stopBackgroundSync } from './sync/background';
import { iosBackground } from './sync/backgroundTask';
import { createApi, type Api } from './api/client';
import type { Snapshot } from './api/types';
import { secureTokenStore } from './auth/tokenStorage';
import { API_BASE_URL } from './config';
import { flushOutbox, submitOrder, type OutboxStore, type PlaceOrderInput, type QueuedOrder, type SubmitResult } from './orders/outbox';
import { createSqliteOutbox } from './orders/outboxStore';
import { createSqliteStore, openLocalDb } from './sync/sqliteStore';
import { readWorkerFileText } from './sync/workerFile';
import { importWorkerSnapshot } from './sync/workerSnapshot';
import { createSyncer, type LocalStore } from './sync/syncer';

interface AppValue {
  api: Api;
  ready: boolean;
  signedIn: boolean;
  snapshot: Snapshot | null;
  syncedAt: number | null;
  syncError: string | null;
  queue: QueuedOrder[];
  /** Send an order now, or queue it (same client_order_id) when the server cannot be reached. */
  submit(input: PlaceOrderInput): Promise<SubmitResult>;
  removeQueued(id: string): Promise<void>;
  sync(): Promise<void>;
  /** Call after api.login / api.register succeeded (tokens are already stored). */
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedOrder[]>([]);
  const storeRef = useRef<LocalStore | null>(null);
  const outboxRef = useRef<OutboxStore | null>(null);
  const syncerRef = useRef<ReturnType<typeof createSyncer> | null>(null);
  const localSignOutRef = useRef<() => Promise<void>>(async () => {});

  // A refresh token rejected by the server (expired or revoked) signs the user out locally.
  const api = useMemo(
    () =>
      createApi({
        baseUrl: API_BASE_URL,
        tokens: secureTokenStore,
        onAuthLost: () => void localSignOutRef.current(),
      }),
    [],
  );

  const loadFromStore = useCallback(async () => {
    const cached = await storeRef.current?.readSnapshot();
    if (cached) {
      setSnapshot(cached.snapshot);
      setSyncedAt(cached.syncedAt);
    }
  }, []);

  // The Kotlin worker leaves its latest snapshot in a file; copy it into our database if it is newer.
  const importFromWorker = useCallback(async () => {
    if (storeRef.current) await importWorkerSnapshot({ readText: readWorkerFileText, store: storeRef.current });
  }, []);

  const refreshQueue = useCallback(async () => {
    setQueue((await outboxRef.current?.list()) ?? []);
  }, []);

  const sync = useCallback(async () => {
    if (!syncerRef.current) return;
    if (outboxRef.current) {
      try {
        await flushOutbox(api, outboxRef.current); // queued orders go out before the snapshot is refreshed
      } catch {
        // the outbox keeps whatever was not sent
      }
      await refreshQueue();
    }
    const result = await syncerRef.current();
    setSyncError(result.ok ? null : result.error);
    await loadFromStore();
    if (result.ok) {
      // Idempotent: hands the Kotlin worker its own credentials once, registers the iOS task. Needs the server, so it
      // runs after a successful sync and simply tries again after the next one if it failed.
      startBackgroundSync({ platform: Platform.OS, baseUrl: API_BASE_URL, api, native: syncModule, ios: iosBackground }).catch(
        () => {},
      );
    }
  }, [api, loadFromStore, refreshQueue]);

  const submit = useCallback(
    async (input: PlaceOrderInput) => {
      const result = await submitOrder(api, outboxRef.current!, input);
      await refreshQueue();
      if (result.kind === 'sent') await sync();
      return result;
    },
    [api, refreshQueue, sync],
  );

  const removeQueued = useCallback(
    async (id: string) => {
      await outboxRef.current?.remove(id);
      await refreshQueue();
    },
    [refreshQueue],
  );

  const localSignOut = useCallback(async () => {
    await storeRef.current?.clear();
    await outboxRef.current?.clear(); // queued orders belong to the user who signed out
    await stopBackgroundSync({ native: syncModule, ios: iosBackground }); // the worker must not keep syncing for a signed-out user
    setQueue([]);
    setSignedIn(false);
    setSnapshot(null);
    setSyncedAt(null);
    setSyncError(null);
  }, []);
  localSignOutRef.current = localSignOut;

  const signOut = useCallback(async () => {
    await api.logout(); // revokes the refresh token on the server (best effort) and clears local tokens
    await localSignOut();
  }, [api, localSignOut]);

  const signIn = useCallback(async () => {
    await storeRef.current?.clear(); // never show one user another user's cached data
    await outboxRef.current?.clear(); // and never send one user's queued orders as another
    setQueue([]);
    setSnapshot(null);
    setSyncedAt(null);
    setSignedIn(true);
    await sync();
  }, [sync]);

  // Start-up: open the local store, show cached data immediately, then sync.
  useEffect(() => {
    (async () => {
      const db = await openLocalDb();
      const store = await createSqliteStore(db);
      storeRef.current = store;
      outboxRef.current = await createSqliteOutbox(db);
      syncerRef.current = createSyncer(api, store);
      const hasSession = (await secureTokenStore.getRefresh()) !== null;
      setSignedIn(hasSession);
      if (hasSession) {
        await importFromWorker();
        await loadFromStore();
        await refreshQueue();
        setReady(true);
        await sync();
      } else {
        setReady(true);
      }
    })();
  }, [api, importFromWorker, loadFromStore, refreshQueue, sync]);

  // Foreground sync: on returning to the app and every 30 s while signed in.
  useEffect(() => {
    if (!signedIn) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void importFromWorker().then(loadFromStore).then(sync);
    });
    const timer = setInterval(() => void sync(), 30_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [signedIn, sync, importFromWorker, loadFromStore]);

  const value = useMemo(
    () => ({ api, ready, signedIn, snapshot, syncedAt, syncError, queue, submit, removeQueued, sync, signIn, signOut }),
    [api, ready, signedIn, snapshot, syncedAt, syncError, queue, submit, removeQueued, sync, signIn, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
