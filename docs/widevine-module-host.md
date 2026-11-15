# Hosting the Widevine module (Linux and Windows)

izumi handles protected (Widevine) media by hosting Google's own module itself, the way Kodi does,
rather than relying on a browser EME stack. This note records how the host works on each platform and
two findings that cost real time to discover.

## Where the module runs

- **Linux** also *plays* protected streams through izumi's own libmpv player: the module is driven
  from one process-wide thread (`src-tauri/src/widevine/cdm.rs`) over a small C++ shim
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
  (`libx264 -preset veryfast -crf 12`, visually lossless; override the CRF with `IZUMI_WIDEVINE_CRF`,
  the ffmpeg binary with `IZUMI_FFMPEG_PATH`). **Saved video is therefore re-encoded; saved audio is
  not.**

A stream can also carry several content KIDs (Crunchyroll returns one per rung); `save.rs` tries the
track's tenc default KID first and then the other usable KIDs per sample (`candidate_kids`).

### Enum values that matter (easy to get wrong)

`VideoDecoderConfig_2` uses `VideoCodec::kCodecH264 = 2` (not 1) and `VideoFormat::kI420 = 2`
(`kYv12 = 1`). Passing the wrong codec makes the decoder return `kDecodeError`.

## What is untested

- **macOS** keeps the webview path for both playback and saving; the module host is not built there.
- **Android** delegates playback to an external player and is unaffected.
- The Windows save path has been validated live against a protected source (clear `video.mp4` h264 +
  `audio.mp4` aac, both decode under `ffmpeg -f null` with zero errors, and play with no network). The
  full-episode video re-encode is roughly real-time because each frame round-trips through the single
  module thread; the device/`.wvd` path (`drm_download.rs`, when present) remains the faster fallback.
