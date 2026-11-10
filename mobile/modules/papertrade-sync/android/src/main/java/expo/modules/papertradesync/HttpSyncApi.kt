package expo.modules.papertradesync

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONException
import org.json.JSONObject

fun defaultClient(): OkHttpClient =
  OkHttpClient.Builder()
    .connectTimeout(20, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .writeTimeout(20, TimeUnit.SECONDS)
    .build()

class HttpSyncApi(baseUrl: String, private val client: OkHttpClient = defaultClient()) : SyncApi {
  private val base = baseUrl.trimEnd('/')

  override fun refresh(refreshToken: String): Tokens {
    val payload = JSONObject().put("refresh_token", refreshToken).toString()
    val request = Request.Builder()
      .url("$base/auth/refresh")
      .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType()))
      .build()
    client.newCall(request).execute().use { response ->
      if (response.code == 401) throw AuthRejected()
      if (!response.isSuccessful) throw HttpError(response.code)
      val body = response.body?.string() ?: throw IOException("empty refresh response")
      try {
        val json = JSONObject(body)
        return Tokens(json.getString("access_token"), json.getString("refresh_token"))
      } catch (e: JSONException) {
        throw IOException("unreadable refresh response", e)
      }
    }
  }

  override fun snapshot(accessToken: String): String {
    val request = Request.Builder()
      .url("$base/snapshot")
      .header("Authorization", "Bearer $accessToken")
      .get()
      .build()
    client.newCall(request).execute().use { response ->
      if (!response.isSuccessful) throw HttpError(response.code)
      return response.body?.string() ?: throw IOException("empty snapshot response")
    }
  }
}
