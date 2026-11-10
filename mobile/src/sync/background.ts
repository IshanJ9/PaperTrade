import { ApiError, type Api, type TokenStore } from '../api/client';
import type { SyncModule } from '../../modules/papertrade-sync';
import type { LocalStore } from './syncer';

export interface IosBackground {
  register(): Promise<void>;
  unregister(): Promise<void>;
}

const INTERVAL_MINUTES = 15;

/**
 * Android: hand a dedicated refresh-token family to the Kotlin WorkManager worker and schedule it.
 * iOS: register the JavaScript background task (best effort; iOS decides when it runs).
 * Safe to call repeatedly: Android only asks the server for a token when the worker has none.
 */
export async function startBackgroundSync(deps: {
  platform: string;
  baseUrl: string;
  api: Pick<Api, 'backgroundToken'>;
  native: SyncModule;
  ios: Pick<IosBackground, 'register'>;
}): Promise<void> {
  if (deps.platform === 'ios') {
    try {
      await deps.ios.register();
    } catch (e) {
      console.warn('iOS background sync is unavailable in this build:', e);
    }
    return;
  }
  if (deps.platform !== 'android' || !deps.native.isNativeSyncAvailable) return;

  const status = await deps.native.getStatus();
  if (status.configured && status.scheduled) return;
  const refreshToken = await deps.api.backgroundToken();
  await deps.native.configure({ baseUrl: deps.baseUrl, refreshToken });
  await deps.native.schedule(INTERVAL_MINUTES);
}

export async function stopBackgroundSync(deps: { native: SyncModule; ios: Pick<IosBackground, 'unregister'> }): Promise<void> {
  await deps.native.cancelAndClear().catch(() => {});
  await deps.ios.unregister().catch(() => {});
}

export type BackgroundSyncResult = 'success' | 'failed' | 'auth_lost' | 'not_configured';

/**
 * One background refresh: pull the snapshot into the local cache. Read-only on purpose: queued orders are
 * only ever sent while the app is open, so nothing trades while the user is not looking.
 */
export async function runBackgroundSync(deps: {
  tokens: TokenStore;
  api: Pick<Api, 'snapshot'>;
  store: LocalStore;
  now?: () => number;
}): Promise<BackgroundSyncResult> {
  if (!(await deps.tokens.getRefresh())) return 'not_configured';
  try {
    const snapshot = await deps.api.snapshot();
    await deps.store.replaceSnapshot(snapshot, (deps.now ?? Date.now)());
    return 'success';
  } catch (e) {
    return e instanceof ApiError && e.status === 401 ? 'auth_lost' : 'failed';
  }
}
