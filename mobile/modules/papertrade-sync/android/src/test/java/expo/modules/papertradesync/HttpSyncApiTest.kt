package expo.modules.papertradesync

import java.io.IOException
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

class HttpSyncApiTest {
  private lateinit var server: MockWebServer
  private lateinit var api: HttpSyncApi

  @Before
  fun start() {
    server = MockWebServer()
    server.start()
    api = HttpSyncApi(server.url("/").toString().trimEnd('/'))
  }

  @After
  fun stop() {
    try {
      server.shutdown()
    } catch (_: IOException) {
      // already shut down by the test
    }
  }

  @Test
  fun refreshPostsJsonAndParsesTokens() {
    server.enqueue(MockResponse().setBody("""{"access_token":"A","refresh_token":"R","token_type":"bearer"}"""))
    val tokens = api.refresh("r1")
    assertEquals(Tokens("A", "R"), tokens)
    val request = server.takeRequest()
    assertEquals("POST", request.method)
    assertEquals("/auth/refresh", request.path)
    assertEquals("r1", JSONObject(request.body.readUtf8()).getString("refresh_token"))
    assertEquals(true, request.getHeader("Content-Type")!!.startsWith("application/json"))
  }

  @Test
  fun refresh401ThrowsAuthRejected() {
    server.enqueue(MockResponse().setResponseCode(401).setBody("""{"detail":"invalid refresh token"}"""))
    assertThrows(AuthRejected::class.java) { api.refresh("r1") }
  }

  @Test
  fun refresh500ThrowsHttpError() {
    server.enqueue(MockResponse().setResponseCode(500))
    val error = assertThrows(HttpError::class.java) { api.refresh("r1") }
    assertEquals(500, error.code)
  }

  @Test
  fun refreshWithAnUnreadableBodyIsAnIOException() {
    server.enqueue(MockResponse().setBody("not json"))
    assertThrows(IOException::class.java) { api.refresh("r1") }
  }

  @Test
  fun snapshotSendsBearerAndReturnsTheRawBody() {
    val body = """{ "server_time":"x",   "portfolio":{} }"""
    server.enqueue(MockResponse().setBody(body))
    assertEquals(body, api.snapshot("a1"))
    val request = server.takeRequest()
    assertEquals("GET", request.method)
    assertEquals("/snapshot", request.path)
    assertEquals("Bearer a1", request.getHeader("Authorization"))
  }

  @Test
  fun snapshot401ThrowsHttpError401() {
    server.enqueue(MockResponse().setResponseCode(401))
    val error = assertThrows(HttpError::class.java) { api.snapshot("a1") }
    assertEquals(401, error.code)
  }

  @Test
  fun connectionRefusedThrowsIOException() {
    server.shutdown()
    assertThrows(IOException::class.java) { api.snapshot("a1") }
  }
}
