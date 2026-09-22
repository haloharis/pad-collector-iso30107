import { Directory, File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import { supabase } from './supabase';
import { getQueueDb, type QueueRow, type QueueStatus } from './queueDb';
import { deleteRecording } from './videoStorage';

const recordingsDir = new Directory(Paths.document, 'recordings');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 5 * 60_000; // 5 minutes
const MAX_ATTEMPTS = 8;

/** Scans recordings/*.json sidecars written by the record flow (M1) and enqueues any not already tracked. */
export function scanAndEnqueueSidecars(): void {
  const db = getQueueDb();
  if (!recordingsDir.exists) return;

  for (const entry of recordingsDir.list()) {
    try {
      enqueueSidecarIfNew(db, entry);
    } catch (e) {
      // One bad/corrupt/half-written file must never stop the rest of the scan.
      console.warn('skipping sidecar during scan', e);
    }
  }
}

function enqueueSidecarIfNew(db: ReturnType<typeof getQueueDb>, entry: Directory | File): void {
  if (!(entry instanceof File) || entry.extension !== '.json') return;
  const id = entry.name.replace(/\.json$/, '');
  const existing = db.getFirstSync<{ id: string }>('SELECT id FROM queue WHERE id = ?', id);
  if (existing) return;

  const meta = JSON.parse(entry.textSync());
  const videoFile = new File(recordingsDir, `${id}.mp4`);
  if (!videoFile.exists) return;

  db.runSync(
    `INSERT INTO queue (id, local_video_path, local_meta_path, sha256, size_bytes, source,
      contributor_category, face_is_own, session_id, capture_meta, status, attempts, created_at, next_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', 0, ?, 0)`,
    id,
    videoFile.uri,
    entry.uri,
    meta.sha256,
    meta.size_bytes,
    meta.source ?? 'camera',
    meta.contributor_category,
    meta.face_is_own == null ? null : meta.face_is_own ? 1 : 0,
    meta.session_id,
    JSON.stringify(meta.capture_meta ?? {}),
    meta.created_at ?? new Date().toISOString(),
  );
}

export function getQueueRows(): QueueRow[] {
  return getQueueDb().getAllSync<QueueRow>('SELECT * FROM queue ORDER BY created_at DESC');
}

function setStatus(id: string, status: QueueStatus, error: string | null = null): void {
  getQueueDb().runSync('UPDATE queue SET status = ?, error = ? WHERE id = ?', status, error, id);
}

async function isOnline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync();
  return Boolean(state.isConnected && state.isInternetReachable);
}

/** Uploads to Storage's REST endpoint directly via expo-file-system (file-based, backgroundable on
 * iOS) rather than through supabase-js's upload(), which relies on React Native's fetch to stream
 * a body — unreliable for large files (SPEC section 6). */
async function uploadFileToStorage(file: File, storagePath: string, accessToken: string): Promise<void> {
  const url = `${SUPABASE_URL}/storage/v1/object/videos/${storagePath}`;
  const result = await file.upload(url, {
    httpMethod: 'POST',
    sessionType: 'background',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
      'content-type': 'video/mp4',
      'x-upsert': 'false',
    },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Storage upload failed (${result.status}): ${result.body.slice(0, 300)}`);
  }
}

/** Idempotent: safe to call again after a crash at any point, including mid-upload. */
async function uploadOne(row: QueueRow): Promise<void> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (sessionError || !session) throw sessionError ?? new Error('Not signed in');
  const installId = session.user.id;
  const storagePath = `${installId}/${row.id}.mp4`;

  const { error: insertError } = await supabase.from('videos').insert({
    id: row.id,
    install_id: installId,
    session_id: row.session_id,
    storage_path: storagePath,
    sha256: row.sha256,
    size_bytes: row.size_bytes,
    source: row.source,
    contributor_category: row.contributor_category,
    face_is_own: row.face_is_own == null ? null : Boolean(row.face_is_own),
    capture_meta: JSON.parse(row.capture_meta),
  });
  // 23505 = unique_violation: the row already exists from a previous attempt. Fine, continue.
  if (insertError && insertError.code !== '23505') throw insertError;

  // Ask the server first — it might already have a matching object from a previous attempt
  // that crashed after the bytes landed but before we recorded success locally.
  const confirmed = await supabase.rpc('confirm_upload', { p_video_id: row.id });
  if (!confirmed.error) return;

  const videoFile = new File(row.local_video_path);
  if (!videoFile.exists) throw new Error('Local video file is missing');
  await uploadFileToStorage(videoFile, storagePath, session.access_token);

  const confirmedAfterUpload = await supabase.rpc('confirm_upload', { p_video_id: row.id });
  if (confirmedAfterUpload.error) throw confirmedAfterUpload.error;
}

let processing = false;

/** Processes every due row once. Call again (e.g. from a timer or on reconnect) to keep draining. */
export async function processQueueOnce(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    // Always re-scan first: new recordings saved since the app started (or since the last
    // scan) need to land in the queue even before we know whether we're online.
    scanAndEnqueueSidecars();
    if (!(await isOnline())) return;
    const db = getQueueDb();
    const now = Date.now();
    const due = db.getAllSync<QueueRow>(
      `SELECT * FROM queue WHERE status IN ('saved', 'failed') AND next_attempt_at <= ? ORDER BY created_at ASC`,
      now,
    );

    for (const row of due) {
      setStatus(row.id, 'uploading');
      try {
        await uploadOne(row);
        // Keep the row (marked 'uploaded') so "My uploads" can show it as done — only the
        // local files are deleted, and only now that the upload is confirmed (SPEC section 6).
        setStatus(row.id, 'uploaded');
        deleteRecording(row.id);
      } catch (e: any) {
        const attempts = row.attempts + 1;
        const message = String(e?.message ?? e);
        const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** row.attempts);
        db.runSync(
          `UPDATE queue SET status = 'failed', error = ?, attempts = ?, next_attempt_at = ? WHERE id = ?`,
          message,
          attempts,
          attempts >= MAX_ATTEMPTS ? Number.MAX_SAFE_INTEGER : Date.now() + backoff,
          row.id,
        );
        console.warn('upload failed', row.id, message);
      }
      if (!(await isOnline())) break; // stop draining if we just lost connectivity
    }
  } finally {
    processing = false;
  }
}

/** Starts a periodic drain loop and re-triggers immediately when connectivity returns. Call once at app start. */
export function startUploadQueue(): () => void {
  scanAndEnqueueSidecars();
  void processQueueOnce();

  const interval = setInterval(() => void processQueueOnce(), 20_000);
  const sub = Network.addNetworkStateListener((state) => {
    if (state.isConnected && state.isInternetReachable) void processQueueOnce();
  });

  return () => {
    clearInterval(interval);
    sub.remove();
  };
}
