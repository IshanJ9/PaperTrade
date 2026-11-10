package expo.modules.papertradesync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Holds the worker's refresh token. The AES-256 key lives in the Android Keystore (never in app storage);
 * only the AES-GCM ciphertext and its IV are written to private SharedPreferences.
 */
class KeystoreTokenVault(context: Context) : TokenVault {
  private val prefs = context.getSharedPreferences("papertrade_sync_secret", Context.MODE_PRIVATE)

  override fun refreshToken(): String? {
    val ciphertext = prefs.getString(KEY_CIPHERTEXT, null) ?: return null
    val iv = prefs.getString(KEY_IV, null) ?: return null
    return try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
      String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), Charsets.UTF_8)
    } catch (e: GeneralSecurityException) {
      null // key was invalidated (for example the lock screen changed): treat as not configured
    }
  }

  override fun saveRefreshToken(token: String) {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
    // commit() (synchronous) so a rotated token is on disk before the worker uses it
    prefs.edit()
      .putString(KEY_CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
      .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .commit()
  }

  override fun clear() {
    prefs.edit().remove(KEY_CIPHERTEXT).remove(KEY_IV).commit()
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  private companion object {
    const val ALIAS = "papertrade_sync_key"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val KEY_CIPHERTEXT = "refresh_ct"
    const val KEY_IV = "refresh_iv"
  }
}
