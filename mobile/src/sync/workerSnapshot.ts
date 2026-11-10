import type { Snapshot } from '../api/types';
import type { LocalStore } from './syncer';

export interface WorkerSnapshot {
  snapshot: Snapshot;
  syncedAt: number;
}

/**
 * The Kotlin background worker leaves {"synced_at": <ms>, "snapshot": <body>} in a file (it must not write
 * the app's SQLite database; see FileSnapshotCache.kt). Returns null for anything that is not that.
 */
export function parseWorkerFile(text: string): WorkerSnapshot | null {
  try {
    const value = JSON.parse(text);
    const snapshot = value?.snapshot;
    if (typeof value?.synced_at !== 'number' || !Number.isFinite(value.synced_at)) return null;
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.portfolio || typeof snapshot.portfolio !== 'object') return null;
    if (!Array.isArray(snapshot.orders) || !Array.isArray(snapshot.transactions) || !Array.isArray(snapshot.watchlist)) return null;
    return { snapshot: snapshot as Snapshot, syncedAt: value.synced_at };
  } catch {
    return null;
  }
}

/** Copy the worker's snapshot into the app database if it is newer than what the app already has. */
export async function importWorkerSnapshot(deps: { readText(): Promise<string | null>; store: LocalStore }): Promise<boolean> {
  try {
    const text = await deps.readText();
    if (text === null) return false;
    const fromWorker = parseWorkerFile(text);
    if (!fromWorker) return false;
    const cached = await deps.store.readSnapshot();
    if (cached && cached.syncedAt >= fromWorker.syncedAt) return false;
    await deps.store.replaceSnapshot(fromWorker.snapshot, fromWorker.syncedAt);
    return true;
  } catch {
    return false; // a missing/unreadable file must never break opening the app
  }
}
