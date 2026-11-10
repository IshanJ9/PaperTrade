package expo.modules.papertradesync

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PapertradeSyncModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("PapertradeSync")

    // Stores where to sync and the worker's own refresh token (a separate token family from the app's).
    AsyncFunction("configure") { baseUrl: String, refreshToken: String ->
      SyncPrefs(context).baseUrl = baseUrl
      KeystoreTokenVault(context).saveRefreshToken(refreshToken)
    }

    AsyncFunction("schedule") { intervalMinutes: Int ->
      SyncScheduler.schedule(context, intervalMinutes.toLong())
    }

    AsyncFunction("cancelAndClear") {
      SyncScheduler.cancel(context)
      KeystoreTokenVault(context).clear()
      SyncPrefs(context).clear()
      FileSnapshotCache(snapshotDir(context)).clear()
    }

    AsyncFunction("getStatus") {
      val prefs = SyncPrefs(context)
      mapOf(
        "configured" to (prefs.baseUrl != null && KeystoreTokenVault(context).refreshToken() != null),
        "scheduled" to SyncScheduler.isScheduled(context),
        "lastRunAtMs" to prefs.lastRunAtMs,
        "lastOutcome" to prefs.lastOutcome,
      )
    }
  }
}
