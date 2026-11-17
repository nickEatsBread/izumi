# Hosting the Widevine module (Linux, Windows and macOS)

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
- **macOS** (Apple silicon and Intel) is the same as Windows: the module only *saves* protected
  episodes, playback stays in the webview, and the host is the same Rust one (`host_win.rs`, named for
  where it started). See [macOS](#macos) below.
- Other platforms do not build the module host at all. The whole feature is gated by the build-script
  cfg `widevine_host` (x86-64 Linux and Windows, arm64 and x86-64 macOS); see `src-tauri/build.rs`.

The Rust `Host_10` vtable in `host_win.rs` is laid out to match `content_decryption_module.h` exactly
(interface 10, which is what the Windows and Mac modules ship). `Buffer`, `DecryptedBlock`, `VideoFrame`
and `FileIO`/`FileIOClient` are the same hand-rolled C++ objects. The Mac module uses the Itanium C++
ABI rather than MSVC's; vtables still list methods in declaration order, and the one difference (two
destructor slots instead of one) does not move anything because every class declares its destructor
last.

### Two capabilities, two fields

`widevine_status` reports `supported` (the host is built, so protected episodes can be **saved** through
it) and `playback` (protected streams also **play** through izumi's own player, Linux only) separately,
plus `available` (a browser's module version found on the device). The frontend routes downloads on
`supported` and playback on `playback` (`src/lib/player/native-drm.ts`). They were one flag once, which
sent Windows playback to the native surface its backend refuses; keep them apart.

### Setting it up

The user accepts Google's licence once; `consent.json` gates every path. It is offered on the first
protected stream (Linux), from Settings › Playback › Protected video ("Set up", every platform with the
host), or accepted when a pack asks for the module. When a browser on the device already ships the
module (WebView2/Edge/Chrome on Windows, Chrome on macOS), setup uses that copy and its own `LICENSE`
and downloads nothing (`fetch::stage` / `fetch::accept`); consent is still asked for and recorded.

## Module resolution on Windows

`fetch::installed` prefers a `widevinecdm.dll` a browser runtime already ships, newest first:

1. Microsoft Edge **WebView2** runtime (`%ProgramFiles(x86)%\Microsoft\EdgeWebView\Application\*\WidevineCdm\_platform_specific\win_x64\`) — the engine izumi's own webview uses, so the most reliable to find.
2. Microsoft Edge, then Google Chrome.
3. Otherwise the module is downloaded from Google's component-update service (`fetch.rs`), exactly as on Linux but requesting the `win` build.

The user still accepts Google's licence once (the same consent flow); `consent.json` gates every path.
`IZUMI_WIDEVINE_NO_SYSTEM=1` forces a downloaded module instead of a system copy (diagnosis / tests).

## macOS

### Module resolution

Google ships the Mac module as two **thin** dylibs, one per architecture, so each slice of a build loads
its own: `_platform_specific/mac_arm64/libwidevinecdm.dylib` on Apple silicon, `mac_x64` on Intel and for
the x86-64 slice under Rosetta (chosen at compile time by `target_arch`). `fetch::installed` looks, newest
module version first:

1. In an installed **Google Chrome** (`/Applications` or `~/Applications`):
   `Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/<chrome>/Libraries/WidevineCdm/_platform_specific/<dir>/`,
   every `Versions/*` entry including `Current`, with `manifest.json` and `LICENSE` in `WidevineCdm/`.
2. In Chrome's component folder: `~/Library/Application Support/Google/Chrome/WidevineCdm/<version>/_platform_specific/<dir>/`.
3. Otherwise it downloads the module from Google's component-update service (appid
   `oimompecagnajdejgnnjijobebaeigek`, platform `Mac OS X`, arch `arm64` or `x64`); the CRX holds only
   that architecture's dylib. Measured: the service serves the same bytes Chrome bundles, without
   authentication.

The binary is validated as a 64-bit Mach-O (`MH_MAGIC_64`) for the running architecture's CPU type, or a
universal file containing that slice. `IZUMI_WIDEVINE_NO_SYSTEM=1` skips Chrome's copies, as on Windows.

### Build and signing rules

- **Universal is the target, arm64 is what ships today.** The app should ship as a universal binary so
  Intel Macs get the `mac_x64` path. The release workflow currently builds **arm64 only** (`macos-15`,
  Homebrew libmpv bundled with dylibbundler). Going universal is a known follow-up: it needs an x86-64
  libmpv/ffmpeg dependency tree (Intel Homebrew under `/usr/local`, run under Rosetta), each bundled
  dylib `lipo`-merged with its arm64 twin, and every merged file re-signed.
- **After any `lipo`, `strip` or `install_name_tool`, finish with `codesign --force --sign -`** on what
  was changed. Those tools invalidate the existing signature, and Apple silicon's kernel kills a binary
  whose signature is invalid. Hosted runners have SIP off, so a broken seal still runs there; verify the
  seal with `codesign --verify --strict` instead. The release already does this for its bundled ffmpeg
  and checks the app bundle's seal.
- **Entitlements.** `src-tauri/Entitlements.plist` (wired through `bundle.macOS.entitlements` in
  `tauri.conf.json`) carries `com.apple.security.cs.disable-library-validation`. Library validation
  comes with the **hardened runtime**, and under it only Apple-signed or same-team code may load.
  Google's dylib is signed by Google's team (`EQHXZ8M8AV`). So:
  - **ad-hoc / Actions builds** (today's release: ad-hoc, `hardenedRuntime: false`) do **not** need the
    entitlement. Validation is not in play, so it is harmless there.
  - a **Developer-ID-signed, notarized** build (hardened runtime) **needs** it to load Google's copy.
    This is Apple's documented rule. It is not shown on CI, which has no Apple credentials and SIP off.
    A copy re-signed with izumi's own identity should load without it.

### Verified on CI (`.github/workflows/macos-widevine.yml`)

The workflow is manual (`workflow_dispatch`), on a `macos-15` Apple-silicon runner with Chrome
157.0.8103.39 preinstalled (module 4.10.3112.0). Every cargo command runs from `src-tauri`. Two jobs:

- **arm64 (native)**: `cargo check --lib` and `cargo test --lib widevine` pass. The module is then set up
  through the app (`fetch::stage` + `fetch::accept`), and the ignored `live_licence_keys_arrive` test
  licenses through `save.rs`'s own `license()`. It then decrypts one encrypted audio fragment through
  `cdm.rs`, and runs one encrypted video fragment through the module's H.264 decoder, as a save does.
  Run 43887774908:

  ```
  [live] set up module 4.10.3112.0 at …/Versions/Current/Libraries/WidevineCdm/_platform_specific/mac_arm64/libwidevinecdm.dylib (a browser's copy, nothing downloaded)
  [probe] arch=aarch64 proc_translated=0
  [probe] licence: 5 usable key(s): 26470f42…, 4d4b0ca2…, 51745386…, 902a051a…, f0937e9a…
  [probe] audio: fragment 3 decrypted, 187 of 187 samples changed
  [probe] video 1024x436: fragment 3, 96 samples -> 96 pictures (96 not black)
  ```

  The same probe also passes in two other setups. One uses the test binary re-signed ad-hoc with the
  hardened runtime and `Entitlements.plist` (`flags=0x10002(adhoc,runtime)`, entitlement
  `com.apple.security.cs.disable-library-validation`). The other uses a module downloaded from Google
  (`IZUMI_WIDEVINE_NO_SYSTEM=1`), whose dylib is byte-identical to Chrome's (sha256
  `e1e9f6b0…6e5f` for both).
- **x86_64 (Rosetta)**: `cargo check --lib --target x86_64-apple-darwin` and `cargo test --lib widevine`
  pass for the Intel slice, which runs under Rosetta. Its test binary links a libmpv stub, since it
  never calls into mpv. The same probe picks `mac_x64` (run 43887774908):

  ```
  [live] set up module 4.10.3112.0 at …/_platform_specific/mac_x64/libwidevinecdm.dylib (a browser's copy, nothing downloaded)
  [probe] arch=x86_64 proc_translated=1
  [probe] RESULT ok … keys=5 audio_samples=187 audio_changed=187 video=1024x436 video_samples=96 video_pictures=96
  ```

The licence server is Google's public Shaka test proxy (`cwip-shaka-proxy.appspot.com/no_auth`) with
its `sintel-widevine` asset. It needs no account. The same probe passes on Windows (Chrome's
`win_x64` copy, same counts).

## Known limitation — the save parser reads plain CENC fragments only

`fmp4::plan_fragment` handles fragments whose encryption is described by `senc` (with `saiz`/`saio`)
and one key per track. Two layouts it refuses, on every platform, are common in public test assets:

- **Sample groups (`sbgp`/`sgpd` `seig`)**, used for key rotation or to mark clear samples: refused with
  "sample-group key rotation is not supported". A source that uses them **plays** (in the webview, or
  Linux's player where it applies) but **cannot be saved**. Google's `angel-one-widevine` asset carries
  them in every fragment.
- **A clear lead**: unencrypted fragments (no `senc`) before the encrypted ones fail with "senc covers 0
  samples, trun has N". A save would stop at the first one. Both `angel-one-widevine` and
  `sintel-widevine` open with a clear lead (sintel: fragments 0–2), which is why CI probes single
  encrypted fragments rather than a whole save.

The source the measurements in this document come from uses neither. Its episodes saved end to end on
Windows and Linux with this parser, every fragment plain CENC with subsamples. So this is a limitation of
what the saver reads, not a sign that saving is broken. The audio choice also skips non-MP4 rungs (e.g.
a WebM/Opus rung next to MP4 ones), since only ISO-BMFF is read.

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

- **macOS against a real stream source.** CI licensed only against Google's public test proxy, which
  needs no account. Saving from **Crunchyroll** on macOS is **unproven**: its licence server, its
  per-rung KIDs and whether it treats the Mac module differently have not been exercised.
- **macOS with a real Developer-ID-signed, notarized build** is unproven: no Apple credentials on CI.
  The entitlement above follows Apple's documented rule; it has not been observed doing its job.
- **macOS with SIP on** is unproven: hosted runners ship with SIP disabled, so library validation and
  kernel signature checks were never enforced there. Run the workflow's steps on a SIP-enabled Mac to
  close it.
- **An Intel Mac** (as opposed to the x86-64 slice under Rosetta) and **a universal release build** are
  unproven; see the build rules above.
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