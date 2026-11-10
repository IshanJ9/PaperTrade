package expo.modules.papertradesync

import android.content.Context

/** Non-secret worker state: where to sync from and how the last run went (read by getStatus). */
class SyncPrefs(context: Context) {
  private val prefs = context.getSharedPreferences("papertrade_sync_state", Context.MODE_PRIVATE)

  var baseUrl: String?
    get() = prefs.getString("base_url", null)
    set(value) {
      prefs.edit().putString("base_url", value).commit()
    }

  val lastRunAtMs: Long?
    get() = if (prefs.contains("last_run_at")) prefs.getLong("last_run_at", 0L) else null

  val lastOutcome: String?
    get() = prefs.getString("last_outcome", null)

  fun recordRun(atMs: Long, outcome: String) {
    prefs.edit().putLong("last_run_at", atMs).putString("last_outcome", outcome).commit()
  }

  fun clear() {
    prefs.edit().clear().commit()
  }
}
