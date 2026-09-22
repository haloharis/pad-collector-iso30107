import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

export type QueueStatus = 'saved' | 'uploading' | 'uploaded' | 'failed';

export interface QueueRow {
  id: string;
  local_video_path: string;
  local_meta_path: string;
  sha256: string;
  size_bytes: number;
  source: 'camera' | 'gallery';
  contributor_category: string;
  face_is_own: number | null; // SQLite has no boolean; 0/1/null
  session_id: string;
  capture_meta: string; // JSON
  status: QueueStatus;
  attempts: number;
  error: string | null;
  created_at: string;
  next_attempt_at: number; // epoch ms
}

let db: SQLiteDatabase | null = null;

// Synchronous open + migration: callers can use the DB immediately with no init race.
export function getQueueDb(): SQLiteDatabase {
  if (!db) {
    db = openDatabaseSync('upload_queue.db');
    db.execSync(`
      CREATE TABLE IF NOT EXISTS queue (
        id TEXT PRIMARY KEY NOT NULL,
        local_video_path TEXT NOT NULL,
        local_meta_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        source TEXT NOT NULL,
        contributor_category TEXT NOT NULL,
        face_is_own INTEGER,
        session_id TEXT NOT NULL,
        capture_meta TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'saved',
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        next_attempt_at INTEGER NOT NULL DEFAULT 0
      );
    `);
    // Rows left mid-upload by a force-kill get retried from the top on next launch —
    // uploadOne() always re-checks confirm_upload first, so this is safe (SPEC section 6).
    db.runSync(`UPDATE queue SET status = 'saved' WHERE status = 'uploading'`);
  }
  return db;
}
