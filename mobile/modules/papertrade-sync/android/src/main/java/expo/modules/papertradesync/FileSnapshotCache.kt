package expo.modules.papertradesync

import java.io.File
import java.io.IOException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Where the background worker leaves its result for the app: one JSON file, written atomically.
 *
 * The worker deliberately does NOT write the app's SQLite database. expo-sqlite bundles its own copy of
 * SQLite, the worker would use Android's system copy, and two SQLite libraries writing one WAL file in the
 * same process can corrupt it (closing a connection in one library drops the file locks the other holds).
 * The app imports this file into its own database the next time it opens or returns to the foreground.
 *
 * Format: {"synced_at": <epoch ms>, "snapshot": <the raw GET /snapshot body>}
 */
class FileSnapshotCache(private val dir: File) : SnapshotCache {
  private val target get() = File(dir, FILE_NAME)

  override fun write(json: String, syncedAtMs: Long) {
    if (!dir.isDirectory && !dir.mkdirs()) throw IOException("cannot create $dir")
    val temp = File.createTempFile("snapshot", ".tmp", dir)
    try {
      temp.writeText("""{"synced_at":$syncedAtMs,"snapshot":$json}""")
      try {
        Files.move(temp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
      } catch (e: AtomicMoveNotSupportedException) {
        Files.move(temp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
      }
    } finally {
      temp.delete() // only still there if the move failed
    }
  }

  fun clear() {
    target.delete()
  }

  companion object {
    const val FILE_NAME = "snapshot.json"
  }
}

/** <filesDir>/papertrade_sync, which the app reads as Paths.document/papertrade_sync/snapshot.json. */
fun snapshotDir(context: android.content.Context): File = File(context.filesDir, "papertrade_sync")
