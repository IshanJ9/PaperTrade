import type { Snapshot } from '../api/types';

export interface LocalStore {
  replaceSnapshot(snapshot: Snapshot, syncedAt: number): Promise<void>;
  readSnapshot(): Promise<{ snapshot: Snapshot; syncedAt: number } | null>;
  clear(): Promise<void>;
}

export type SyncResult = { ok: true } | { ok: false; error: string };

export function createSyncer(
  api: { snapshot(): Promise<Snapshot> },
  store: LocalStore,
  now: () => number = Date.now,
): () => Promise<SyncResult> {
  let inFlight: Promise<SyncResult> | null = null;

  const run = async (): Promise<SyncResult> => {
    try {
      const snapshot = await api.snapshot();
      await store.replaceSnapshot(snapshot, now());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  return () => {
    if (!inFlight) inFlight = run().finally(() => { inFlight = null; });
    return inFlight;
  };
}
