# Hosting the Widevine module (Linux and Windows)

izumi handles protected (Widevine) media by hosting Google's own module itself, the way Kodi does,
rather than relying on a browser EME stack. This note records how the host works on each platform and
the findings that cost real time to discover.

## Where the module runs

- **Linux** also *plays* protected streams through izumi's own libmpv player: the module is driven
  from dedicated threads, one instance per thread ("lanes", `src-tauri/src/widevine/cdm.rs`; playback
  uses lane 0 only), over a small C++ shim
  (`src-tauri/native/widevine/host.cc`) built against Chromium's CDM interface header, and decrypted
  media reaches mpv through the in-memory `izcr://` protocol. Video is decoded by the module; audio is
  decrypt-only.
- **Windows** uses the module only to *save* a protected episode as a clear file. Its webview has EME,
  so live protected playback stays in the webview. A COM-less `.dll` cannot be driven through the
  dlopen-style C++ shim, so the host vtable is built in pure Rust (`src-tauri/src/widevine/host_win.rs`,
  loaded with `libloading`). The two hosts expose the identical `wv_*` C ABI, so `cdm.rs` drives either
  one unchanged.
- Other platforms do not build the module host at all. The whole feature is gated by the build-script
  cfg `widevine_host` (x86-64 Linux and Windows); see `src-tauri/build.rs`.

The Rust `Host_10` vtable in `host_win.rs` is laid out to match `content_decryption_module.h` exactly
(interface 10, which is what the Windows module ships). `Buffer`, `DecryptedBlock`, `VideoFrame` and
`FileIO`/`FileIOClient` are the same hand-rolled C++ objects.

## Module resolution on Windows

`fetch::installed` prefers a `widevinecdm.dll` a browser runtime already ships, newest first:

1. Microsoft Edge **WebView2** runtime (`%ProgramFiles(x86)%\Microsoft\EdgeWebView\Application\*\WidevineCdm\_platform_specific\win_x64\`) — the engine izumi's own webview uses, so the most reliable to find.
2. Microsoft Edge, then Google Chrome.
3. Otherwise the module is downloaded from Google's component-update service (`fetch.rs`), exactly as on Linux but requesting the `win` build.

The user still accepts Google's licence once (the same consent flow); `consent.json` gates every path.
`IZUMI_WIDEVINE_NO_SYSTEM=1` forces a downloaded module instead of a system copy (diagnosis / tests).

## Finding 1 — the Windows module needs persistent state + FileIO, or every Decrypt is kNoKey

`Initialize(allow_distinctive_identifier, allow_persistent_state, use_hw_secure_codecs)` **must** be
called with `allow_persistent_state = true` on the Windows module, and the host **must** return a
working `FileIO` from `Host::CreateFileIO`. With `persistent_state = false` (and `CreateFileIO`
returning null, as the Linux shim does), the licence still succeeds and reports usable keys, but every
`Decrypt()` returns `kNoKey` (status 2). The Windows build installs the content key through its
`FileIO` storage and reads it back before it can decrypt.

izumi's `FileIO` keeps that state **in memory only** (never on disk — the licence is temporary); see
`host_win.rs`. The host uses `Initialize(false, true, false)`.

(The Linux shim uses `persistent_state = false` and works, so this is a Windows-build quirk.)

## Finding 2 — decrypt-only video is only partial; saved video is decoded and re-encoded

`ContentDecryptionModule_10::Decrypt()` returns `kSuccess` for the **first (IDR) sample** of a
fragment, which is all an earlier standalone experiment tested. In sustained use the module returns
`kNoKey` for a **sparse subset of non-reference video samples** (e.g. one P-frame mid-fragment), while
its immediate neighbours decrypt fine. This was verified thoroughly: the per-sample IV is monotonic and
byte-correct (cross-checked with an independent Python CENC parser), all usable KIDs were tried, the
sample decrypts fine in isolation only when it is one of the accepted ones, and initialising the H.264
decoder does not unlock it. It is not an izumi parsing bug — it is the module refusing decrypt-only
output for those samples, most likely a deliberate anti-ripping measure.

Consequences for saving (`save.rs`):

- **Audio** is decrypted straight through `Decrypt()` — lossless, exact bytes, the production-proven
  path — and written as a clear `mp4a` track.
- **Video** goes through the module's **decode** path (`DecryptAndDecodeFrame` → I420), because the
  decoder always works, and the I420 pictures are **re-encoded** to H.264 with the user's ffmpeg
  (`libx264 -preset superfast -crf 16`, visually lossless; override the CRF with `IZUMI_WIDEVINE_CRF`,
  the preset with `IZUMI_WIDEVINE_PRESET`, the encoder with `IZUMI_WIDEVINE_ENCODER`, the ffmpeg binary
  with `IZUMI_FFMPEG_PATH`). **Saved video is therefore re-encoded; saved audio is not.**

A stream can also carry several content KIDs (Crunchyroll returns one per rung); `save.rs` tries the
track's tenc default KID first and then the other usable KIDs per sample (`candidate_kids`).

### Enum values that matter (easy to get wrong)

`VideoDecoderConfig_2` uses `VideoCodec::kCodecH264 = 2` (not 1) and `VideoFormat::kI420 = 2`
(`kYv12 = 1`). Passing the wrong codec makes the decoder return `kDecodeError`.

## Finding 3 — the module throttles each instance, so saving spreads over several

Measured on Windows (module 4.10.3112.0, a 23m40s episode at 854x480: 66,565 audio samples, 34,046
video frames; Intel Core Ultra 7 155H, 16 cores / 22 threads, mains power), all from the ignored
`live_decrypt_bench` and `live_save_writes_a_clear_file` tests in `save.rs`:

- **It is the module, not the host.** 1,000 back-to-back `Decrypt` calls on a fresh instance, samples
  already in memory, as one job on the module thread: **21–28 µs a call**. The same calls as 1,000
  separate jobs (one channel round trip each): 180–191 µs. So the pump costs ~160 µs a call and was
  removed from the hot path (each lane thread makes its calls back-to-back), but it is not the 2 ms.
- **The 2 ms is a per-instance throttle.** Host-side tracing shows the switch at almost exactly the
  2,000th `Decrypt` of each instance: calls 1,750–2,000 average ~20 µs, calls 2,000–2,250 ~1.5–2.2 ms,
  and from then on 1.6–2.6 ms for the rest of the track (whole track on one instance: 2.1–2.2 ms a call,
  140–148 s). Nothing in host state changes at the switch (no FileIO writes, one pending timer, no
  growth). A fresh instance opened next to a throttled one runs at 25–29 µs. Resting the throttled
  instance for 5 s did not reliably reset it (once 29 µs, once 4.7 ms). Video decode
  (`DecryptAndDecodeFrame`) is throttled the same way: one instance runs the whole video at 2.2–6.4 ms
  a frame (329 fps), two instances at 611 fps aggregate.
- **So instances are the lever.** Audio on N instances, each decrypting a contiguous slice: N=1 144 s,
  2 89 s, 3 44 s, 4 31 s, 6 20 s (3,377 calls/s) — near-linear. A licence per extra instance costs
  190–440 ms (median ~240 ms), fetched concurrently.

### How a save uses it (`save.rs`, `cdm.rs`)

- Each instance lives on its own lane thread. A save plans `total` lanes (`cdm::max_lanes`) and splits
  them between audio and video (`lane_plan`) to minimise the slower track, using the measured module
  cost per media second (audio ~94 ms, video ~72 ms) and the encoder's ceiling (~22 ms per media second
  at 854x480 for libx264 superfast, scaled by picture area). Audio and video run concurrently.
- **Audio**: a prefetcher fetches fragments in order (6 in flight); whichever audio lane is free takes the
  next one, decrypts it and writes it at the fragment's own offset in `audio.mp4` (the clear layout keeps
  every offset), so lanes may finish out of order with no reorder buffer.
- **Video**: every fragment opens on an IDR (checked; if not, video stays on one lane), so a lane decodes
  one whole fragment from a clean decoder — samples, drain, reset — and checks it got one picture per
  sample. An orderer hands fragments to the single ffmpeg strictly by index. A lane may not start more
  than one window (its lane count) ahead of the encoder, so the worst case in memory is about
  (video lanes − 1) whole decoded fragments; `VIDEO_REORDER_BUDGET` (512 MB) caps video lanes from the
  picture size (854x480 with 4 s fragments: 7; 1080p: 1). A fragment that cannot be split this way
  restarts the video on one lane.
- **Failure handling**: an extra lane that cannot be licensed is dropped and the save continues on the
  rest (none at all: audio shares lane 0). A lane whose decrypt or decode fails hands its fragment back
  to the survivors and drops out; the save fails only when no lane is left. If one track fails, the
  other's lanes are stopped through the save's cancel flag.
- **Lane count**: `IZUMI_WIDEVINE_LANES` (1–16) overrides; 1 is one instance doing audio then video, for
  weak machines. Otherwise half the hardware threads, at most 6 (a 4-core / 8-thread handheld gets 4).
- **Power**: the lane threads and the ffmpeg child opt out of Windows power throttling (EcoQoS). Before
  that, a run of saves while the display was idle went 2–9x slower in video (module 6–12 ms a frame at
  14–18 % CPU) and recovered once the session was active again.
- Progress is the bytes written on the original (encrypted) scale: audio counts fragments as they hit
  the disk, video counts fragments as the encoder takes them, both monotonic (135 reports over a 41 s
  save, never decreasing, largest step 2.3 MB of 130.6 MB).

### Before / after, one whole save (854x480, debug build)

| Stage | Before (one instance, e7959c31) | After, default (3 audio + 3 video lanes) |
| --- | --- | --- |
| Licence | 1 × ~250 ms | 6 concurrently, 218–259 ms each |
| Audio decrypt | 136.3 s (one instance, throttled) | 41.1 s (3 lanes) |
| Video decode + encode | 84.4 s (403 fps, after audio) | 27.3–31.0 s (1,100–1,245 fps), concurrent with audio |
| Whole save | **222.1 s** | **41.1 s** (5.4x) |
| Peak working set | 132 MB | 316 MB |

### Lane sweep (same episode, `IZUMI_WIDEVINE_LANES=N`, default plan for each N)

| N | Audio + video lanes | Save | Audio | Video (fps) | Peak memory | CPU avg / peak |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | shared, sequential | 205.0 s | 136.1 s | 68.8 s (495) | 132 MB | 16 % / 38 % |
| 2 | 1 + 1 | 130.6 s | 130.6 s | 64.9 s (524) | 137 MB | 18 % / 46 % |
| 3 | 2 + 1 | 65.0 s | 63.7 s | 65.0 s (524) | 143 MB | 24 % / 47 % |
| 4 | 2 + 2 | 63.2 s | 63.2 s | 33.2 s (1,027) | 254 MB | 37 % / 85 % |
| 5 | 3 + 2 | 41.1 s | 41.0 s | 32.2 s (1,056) | 269 MB | 41 % / 69 % |
| 6 | 3 + 3 | 41.0 s | 41.0 s | 29.8 s (1,144) | 320 MB | 57 % / 90 % |
| 8 | 4 + 4 | 29.8 s | 29.8 s | 29.6 s (1,150) | 411 MB | 71 % / 90 % |
| 10 | 6 + 4 | 32.8 s | 18.9 s | 32.8 s (1,039) | 413 MB | 75 % / 89 % |
| 12 | 7 + 5 | 33.4 s | 15.4 s | 33.4 s (1,021) | 494 MB | 76 % / 89 % |
| 16 | 9 + 7 | 31.7 s | 11.4 s | 31.7 s (1,075) | 622 MB | 73 % / 89 % |

It flattens at **8 lanes (~30 s)**: past that the single libx264 encoder is the limit (~1,100 fps; it
spends 28–32 s of the video stage waiting) and the machine sits at ~75 % CPU. Each lane costs ~35–40 MB
(module instance plus, for video, a decoded fragment in the reorder window). The default stays at 6.
(The 10–16 rows predate the encoder-aware plan, which now gives 16 lanes 12 + 4.)

### Hardware encoders (`IZUMI_WIDEVINE_ENCODER`, default lanes)

| Encoder | Video stage | Whole save | CPU avg | Size | vs libx264 (6,000 frames) |
| --- | --- | --- | --- | --- | --- |
| libx264 superfast crf 16 (default) | 27.3–31.0 s, 1,100–1,245 fps | 41.1 s | 53–58 % | 349.5 MB | — |
| h264_nvenc p4 cq 19 (RTX 4060 Laptop) | 20.0 s, 1,700 fps | 41.2 s | 25 % | 214.6 MB | SSIM 0.992, PSNR 47.1 dB |
| h264_qsv faster gq 19 (Arc iGPU) | 43.2 s, 788 fps | 44.4 s | 18 % | 119.4 MB | SSIM 0.989, PSNR 45.3 dB |
| h264_amf / h264_vaapi (absent here) | falls back to libx264 | 41.1 s | 57 % | 349.5 MB | byte-identical |

A requested hardware encoder is probed with a tiny test encode first and falls back to libx264 when it
is missing; `auto` tries nvenc, qsv, amf, vaapi in turn. libx264 stays the default: at default lanes the
save is audio-bound, so nvenc only frees CPU, and the software path is deterministic (the gate below).

### Correctness gate

A save at any lane count must produce **byte-identical** files to `IZUMI_WIDEVINE_LANES=1` on the same
episode with the software encoder (audio is exact decrypted bytes; libx264 is deterministic for identical
input, so equal video hashes prove the reordered pictures are complete and in order). Measured: lanes 1,
2, 3, 4, 5, 6, 8, 10, 12, 16 and the default all gave `video.mp4` SHA-256 `78E882608B88…` and
`audio.mp4` `A17F218807F3…`, 34,046 frames, `ffprobe` clean, `ffmpeg -v error -f null` exit 0 on both.
Hardware encodes are checked decode-clean and against libx264 by SSIM/PSNR instead.

Run it with `IZUMI_LIVE_SAVE_MANIFEST`, `IZUMI_LIVE_SAVE_LICENSE`, `IZUMI_LIVE_SAVE_DATA` and
`IZUMI_LIVE_SAVE_OUT` set: `cargo test --lib live_save_writes_a_clear_file -- --ignored`, once with
`IZUMI_WIDEVINE_LANES=1` and once without, then compare the two folders' hashes.

## What is untested

- **macOS** keeps the webview path for both playback and saving; the module host is not built there.
- **Android** delegates playback to an external player and is unaffected.
- Linux was measured once, under WSL2 on the same machine (Ubuntu 24.04, `libwidevinecdm.so`
  4.10.3112.0 through the C++ shim, distro ffmpeg): one lane 194.9 s (audio 129.3 s, video 65.5 s),
  default 3 + 3 lanes 51.0 s (audio 40.8 s, video 51.0 s at 668 fps, waiting 50.5 s on that slower
  libx264). Audio was byte-identical to the Windows save; video was byte-identical between the two
  Linux runs (a different libx264 build from Windows, so not to the Windows file). The shim keeps all
  per-instance state in its `Host` (the buffer pool is per host and locked; module load is locked) and
  each lane thread is seccomp-filtered on its own. A real Linux desktop and a Steam Deck are not
  measured. rustc 1.95 hits an internal compiler error in `drm_gif_capture_loop` on Linux; 1.96.1
  (the Windows toolchain) builds it.