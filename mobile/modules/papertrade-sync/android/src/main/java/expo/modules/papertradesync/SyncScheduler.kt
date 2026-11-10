package expo.modules.papertradesync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object SyncScheduler {
  const val WORK_NAME = "papertrade_background_sync"
  private const val MIN_INTERVAL_MINUTES = 15L // WorkManager's floor for periodic work

  fun schedule(context: Context, intervalMinutes: Long) {
    val request = PeriodicWorkRequestBuilder<SyncWorker>(maxOf(MIN_INTERVAL_MINUTES, intervalMinutes), TimeUnit.MINUTES)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
  }

  fun cancel(context: Context) {
    WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
  }

  /** Blocking: call from a background thread. */
  fun isScheduled(context: Context): Boolean =
    WorkManager.getInstance(context).getWorkInfosForUniqueWork(WORK_NAME).get().any { !it.state.isFinished }
}
