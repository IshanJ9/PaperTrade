package expo.modules.papertradesync

import java.io.IOException
import org.json.JSONException
import org.json.JSONObject

data class Tokens(val access: String, val refresh: String)

/** The refresh endpoint answered 401: the stored refresh token is expired or revoked. */
class AuthRejected : Exception("refresh token rejected")

/** The server answered with an unexpected status code. */
class HttpError(val code: Int) : Exception("HTTP $code")

interface SyncApi {
  /** Throws AuthRejected (401), HttpError (other non-2xx) or IOException (no connection / unreadable body). */
  fun refresh(refreshToken: String): Tokens

  /** Returns the raw response body. Throws HttpError or IOException. */
  fun snapshot(accessToken: String): String
}

interface TokenVault {
  fun refreshToken(): String?
  fun saveRefreshToken(token: String)
  fun clear()
}

interface SnapshotCache {
  fun write(json: String, syncedAtMs: Long)
}

enum class SyncOutcome { SUCCESS, RETRY, AUTH_LOST, NOT_CONFIGURED }

/**
 * One background sync: exchange the stored refresh token for a fresh access token, fetch /snapshot and
 * store the raw body in the app's SQLite cache.
 *
 * Every run refreshes first, because the 60-minute access token cannot be trusted after a long sleep.
 * The rotated refresh token is saved BEFORE it is used: if the process dies mid-sync the next run still
 * holds the token the server expects (and the server tolerates a just-rotated token for a minute).
 */
class SyncEngine(
  private val api: SyncApi,
  private val vault: TokenVault,
  private val cache: SnapshotCache,
  private val clock: () -> Long,
) {
  fun run(): SyncOutcome {
    val refreshToken = vault.refreshToken() ?: return SyncOutcome.NOT_CONFIGURED

    val tokens = try {
      api.refresh(refreshToken)
    } catch (e: AuthRejected) {
      vault.clear()
      return SyncOutcome.AUTH_LOST
    } catch (e: IOException) {
      return SyncOutcome.RETRY
    } catch (e: HttpError) {
      return SyncOutcome.RETRY
    }
    vault.saveRefreshToken(tokens.refresh)

    val body = try {
      api.snapshot(tokens.access)
    } catch (e: IOException) {
      return SyncOutcome.RETRY
    } catch (e: HttpError) {
      return SyncOutcome.RETRY
    }
    if (!looksLikeSnapshot(body)) return SyncOutcome.RETRY // never overwrite the cache with an error page

    return try {
      cache.write(body, clock())
      SyncOutcome.SUCCESS
    } catch (e: Exception) {
      SyncOutcome.RETRY // for example "database is locked" while the app holds the file
    }
  }

  private fun looksLikeSnapshot(body: String): Boolean =
    try {
      val json = JSONObject(body)
      REQUIRED_KEYS.all { json.has(it) } && json.optJSONObject("portfolio") != null
    } catch (e: JSONException) {
      false
    }

  private companion object {
    val REQUIRED_KEYS = listOf("server_time", "portfolio", "orders", "transactions", "watchlist")
  }
}
