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

## Future device tests to run here

- M2: airplane-mode queue test, force-kill mid-upload resume, 10-clip-in-a-row stress test
  on the cheap Android phone.
- M1 (later): repeat the ffprobe check on additional low-end Android phones if available —
  one device is a proxy for the low end, not a guarantee every chipset matches.
- M4: repeat the full M1 table on an iPhone before shipping iOS.
