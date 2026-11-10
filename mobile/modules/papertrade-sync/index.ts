import native, { type SyncStatus } from './src/PapertradeSyncModule';

export type { SyncStatus };

/** What the rest of the app depends on, so tests can pass a fake. */
export interface SyncModule {
  isNativeSyncAvailable: boolean;
  configure(opts: { baseUrl: string; refreshToken: string }): Promise<void>;
  schedule(intervalMinutes?: number): Promise<void>;
  cancelAndClear(): Promise<void>;
  getStatus(): Promise<SyncStatus>;
}

const EMPTY_STATUS: SyncStatus = { configured: false, scheduled: false, lastRunAtMs: null, lastOutcome: null };
const MIN_INTERVAL_MINUTES = 15; // WorkManager's floor for periodic work

export const isNativeSyncAvailable = native !== null;

export async function configure(opts: { baseUrl: string; refreshToken: string }): Promise<void> {
  await native?.configure(opts.baseUrl, opts.refreshToken);
}

export async function schedule(intervalMinutes: number = MIN_INTERVAL_MINUTES): Promise<void> {
  await native?.schedule(Math.max(MIN_INTERVAL_MINUTES, intervalMinutes));
}

export async function cancelAndClear(): Promise<void> {
  await native?.cancelAndClear();
}

export async function getStatus(): Promise<SyncStatus> {
  return native ? native.getStatus() : EMPTY_STATUS;
}

export const syncModule: SyncModule = { isNativeSyncAvailable, configure, schedule, cancelAndClear, getStatus };
