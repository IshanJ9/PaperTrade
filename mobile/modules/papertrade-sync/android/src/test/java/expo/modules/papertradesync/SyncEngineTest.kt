package expo.modules.papertradesync

import java.io.File
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private class FakeVault(var token: String?) : TokenVault {
  override fun refreshToken(): String? = token
  override fun saveRefreshToken(token: String) {
    this.token = token
  }
  override fun clear() {
    token = null
  }
}

private class FakeCache : SnapshotCache {
  var json: String? = null
  var at: Long? = null
  var writes = 0
  override fun write(json: String, syncedAtMs: Long) {
    this.json = json
    this.at = syncedAtMs
    writes++
  }
}

private class FakeApi(
  val onRefresh: (String) -> Tokens = { Tokens("a2", "r2") },
  val onSnapshot: (String) -> String = { FIXTURE },
) : SyncApi {
  var refreshCalls = 0
  var snapshotCalls = 0
  override fun refresh(refreshToken: String): Tokens {
    refreshCalls++
    return onRefresh(refreshToken)
  }
  override fun snapshot(accessToken: String): String {
    snapshotCalls++
    return onSnapshot(accessToken)
  }
}

// The same snapshot document the TypeScript tests use (shared/snapshot.fixture.json).
// Gradle runs unit tests with the module's android/ directory as the working directory.
private val FIXTURE: String = File("../../../../shared/snapshot.fixture.json").readText()

class SyncEngineTest {
  private fun engine(api: SyncApi, vault: TokenVault, cache: SnapshotCache, now: Long = 42L) =
    SyncEngine(api, vault, cache) { now }

  @Test
  fun noRefreshTokenMeansNotConfigured() {
    val api = FakeApi()
    val outcome = engine(api, FakeVault(null), FakeCache()).run()
    assertEquals(SyncOutcome.NOT_CONFIGURED, outcome)
    assertEquals(0, api.refreshCalls)
  }

  @Test
  fun successSavesRotatedTokenBeforeFetchingAndWritesCache() {
    val vault = FakeVault("r1")
    val cache = FakeCache()
    var vaultWhenFetching: String? = "not called"
    val api = FakeApi(onSnapshot = { access ->
      vaultWhenFetching = vault.token
      assertEquals("a2", access)
      FIXTURE
    })
    val outcome = engine(api, vault, cache, now = 1234L).run()
    assertEquals(SyncOutcome.SUCCESS, outcome)
    assertEquals("r2", vaultWhenFetching) // rotated token already saved when the snapshot request goes out
    assertEquals(FIXTURE, cache.json)
    assertEquals(1234L, cache.at)
  }

  @Test
  fun refreshRejectedClearsVaultAndReportsAuthLost() {
    val vault = FakeVault("r1")
    val cache = FakeCache()
    val outcome = engine(FakeApi(onRefresh = { throw AuthRejected() }), vault, cache).run()
    assertEquals(SyncOutcome.AUTH_LOST, outcome)
    assertNull(vault.token)
    assertEquals(0, cache.writes)
  }

  @Test
  fun networkErrorOnRefreshKeepsTokenAndRetries() {
    val vault = FakeVault("r1")
    val outcome = engine(FakeApi(onRefresh = { throw IOException("offline") }), vault, FakeCache()).run()
    assertEquals(SyncOutcome.RETRY, outcome)
    assertEquals("r1", vault.token)
  }

  @Test
  fun serverErrorOnRefreshKeepsTokenAndRetries() {
    val vault = FakeVault("r1")
    val outcome = engine(FakeApi(onRefresh = { throw HttpError(500) }), vault, FakeCache()).run()
    assertEquals(SyncOutcome.RETRY, outcome)
    assertEquals("r1", vault.token)
  }

  @Test
  fun snapshotFailureStillKeepsTheNewRefreshToken() {
    val vault = FakeVault("r1")
    val cache = FakeCache()
    val outcome = engine(FakeApi(onSnapshot = { throw IOException("dropped") }), vault, cache).run()
    assertEquals(SyncOutcome.RETRY, outcome)
    assertEquals("r2", vault.token)
    assertEquals(0, cache.writes)
  }

  @Test
  fun serverErrorOnSnapshotRetries() {
    val cache = FakeCache()
    val outcome = engine(FakeApi(onSnapshot = { throw HttpError(500) }), FakeVault("r1"), cache).run()
    assertEquals(SyncOutcome.RETRY, outcome)
    assertEquals(0, cache.writes)
  }

  @Test
  fun nonSnapshotBodyIsNeverCached() {
    for (body in listOf("<html>502 Bad Gateway</html>", "{}", "[]", "", """{"portfolio": {}}""")) {
      val cache = FakeCache()
      val outcome = engine(FakeApi(onSnapshot = { body }), FakeVault("r1"), cache).run()
      assertEquals("body: $body", SyncOutcome.RETRY, outcome)
      assertEquals(0, cache.writes)
    }
  }

  @Test
  fun aCacheWriteFailureRetriesInsteadOfCrashing() {
    val cache = object : SnapshotCache {
      override fun write(json: String, syncedAtMs: Long) = throw IllegalStateException("database is locked")
    }
    assertEquals(SyncOutcome.RETRY, engine(FakeApi(), FakeVault("r1"), cache).run())
  }
}
