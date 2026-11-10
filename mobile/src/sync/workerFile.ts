import { Platform } from 'react-native';

/** The text of the file the Kotlin worker leaves for the app (Android only), or null if there is none. */
export async function readWorkerFileText(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  const { File, Paths } = await import('expo-file-system'); // loaded lazily: native module
  const file = new File(Paths.document, 'papertrade_sync', 'snapshot.json');
  return file.exists ? file.text() : null;
}
