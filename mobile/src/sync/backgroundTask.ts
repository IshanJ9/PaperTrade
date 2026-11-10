// Imported once from index.ts: TaskManager tasks must be defined at module scope, before the app renders.
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { createApi } from '../api/client';
import { secureTokenStore } from '../auth/tokenStorage';
import { API_BASE_URL } from '../config';
import { runBackgroundSync, type IosBackground } from './background';
import { openSqliteStore } from './sqliteStore';

export const TASK_NAME = 'papertrade-background-sync';

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const result = await runBackgroundSync({
      tokens: secureTokenStore,
      api: createApi({ baseUrl: API_BASE_URL, tokens: secureTokenStore }),
      store: await openSqliteStore(),
    });
    return result === 'success' || result === 'not_configured'
      ? BackgroundTask.BackgroundTaskResult.Success
      : BackgroundTask.BackgroundTaskResult.Failed;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// Only used on iOS. On Android the Kotlin WorkManager worker does this job, so this task is never registered there.
export const iosBackground: IosBackground = {
  register: () => BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 15 }),
  unregister: () => BackgroundTask.unregisterTaskAsync(TASK_NAME),
};
