package expo.modules.papertradesync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Runs one SyncEngine pass while the app may be closed. Read-only: it never places or flushes orders. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val prefs = SyncPrefs(applicationContext)
    val baseUrl = prefs.baseUrl
    val outcome = if (baseUrl == null) {
      SyncOutcome.NOT_CONFIGURED
    } else {
      SyncEngine(
        HttpSyncApi(baseUrl),
        KeystoreTokenVault(applicationContext),
        FileSnapshotCache(snapshotDir(applicationContext)),
      ) { System.currentTimeMillis() }.run()
    }
    prefs.recordRun(System.currentTimeMillis(), outcome.name)
    Log.i(TAG, "background sync finished: $outcome")

    when (outcome) {
      SyncOutcome.SUCCESS -> Result.success()
      SyncOutcome.RETRY -> Result.retry()
      SyncOutcome.AUTH_LOST, SyncOutcome.NOT_CONFIGURED -> {
        SyncScheduler.cancel(applicationContext) // nothing to sync with: stop until the app configures us again
        Result.failure()
      }
    }
  }

  private companion object {
    const val TAG = "PapertradeSync"
  }
}
