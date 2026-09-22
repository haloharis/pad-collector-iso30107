# Data Collection App: Build Spec

For Claude Code. Also read `categories.seed.json` (category copy and taxonomy).
Rename this file to `CLAUDE.md` if you want it auto-loaded every session.

## 1. What we're building
A simple React Native app where volunteers record or upload short face videos for a face presentation-attack-detection (PAD) dataset. Contributors learn the categories, tag each video with a category, and upload it. **The owner re-checks every category in a separate web app (out of scope here).** No login, no AI, no automatic quality checks.

## 2. Stack
- React Native + Expo (dev builds, not Expo Go), TypeScript strict, expo-router
- `react-native-vision-camera` v4 for recording
- `expo-sqlite` for the local upload queue, `expo-file-system` for file uploads
- `expo-image-picker` for gallery videos
- Supabase: anonymous auth, private Storage bucket, Postgres with RLS, one edge function, one RPC (`confirm_upload`)
- `i18next` from day one (English first), layout RTL-ready (Urdu may come later)
- Android first; keep the iOS build working; ship iOS after Android

## 3. Screens and flows

**First launch:** Welcome (purpose, "each clip takes about 10 seconds") → Consent → Home. Ask for camera permission only when the user first taps Record, with a one-line reason. No microphone permission (camera videos have no audio).

**Consent (once, versioned):** short scrollable summary: purpose, who can see the videos, how long they're kept, how to delete them, contact email, and a required checkbox "I'm 18 or older and I agree". Store `consent_version` and time in Supabase. Re-show if the version changes. The legal wording is a placeholder to be reviewed by a lawyer.

**Home:** single column, four section headers (Real face, Printed photos, Screens, Masks), compact category cards under each (from server config, cached, with `categories.seed.json` bundled as offline fallback).
- Header: one-line purpose plus "3 steps: Learn → Record → Upload".
- Card: thumbnail or illustration, name, one-line summary (12 words max), small badge with the number of clips this install has uploaded, and a **Record** button. Categories with `availability: special` show an "Only if you have one" tag.
- Sticky bottom bar: **Record** and **Upload from gallery**.
- Top-right icon: My uploads, with a badge for pending items.

**Category detail** (tap a card): looping muted example video with captions (fall back to an illustration if no video URL), "You'll need" chips, three numbered steps, Do and Don't lists, sticky **Record this** button, secondary "Upload existing video".

**Record:**
1. Camera preview with a face-oval guide (preview only, never in the file) and a category chip at the top (tap to change).
2. 3-second countdown, then auto-start; auto-stop at 10 s with a progress ring; manual stop allowed after 5 s.
3. Review screen: playback, **Keep** or **Retake**.
4. Keep → a small confirm sheet: "Category: *Printed photo* [Change]", and (attack categories only) an optional checkbox "The face shown is my own". Then **Save** → "Record another" or "Done".

**Category picker (bottom sheet):** grouped list with a thumbnail and one-line summary per row, plus **Not sure** at the bottom. For confusable pairs (`confused_with` in the seed) show a one-line hint. Recording from a card pre-selects its category, so most users never open the picker. A category must be chosen before Save (Not sure is a valid choice).

**Upload from gallery:** multi-select videos → list with thumbnail, duration and a category chip per video (required), plus "Apply category to all". Required checkbox: "I confirm the person shown agreed to be in this dataset, or it's me." Gallery items are tagged `source = gallery`. There is no size, length or audio restriction on gallery videos. Avoid silent transcoding (on iOS use the picker's passthrough export option; check current docs). Copy each file into app storage before queuing.

**My uploads:** list with status: *Saved on phone → Uploading → Done*, failed items with a Retry button, a "Upload now" button, and the message "Keep the app open until everything says Done."

**Settings:** Wi-Fi-only uploads (default ON, with "Upload now anyway" on the queue), storage used, **Delete all my data**, privacy policy, contact, app version.

## 4. Capture settings (fixed for every camera recording)
H.264 MP4, 1920×1080, 30 fps, about 10 Mbps, HDR off, video stabilization off, no audio, portrait, front camera by default with a flip button, saved unmirrored (preview mirrored), no filters. Store recordings in app-private storage, not the gallery.

Verify option names against Vision Camera's current docs. After the first working build, run `ffprobe` on a sample file from a cheap Android phone and an iPhone and confirm codec, real fps and resolution match. **Do not continue past Milestone 1 until that check passes or we agree on a fallback.**

Save with every video (`capture_meta`, JSON): device brand and model, OS and version, camera facing, requested and actual fps/resolution, codec, duration, app version, source (`camera` or `gallery`). For gallery videos, store whatever is readable.

## 5. Supabase

**Auth:** `signInAnonymously()` on first launch, session persisted. Owner and one teammate sign in with email and password on the web app; they are listed in `admin_users`.

**Tables**
- `category_groups(key pk, name, sort)`
- `categories(key pk, group_key fk, name, summary, final_keys text[], availability, needs jsonb, steps jsonb, dos jsonb, donts jsonb, confused_with text[], example_video_url, sort, active)` seeded from `categories.seed.json`; readable by everyone.
- `final_categories(key pk, name)`: the 11 labels the owner assigns (`real, print, mask_2d, paper_mask, mask_cylinder, wrapped, mask_3d, replay_phone, replay_monitor, latex_mask, silicon_mask`).
- `installs(id = auth uid, platform, app_version, device_model, os_version, created_at)`
- `consents(id, install_id fk, consent_version, accepted_at)`
- `videos(id, install_id fk, session_id, storage_path, sha256, size_bytes, source, contributor_category, face_is_own, capture_meta jsonb, upload_status, created_at, uploaded_at, final_category fk final_categories null, review_status default 'pending', reviewer_notes)`
  - `id` is generated by the app (UUID), so the insert needs no read-back.
  - `contributor_category` = a `categories.key` or `not_sure`. **Never overwritten by review.** Keeping it lets the owner measure which categories confuse people.
  - `final_category`, `review_status` (`pending | accepted | rejected`) and `reviewer_notes` are set only by admins.
- `admin_users(user_id pk)`

**session_id:** a UUID generated when the app opens, renewed after 30 minutes in the background. It groups one sitting's clips. It is not a person ID: **split train/test by `install_id`, never by clip or session.**

**RLS**
- Contributors:
  - `videos`: **insert only**, where `install_id = auth.uid()`. No direct select or update on the table.
  - They read their own clips through the view `my_videos` (rows where `install_id = auth.uid()`; excludes `final_category`, `review_status`, `reviewer_notes`). This is how the app gets upload status and per-category counts.
  - `installs` and `consents`: insert and select own rows.
  - Read-only access to `categories`, `category_groups` and `final_categories`.
- Admins (in `admin_users`): full access to all tables.
- A trigger blocks non-admins from setting `final_category`, `review_status`, `reviewer_notes` on insert.
- Write RLS tests with two anonymous users. Required cases:
  - A cannot see B's rows (table or `my_videos`).
  - A cannot insert with B's `install_id`.
  - A cannot set `final_category`, `review_status` or `reviewer_notes`.
  - `my_videos` does not expose the reviewer columns.
  - A cannot call `confirm_upload` on B's video.
  - `confirm_upload` fails before the object exists or when the size differs, and succeeds after a matching upload.

**RPC `confirm_upload(video_id uuid)`** (`security definer`, fixed `search_path`): checks that the caller owns the row; reads the object size from `storage.objects` at `{install_id}/{video_id}.mp4`; if it equals `size_bytes`, sets `upload_status = 'uploaded'` and `uploaded_at = now()`; otherwise raises an error. This is the only way a contributor changes `upload_status`.

**Storage:** private bucket `videos`, path `{install_id}/{video_id}.mp4`. Contributors may insert only under their own folder and cannot read or list. Admins read via short-lived signed URLs (5–10 min). No per-file size cap in our config; video MIME types only. In M0, check the current upload-size limit for our Supabase plan and whether standard or resumable upload suits large files (check current docs).

**Edge function `delete-my-data`:** with the caller's JWT, deletes that install's storage objects and rows (service role inside the function). No other server code in v1. No rate limiting in v1; revisit if abused.

## 6. Upload engine
- Local SQLite queue: `id, local_uri, sha256, source, contributor_category, face_is_own, capture_meta, status (saved | uploading | uploaded | failed), attempts, video_id, error`.
- Flow per item: compute SHA-256 → insert the `videos` row (`upload_status = 'pending'`) → upload the file (file-based upload, not base64 or blobs in memory; background session on iOS) → call `confirm_upload(video_id)` → on success mark `uploaded` → delete the local file **only after that call succeeds**.
- Retry with exponential backoff; the queue resumes on app relaunch; manual Retry button.
- Check free storage before recording. Warn before uploading on mobile data.
- Android may pause uploads when the app is closed, hence the "keep the app open" message.
- SHA-256 of a file may need a native module (expo-crypto hashes strings). Decide in M0/M2 and ask before adding it (rule 7).

## 7. UX rules
- Single-column layouts, body text 16 sp or larger, touch targets 48 dp or larger, WCAG AA contrast, never color alone (icon + text), dark mode, respect system font scaling.
- Plain everyday language, short sentences starting with a verb.
- Main actions at the bottom, within thumb reach. One accent color, identical card layouts.
- Every screen has loading, empty, offline and error states. Categories and text work offline from cache.
- Camera permission denied → explain and deep-link to settings.

## 8. Milestones (stop after each; wait for approval)
- **M0 Setup:** Expo dev build, Supabase project, migrations, seed, `my_videos` view, `confirm_upload` RPC, RLS tests, anonymous auth. *Accept:* the two-user RLS test passes (all cases in section 5).
- **M1 Capture:** record, review, save locally with the fixed settings and metadata. *Accept:* ffprobe check on a cheap Android phone and an iPhone passes (section 4).
- **M2 Queue and upload:** SQLite queue, upload, `confirm_upload`, retry, local delete after confirm. *Accept:* airplane-mode test (3 clips recorded offline all upload after reconnect); force-kill mid-upload resumes; 10 clips in a row on the cheap phone with no crash.
- **M3 Content and flows:** consent, Home, category detail, picker, gallery upload, My uploads, Settings, `delete-my-data`. *Accept:* a first-time user goes from install to an uploaded clip in under 3 minutes; deletion removes rows and files.
- **M4 Polish and release:** i18n and RTL check, accessibility pass, real example videos, Android APK via EAS, then iOS build and TestFlight.

**Not in v1 (later, if needed):** AI or MediaPipe checks, server-side validation worker, rate limiting, a "most needed" hint on Home, contributor accounts.

## 9. Rules for Claude Code
1. Present a short plan at the start of each milestone and wait for approval.
2. Schema changes only through Supabase migrations; RLS on every table, with tests.
3. No secrets in the app. Only the anon key ships in the APK; the service-role key stays inside the edge function.
4. Never delete a local recording before `confirm_upload` succeeds.
5. Check current docs before using Vision Camera, expo-image-picker or Supabase Storage APIs.
6. Anything only real hardware can verify (fps, background upload, low-end phones) goes into `docs/device-tests.md` for manual testing. Don't claim it works from an emulator.
7. Ask before adding native modules or changing the capture settings.

**Kickoff prompt:** "Read SPEC.md and categories.seed.json. Start with Milestone M0. Give me your plan first and wait for approval."
