import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

// App-private storage for recordings — never the camera roll (SPEC section 4).
const recordingsDir = new Directory(Paths.document, 'recordings');

function ensureRecordingsDir(): Directory {
  if (!recordingsDir.exists) recordingsDir.create({ intermediates: true });
  return recordingsDir;
}

/** Copies a just-recorded (or picked) video into app-private storage under `<id>.mp4`. */
export async function saveVideoToPrivateStorage(sourceUri: string, id: string): Promise<File> {
  const dir = ensureRecordingsDir();
  const dest = new File(dir, `${id}.mp4`);
  const source = new File(sourceUri);
  await source.copy(dest);
  return dest;
}

/** Writes the capture_meta sidecar next to the video (SPEC section 4). The M2 upload queue reads this. */
export function saveCaptureMetaSidecar(id: string, meta: Record<string, unknown>): void {
  const dir = ensureRecordingsDir();
  const file = new File(dir, `${id}.json`);
  file.create({ overwrite: true });
  file.write(JSON.stringify(meta));
}

export function deleteRecording(id: string): void {
  for (const ext of ['mp4', 'json']) {
    const f = new File(recordingsDir, `${id}.${ext}`);
    if (f.exists) f.delete();
  }
}

/** SHA-256 of the whole file, computed on-device with no native module (expo-crypto + expo-file-system only). */
export async function sha256OfFile(file: File): Promise<string> {
  const bytes = await file.bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
