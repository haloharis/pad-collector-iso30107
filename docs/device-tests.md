# Device tests

Things only real hardware can verify (SPEC.md rule 6). Never claim these pass from an
emulator — record the device, date, and actual numbers every time.

## M1: capture settings (ffprobe check, SPEC section 4)

Sample pulled via `adb exec-out run-as com.datamatics.padcollector cat files/recordings/<id>.mp4 > sample.mp4`
(app-private storage, not the gallery), then checked with `ffprobe`.

### Android — Pixel 6a, Android 16 — 2026-09-22

Front camera, `react-native-vision-camera@4.7.3`, dev build via EAS.

| Check | Target | Measured | Result |
|---|---|---|---|
| Codec | H.264 | `h264` | ✅ |
| Resolution | 1920×1080 | 1920×1080 | ✅ |
| Bit rate | ~10 Mbps | ~10.0 Mbps (`bit_rate=10006699`) | ✅ |
| Audio | none | no audio stream present | ✅ |
| HDR | off | SDR (`color_transfer=bt709`, 8-bit `yuvj420p`) | ✅ |
| Orientation | portrait | portrait (applied via track display matrix) | ✅ |
| Mirroring | saved file unmirrored (preview may be mirrored) | confirmed by recording held-up text ("AI ED TECH SUMMIT 2026 — SPEAKER") — reads correctly, not backwards | ✅ |
| FPS | 30 | `r_frame_rate=179/6` ≈ 29.83, `avg_frame_rate` ≈ 29.87 (variable, not locked) | ⚠️ accepted |

**FPS decision (2026-09-22):** Android's camera pipeline produces a variable frame rate
averaging ~29.83 fps rather than a locked 30, due to auto-exposure adjusting frame timing.
This is normal behavior on Android camera stacks generally, not a bug in our config. Owner
decided to accept this as-is rather than chase a locked constant frame rate — record the
actual average in `capture_meta` and move on. Revisit only if it turns out to matter for
model training.

**Mirroring note:** `react-native-vision-camera@4.7.3`'s `isMirrored` prop defaults to
`true` for the front camera (the saved output would be mirrored, independent of the
preview, which is always mirrored regardless of this prop). We set `isMirrored={false}`
explicitly in `record.tsx` — verified above with a real recording, not just by reading
the source.

### iPhone — not yet tested

Deferred. SPEC.md originally asked for this to pass on both platforms before continuing
past M1; owner decided (2026-09-22) to go Android-only for now and revisit iOS at M4.

## M2: queue and upload (SPEC section 8 acceptance)

Procedure for each test, using the bare-bones `/uploads` screen (M2 placeholder — not the
real My Uploads UI, that's M3):

1. **Airplane mode:** turn on airplane mode, record 3 clips, confirm they show `saved` on
   `/uploads`. Turn airplane mode off. Confirm all 3 move to `uploading` then disappear
   (uploaded + local files deleted) without opening the app again if possible, or with one
   re-open.
2. **Force-kill mid-upload:** start an upload (ideally on a slow connection), force-kill the
   app from the OS recents screen while a row shows `uploading`. Reopen the app. Confirm the
   row is retried (not stuck) and completes — this exercises `queueDb`'s reset-to-`saved` on
   startup and `uploadOne`'s idempotent confirm-first check.
3. **10-in-a-row:** record and upload 10 clips back to back on the Pixel 6a. Confirm no
   crash and no stuck rows.

Also check in Supabase after each run: the `videos` row's `upload_status` should be
`uploaded`, and the file should exist in the `videos` storage bucket at
`{install_id}/{video_id}.mp4`.

### Android — Pixel 6a, Android 16 — 2026-09-22 — passed

Dev build via EAS (rebuilt for `expo-sqlite`'s native module). Verified server-side via the
Supabase REST API (`videos` table + storage object listing) alongside the on-device
`/uploads` screen, not just by trusting the UI.

| Test | Result |
|---|---|
| Airplane mode → reconnect uploads | ✅ recorded offline, uploaded once reconnected; confirmed rows `uploaded` with matching storage objects |
| Force-kill mid-upload → resumes | ✅ killed the app while a row was `uploading`; on relaunch it resumed and completed, not stuck |
| 10 clips in a row, no crash | ✅ 10/10 uploaded (`upload_status='uploaded'`, sizes matched), app process alive throughout |

**Two real bugs found during this pass, both fixed in the same commit:**

1. **Sidecars only scanned once, at app startup.** `scanAndEnqueueSidecars()` ran a single
   time in `startUploadQueue()`. Anything recorded after that point was saved to disk fine
   (M1 worked correctly) but never made it into the SQLite queue, so `/uploads` showed
   nothing for new recordings. Fixed by re-scanning at the top of every `processQueueOnce()`
   call and whenever the uploads screen gains focus, so new recordings are picked up
   regardless of how long the app has been open.
2. **Successful uploads were deleted from the queue table entirely**, not just the local
   files. On Wi-Fi, uploads complete in ~5-10 seconds, so by the time a person opened "My
   uploads" the row was already gone — indistinguishable from nothing having happened.
   Local `.mp4`/`.json` files are still deleted immediately once `confirm_upload` succeeds
   (SPEC section 6's "never delete before verified" rule is unaffected), but the tracking
   row now stays, marked `uploaded`, so the queue can actually show *Saved → Uploading →
   Done* per SPEC section 3. The real My Uploads screen (M3) will style this properly.

## Future device tests to run here

- M1 (later): repeat the ffprobe check on additional low-end Android phones if available —
  one device is a proxy for the low end, not a guarantee every chipset matches.
- M4: repeat the full M1 table on an iPhone before shipping iOS.
