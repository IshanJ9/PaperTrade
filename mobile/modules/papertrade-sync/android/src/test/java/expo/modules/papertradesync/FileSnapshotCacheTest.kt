package expo.modules.papertradesync

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

// The same snapshot document the TypeScript tests use (shared/snapshot.fixture.json).
private val SNAPSHOT: String = File("../../../../shared/snapshot.fixture.json").readText()

class FileSnapshotCacheTest {
  @get:Rule
  val tmp = TemporaryFolder()

  @Test
  fun writesAnEnvelopeWithTheSyncTimeAndTheRawSnapshot() {
    val dir = File(tmp.root, "papertrade_sync")
    FileSnapshotCache(dir).write(SNAPSHOT, 777L)
    val envelope = JSONObject(File(dir, "snapshot.json").readText())
    assertEquals(777L, envelope.getLong("synced_at"))
    assertEquals("98100.0000", envelope.getJSONObject("snapshot").getJSONObject("portfolio").getString("cash"))
  }

  @Test
  fun aSecondWriteReplacesTheFirstAndLeavesNoTemporaryFiles() {
    val dir = File(tmp.root, "papertrade_sync")
    val cache = FileSnapshotCache(dir)
    cache.write(SNAPSHOT, 1L)
    cache.write(SNAPSHOT, 2L)
    assertEquals(2L, JSONObject(File(dir, "snapshot.json").readText()).getLong("synced_at"))
    assertEquals(listOf("snapshot.json"), dir.list()!!.toList())
  }

  @Test
  fun clearRemovesTheFileAndIsHarmlessWhenThereIsNone() {
    val dir = File(tmp.root, "papertrade_sync")
    val cache = FileSnapshotCache(dir)
    cache.clear()
    cache.write(SNAPSHOT, 1L)
    assertTrue(File(dir, "snapshot.json").exists())
    cache.clear()
    assertFalse(File(dir, "snapshot.json").exists())
  }
}
