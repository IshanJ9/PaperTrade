import { requireOptionalNativeModule } from 'expo-modules-core';

export type SyncStatus = {
  configured: boolean;
  scheduled: boolean;
  lastRunAtMs: number | null;
  lastOutcome: string | null;
};

/** The functions the Kotlin module (modules/papertrade-sync/android) exposes. Android only. */
export interface NativePapertradeSync {
  configure(baseUrl: string, refreshToken: string): Promise<void>;
  schedule(intervalMinutes: number): Promise<void>;
  cancelAndClear(): Promise<void>;
  getStatus(): Promise<SyncStatus>;
}

// null on iOS, in Expo Go and in unit tests: the JavaScript sync is used there instead.
export default requireOptionalNativeModule<NativePapertradeSync>('PapertradeSync');
