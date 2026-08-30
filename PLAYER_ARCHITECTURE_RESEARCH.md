# Player architecture research and decision record

**Date:** 2026-08-30
**Status:** Foundation plus first bounded production slice implemented; physical-device qualification remains required
**Scope:** Faster startup/seeking, broader codec/container/subtitle/DRM support, correct Dolby Vision/Atmos behavior, and a maintainable route to a best-in-class player

## Executive decision

The best architecture for Izumi is a **capability-routed hybrid**, not another universal playback engine:

1. Keep **libmpv as the default unencrypted player** on desktop and as Android's broad-container, complex-subtitle, filter, capture, and recovery path.
2. Keep **Media3 + `SurfaceView` as a narrow Android native path** for DRM and for sources whose *actual parsed format* is supported by the device decoder, display, audio route, and container path.
3. Keep **Shaka/EME for desktop DRM**. Do not attempt to make libmpv decrypt commercial DRM.
4. Add a **compatibility ladder** only when a direct route cannot preserve the requested experience: direct play -> native direct play -> lossless remux -> audio-only transcode -> video transcode/tone-map -> external player.
5. Do **not** add LibVLC, GStreamer, Media Foundation, or AVFoundation as general-purpose engines now. None closes a proven high-priority gap without duplicating lifecycle, telemetry, subtitle, packaging, and fallback work.

The first production change should not be “add codecs.” It should be **exact source inspection and deterministic route selection**. The current Android route is selected from a release-name HDR badge and a generic decoder-presence test. That is too weak for Dolby Vision, whose profile, level, codec, layer arrangement, and container all matter.

Only three isolated proof spikes are recommended before production implementation:

- exact Android source inspection and `MediaCodecList.findDecoderForFormat(actualMediaFormat)` routing;
- reuse of one Media3 player/network stack across episodes;
- an Android Media3 Widevine prototype using authorized test content.

Each spike has pass/fail gates below. If it fails them, it should be discarded without disturbing the working libmpv path.

## Implementation checkpoint

The first low-risk foundation slice is now implemented without changing which player handles a source:

- Release workflows generate a versioned JSON capability manifest for each standard desktop platform build and Android flavor. It records native artifact names, sizes, SHA-256 hashes, app/revision identity, available mpv/FFmpeg/pkg-config facts, and the reviewed Android mpv/FFmpeg/libplacebo/libass/Media3 graph. This prevents qualification evidence from silently carrying across a different binary. The separately sandboxed Steam Deck Flatpak still needs its own in-sandbox manifest before Deck qualification results can be retained.
- The Android full flavor includes Media3 Inspector and exposes `mpv_inspect_source` as an explicit qualification command. It returns container/sample MIME, codec strings, Dolby Vision profile/level signalling, dimensions/frame rate, channel/sample rate, color/HDR fields, DRM presence, and both framework/Media3 decoder results.
- The inspector has a 100–1000 ms deadline, a 256 KiB–8 MiB aggregate read budget (defaults: 1 s and 4 MiB), serializes concurrent probes, releases the retriever on every path, and never returns the source URL, request headers, initialization bytes, or exception text.
- The first production use is deliberately narrow: a release-name AC-4 token only starts a bounded inspection; Media3 becomes eligible only when the extracted track MIME is exactly `audio/ac4` and Android then reports an AC-4 decoder or routed bitstream endpoint. Timeouts, byte-budget exhaustion, missing support, active audio/video filters, and HDR ambiguity all stay on the libmpv path.
- The Media3 player/renderers/codec stack is reused across native-to-native episode transitions. Each item still receives a new `DataSource`/`MediaSource`, so signed headers cannot leak between sources, and track overrides/language preferences are reset before the replacement item.
- Native sidecars now identify SSA/ASS, SRT, TTML/DFXP, and WebVTT explicitly. Stream metadata also recognizes AC-4, xHE-AAC/USAC, MPEG-H, IAMF, VVC, and VP9 so unsupported-layer decisions and diagnostics no longer collapse these into “unknown.” Recognition is not presented as successful playback.
- The next step is physical-device A/B measurement and corpus qualification. The checked-in click-to-first-frame telemetry and native `reused=true/false` log distinguish cold and reused transitions; no performance claim should be published until those results exist.

## What “better” must mean

“Better than every client” is not a testable engineering claim. The target should instead be:

- **Fast:** lower click-to-first-frame and seek-to-frame at p50 and p95, without trading startup for an immediate rebuffer.
- **Broad:** a published matrix distinguishes container parsing, video decode, HDR output, audio decode, bitstream transport, subtitle rendering, and DRM. “Codec detected” is never presented as “fully supported.”
- **Correct:** no green/purple video, incorrect HDR mode, silent audio, subtitle loss, false Atmos/Dolby Vision label, or fallback loop.
- **Efficient:** hardware decode remains active on supported paths; CPU, GPU, memory, energy, and thermal behavior are measured on physical devices.
- **Recoverable:** failure changes route or representation quickly and at most once; a bad route is remembered for the device/source class.
- **Maintainable:** every extra playback path must have a unique, measured capability that the existing paths cannot supply.

## Current repository ground truth

This section describes the checked-out code as of the date above. It does not assume that older audit documents still match current line numbers.

### Android

- The full Android flavor is arm64-only, minSdk 26, compileSdk 36, and already uses current stable Media3 1.11.0 ([build.gradle.kts](src-tauri/tauri-plugin-mpv/android/build.gradle.kts#L8-L34)). Android published Media3 1.11.0 as stable on 2026-08-05 ([release notes](https://developer.android.com/jetpack/androidx/releases/media3#1.11.0)).
- The persistent libmpv core uses `vo=gpu`, `gpu-context=android`, and `hwdec=mediacodec-copy` ([MpvPlugin.kt](src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt#L479-L520)). The copy path preserves mpv's renderer, filters, screenshots, and libass subtitles, but cannot be treated as native Dolby Vision signaling.
- The Media3 route now reuses its ExoPlayer, renderers, codecs, AudioTrack, and `PlayerView` across native-to-native loads. Per-item HTTP/DataSource and MediaSource objects remain isolated so headers follow the current source. The transition saving is plausible but remains to be quantified on physical devices.
- Native HDR eligibility checks whether the display advertises an HDR type and whether a decoder with the Dolby Vision MIME exists ([MpvPlugin.kt](src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt#L615-L644), [decoder check](src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt#L1919-L1925)). It does not query the decoder with the source's actual profile, level, resolution, frame rate, bit depth, or initialization data.
- The frontend sets `preferNativeHdr` from `describe(stream).hdr` ([play.ts](src/lib/stremio/play.ts#L3093-L3102)), while that field is inferred from release-name regular expressions such as `DV`, `DoVi`, and `HDR10+` ([parse.ts](src/lib/stremio/parse.ts#L401-L413)). A title is useful UI metadata, not an authoritative playback capability description.
- The code already has useful foundations: a libmpv fallback after native failure, direct-audio route probing, first-frame telemetry, cache controls, and a diagnostics overlay. They should be extended rather than replaced.
- The reviewed Android AAR commit pins mpv 0.41.0, FFmpeg 8.1.2, libplacebo 7.360.1, and libass 0.17.5 ([pinned dependency record](https://github.com/jarnedemeulemeester/libmpv-android/blob/f77f62c316c6b222e75ece48e1fbf1e798fd83e7/buildscripts/include/depinfo.sh)). This is a strong current baseline, but its capabilities must not be projected onto other platform builds.

### Desktop

- Windows embeds mpv into a child HWND, prefers `gpu-next`, falls back to `gpu`, uses D3D11, and retains hardware decode ([mod.rs](src-tauri/src/player/mod.rs#L1855-L1879), [Windows GPU setup](src-tauri/src/player/mod.rs#L2109-L2167)). This is already the efficient direct-output shape used by modern Stremio shells.
- macOS currently forces `vo=gpu` because the package does not ship MoltenVK. Linux/macOS render-API embedding cannot simply switch to `gpu-next`: mpv's public render API still lacks a stable gpu-next/Vulkan replacement ([mpv issue #10810](https://github.com/mpv-player/mpv/issues/10810), [draft PR #16818](https://github.com/mpv-player/mpv/pull/16818), [Vulkan render API issue #18343](https://github.com/mpv-player/mpv/issues/18343)).
- The desktop player already reuses its core, uses hardware decode, has a rolling 128 MiB forward/back cache, short libavformat probe/analyze windows, reconnect behavior, and source-specific initial buffering ([mod.rs](src-tauri/src/player/mod.rs#L1478-L1487), [defaults](src-tauri/src/player/mod.rs#L2207-L2251)). These values are hypotheses to benchmark, not values to increase blindly.
- Existing telemetry records click-to-first-frame on Android and desktop ([play.ts](src/lib/stremio/play.ts#L3127-L3137), [desktop event](src/lib/stremio/play.ts#L3334-L3338)), while the stats overlay exposes cache, bitrate, A/V sync, and player properties. There is not yet a reproducible physical-device benchmark harness.
- Build parity is not guaranteed: Linux pins mpv 0.41.0 but compiles against Ubuntu 24.04 system dependencies; Windows pins a dated upstream snapshot and checksum; macOS installs the then-current Homebrew graph and checks only mpv >=0.41. Every release must generate a manifest containing exact mpv/FFmpeg/libplacebo/libass versions, configure flags, enabled decoders/demuxers/hwaccels, and binary hashes. The macOS dependency graph should be locked or captured into a reproducible lock artifact before making platform-wide codec claims.

### Existing Dolby claims

[`DOLBY_PLAYBACK.md`](DOLBY_PLAYBACK.md) is appropriately conservative: desktop Dolby Vision is metadata-aware rendering/conversion, not certified native output; Atmos means preservation/transport of a compatible carrier, not object rendering by Izumi. Those distinctions must remain.

## Evidence that constrains the design

### Media3 is a native specialist, not a universal replacement

Media3 supports common progressive and adaptive containers, but its default audio/video decoders come from the Android device. Its optional FFmpeg extension broadens audio decoding, and optional modules add formats such as IAMF and MPEG-H. Android's supported-formats document specifically describes Dolby Vision extraction for MP4 and HDR10+ extraction for Matroska/WebM; decode and display remain device-dependent ([Media3 supported formats](https://developer.android.com/media/media3/exoplayer/supported-formats)). This is materially narrower than “every MKV that FFmpeg can demux.”

Android recommends `SurfaceView` for HDR. A `TextureView` adds a copy and can be tone-mapped rather than preserving the intended HDR path ([Android HDR playback](https://developer.android.com/media/grow/hdr-playback)). The existing native route correctly verifies that `PlayerView` created a `SurfaceView`.

Dolby's Android guidance recommends Media3, `SurfaceView`, and querying `MediaCodecList.findDecoderForFormat(MediaFormat)` with the **actual media format**. MIME-only decoder discovery is insufficient ([Dolby Vision on Android](https://professionalsupport.dolby.com/s/article/Enabling-Dolby-Vision-Playback-on-Android-Mobile)). Media3 1.11 also treats an unrecognized profile/level as exceeding capabilities rather than assuming support, reinforcing exact-format routing ([Media3 1.11 release notes](https://developer.android.com/jetpack/androidx/releases/media3#1.11.0)).

Media3 Inspector 1.11 can retrieve track groups, formats, duration, and timeline using the same data source without constructing the playback UI ([Media3 Inspector](https://developer.android.com/media/media3/inspector)). It is therefore the preferred first prototype for bounded source inspection. Inspection must have a short timeout and byte budget so it never delays a normal libmpv start indefinitely.

### libmpv remains the broad-format/subtitle baseline

mpv/FFmpeg handle the long tail of Matroska, unusual elementary streams, embedded attachments, bitmap subtitles, and software fallback. libass is specifically a portable SSA/ASS renderer designed for VSFilter-compatible typesetting ([libass](https://github.com/libass/libass)). This is a first-order requirement for anime releases, not a cosmetic extra.

On Android, `mediacodec-copy` incurs a copy but keeps mpv's full render pipeline. Direct `mediacodec_embed` would reduce that cost, yet it cannot draw normal mpv subtitles on the opaque video surface ([mpv manual](https://mpv.io/manual/stable/), [mpv issue #14176](https://github.com/mpv-player/mpv/issues/14176)). It also has device-specific quirks; a known mpv-android report documents green frames on some TV boxes with MediaCodec paths ([mpv-android issue #1088](https://github.com/mpv-android/mpv-android/issues/1088)). That makes it a poor universal route and a candidate only for tightly tested, subtitle-free experiments.

mpv can pass AC-3, DTS, DTS-HD, E-AC3, and TrueHD bitstreams when the output path supports them. Its HDR dynamic-metadata mode does not mean native Dolby Vision output: the stable manual explicitly describes using dynamic information to produce HDR10 scene luminance rather than transmitting full HDR10+/Dolby Vision metadata ([mpv manual](https://mpv.io/manual/stable/)).

### mpv-specific capability audit

mpv 0.41.0 is the current stable release and makes `gpu-next` the desktop default, prefers Vulkan hardware decoding, adds Android AAudio, reduces the default swapchain depth to two, and improves color management ([mpv 0.41.0 release](https://github.com/mpv-player/mpv/releases/tag/v0.41.0)). These are useful upstream improvements, not a reason to force every new default in Izumi: embedding method, driver, hardware decoder, audio sink, subtitles, and the exact dependency build change the result.

| Layer | Verified upstream capability | Hard boundary | Izumi decision |
|---|---|---|---|
| Inspect/demux | mpv exposes codec profile and, when supplied by the container, Dolby Vision profile/level track properties. FFmpeg can demux raw AC-4 and IAMF containers. | A demuxer or codec ID does not imply a decoder, renderer, or valid output route. Post-load mpv properties also arrive too late to be the only pre-route inspector. | Log mpv facts as runtime evidence; retain bounded Media3/container inspection for pre-route decisions. |
| Video decode | FFmpeg/libmpv remains the broad software fallback; hardware decode is selected per platform. | `hwdec=auto` is a tested whitelist, not a guarantee. VVC support differs by FFmpeg build and is not in mpv's normal hardware-codec default list. | Probe the actual release build and device. Never publish a global video-codec claim from one platform. |
| HDR/Dolby rendering | libplacebo can process Dolby Vision metadata, including Profile 5 conversion, and tone-map to HDR10 or SDR ([libplacebo](https://github.com/haasn/libplacebo)). | mpv's dynamic target mode does not transmit full Dolby Vision/HDR10+ metadata. Rendering/conversion is not licensed native DV output. | Continue to describe desktop DV as metadata-aware conversion. Native DV remains an exact device/container/profile route. |
| Encoded immersive audio | `audio-spdif` transports AC-3, E-AC3, TrueHD, DTS, and DTS-HD. The Android build's FFmpeg profiles can identify E-AC3 Atmos, TrueHD Atmos, DTS:X, and DTS:X IMAX ([FFmpeg profiles](https://github.com/FFmpeg/FFmpeg/blob/n8.1.2/libavcodec/profiles.c)). | mpv's passthrough list does not include AC-4, MPEG-H, IAMF, DTS-UHD, or MAT. Speed changes and software audio filters conflict with bitstream transport. | Query the active sink, disable incompatible processing, expose the actual carrier/profile, and verify the AVR/device input mode. |
| Atmos object handling | The compatible E-AC3/TrueHD bed remains playable, and qualifying encoded passthrough can preserve its extensions. | FFmpeg's TrueHD decoder identifies the fourth Atmos substream but decodes only the first three audio substreams because the fourth contains object metadata ([decoder source](https://github.com/FFmpeg/FFmpeg/blob/n8.1.2/libavcodec/mlpdec.c#L372-L381)). PCM output from this path is not Atmos object rendering. | Claim Atmos only for verified encoded/native routes; call software-decoded output the compatible channel-based render. |
| AC-4 | The exact FFmpeg 8.1.2 used by the Android AAR has an AC-4 raw demuxer ([source](https://github.com/FFmpeg/FFmpeg/blob/n8.1.2/libavformat/ac4dec.c)). | That same release's decoder registry contains no AC-4 decoder ([registry](https://github.com/FFmpeg/FFmpeg/blob/n8.1.2/libavcodec/allcodecs.c)), and mpv has no AC-4 `audio-spdif` mode. | Use Android Media3/device decoding where the exact format and route qualify; otherwise transform or report unsupported audio. |
| IAMF/MPEG-H/DTS-UHD | Container and platform APIs may expose these names, and Media3 offers optional IAMF/MPEG-H modules. | FFmpeg container/parser support is not a complete immersive decoder/renderer. mpv has no corresponding passthrough modes. | Keep independent Media3 feature-flag experiments; measure output semantics, APK size, and CPU before making claims. |
| Subtitles over HDR | libass remains excellent for ASS, and mpv handles bitmap subtitles. | An open mpv report shows `gpu-next` can hue-shift PGS/VobSub/DVB bitmap subtitles over HDR/DV, while `vo=gpu` restored the expected colors in that test ([mpv issue #18286](https://github.com/mpv-player/mpv/issues/18286)). Direct `mediacodec_embed` cannot composite normal mpv subtitles. | Add PGS + HDR/DV golden-frame gates and retain a `vo=gpu` fallback. Do not qualify `gpu-next` from video-only tests. |
| Android hardware decode | `mediacodec-copy` preserves mpv composition and works broadly on many devices. | Current reports include AV1 dropped frames/desync/crash with `mediacodec-copy` ([mpv-android #1213](https://github.com/mpv-android/mpv-android/issues/1213)) and device-specific green-frame failures. | Keep a per-decoder/device circuit breaker and one software/native fallback. Never force one MediaCodec mode globally. |
| Android audio output | mpv 0.41 adds AAudio. | A current mpv-android report reproduces playback freezing after seeks when AAudio is forced ([mpv-android #1283](https://github.com/mpv-android/mpv-android/issues/1283)). | Keep AudioTrack as the qualified baseline; AAudio is an opt-in experiment until seek and route-change tests pass. |

#### Safe mpv tuning policy

- Keep `hwdec=auto`/the already qualified platform selection. Do not use `auto-unsafe`, disable hardware-profile validation, or hide decoder failures with an excessive software-fallback packet count.
- Preserve direct rendering for software decode where it works. Avoid filters that write frames when measuring the upload benefit because they disable that path.
- Do not ship `vd-lavc-fast`: mpv documents that it violates specifications and can break playback. Do not ship `video-latency-hacks`: it trades correctness and interpolation behavior for roughly one or two frames.
- Treat Vulkan Video and Android `gpu-next` as allowlisted experiments, not blanket upgrades. The present Android `vo=gpu` choice is defensible until MediaCodec, PGS/HDR, screenshot, subtitle, and suspend/resume tests pass on the device matrix.
- `profile=fast` is a useful user/device fallback for weak GPUs, but it deliberately reduces rendering quality. Record `show-profile=fast` for each shipped mpv build rather than assuming that profile never changes.
- `video-sync=display-resample` can smooth mismatched display/content rates but resamples audio and slightly changes speed; make it an optional smooth-motion mode, not the universal default. Interpolation is a separate GPU/latency cost.
- Keep shader caching enabled. Tune `hwdec-threads`, decoder threads, swapchain depth, and audio buffering only from randomized physical-device A/B results; none has one best value across decode APIs.
- Do not blindly cut `probesize`, `analyzeduration`, or stream buffers to win synthetic startup. Anime files frequently carry attachments, many tracks, and complex Matroska layouts. Use source-class profiles, measure immediate-rebuffer and missed-track rates, and retry with conservative probing on ambiguity.
- `cache-pause-initial` prevents an immediate rebuffer at the cost of startup time and also affects post-seek behavior. Optimize click-to-stable-playback, not first-frame alone.

#### Build-time support is a product capability

The runtime compatibility record must include a generated build manifest. At minimum, execute and capture mpv version/configuration plus FFmpeg's decoder, demuxer, hwaccel, protocol, and filter lists for every release artifact. Unit tests that merely assert a source-script version are insufficient: macOS drifts with Homebrew, Linux inherits distribution library choices, Windows uses a third-party snapshot, and Android has its own pinned static graph. Qualification results are keyed by the manifest hash so they cannot silently carry forward after a dependency update.

### Android networking can improve, but compatibility is the gate

Media3 recommends HttpEngine on supported API 34+ devices, with HTTP/1.1, HTTP/2, and HTTP/3. It recommends the Google Play services Cronet provider as a broadly available alternative, with fallback to `DefaultHttpDataSource`; OkHttp is another HTTP/1.1/2 option. A single engine/client instance should be reused ([Media3 network stacks](https://developer.android.com/media/media3/exoplayer/network-stacks)).

The current Media3 route instantiates `DefaultHttpDataSource` per load. A shared HttpEngine/Cronet stack is a credible latency and connection-reuse improvement, but it must first pass signed URL, redirect, byte-range, user-agent, cookie, custom-header, TLS, CDN, and loopback-P2P tests. HTTP/3 support by itself does not prove lower click-to-first-frame.

Media3's preload manager can prepare and buffer likely next items, but Android warns that aggressive preloading wastes bandwidth and power ([preload manager](https://developer.android.com/media/media3/exoplayer/preloading-media/preloadmanager/concepts)). Izumi already pre-resolves the next episode. Playback-byte preloading should therefore be opt-in, capped, and tested separately from metadata/debrid pre-resolution.

### DRM needs a native/browser route

Media3 uses Android `MediaDrm` for Widevine and supports CENC and CBCS combinations across DASH and fragmented-MP4 HLS according to API level ([Media3 DRM](https://developer.android.com/media/media3/exoplayer/drm)). This is the right Android prototype because it can share the native player, data source, telemetry, and `SurfaceView` path.

Desktop commercial DRM should remain Shaka/EME. EME is the browser abstraction over a platform content-decryption module, and Shaka provides DASH/HLS playback around MSE/EME ([W3C EME](https://www.w3.org/TR/encrypted-media/), [Shaka Player](https://github.com/shaka-project/shaka-player)). DRM success is still service-, license-, robustness-, HDCP-, and platform-dependent; no client can promise every protected service.

### Dolby Vision and Atmos are end-to-end properties

Dolby Vision profiles describe more than a label: codec, layer count, compatibility, and metadata arrangement differ ([Dolby Vision profiles](https://professionalsupport.dolby.com/s/article/What-is-Dolby-Vision-Profile)). Profile 10 adds AV1-based variants and remains device-dependent ([Profile 10 introduction](https://professionalsupport.dolby.com/s/article/Introduction-to-Dolby-Vision-Profile-10)). A route must therefore know at least container, codec string, profile/level, resolution, frame rate, color metadata, and whether a compatible base layer exists.

On Apple platforms, native playback is valuable only for exact Apple-compatible MP4/HLS forms. Apple's technical note gives specific single-track HEVC and box/metadata requirements for Profile 8.4 ([TN3145](https://developer.apple.com/documentation/technotes/tn3145-hdr-video-metadata)); Apple's HLS authoring rules and appendices define profile/codec signaling, including Dolby Vision and E-AC3 JOC Atmos signaling ([HLS authoring specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices/), [appendices](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices-appendixes/)). AVFoundation would not replace libmpv for arbitrary MKV/ASS releases.

On Windows, HDR output depends on the DXGI swap chain, color space, compositor, driver, display mode, and monitor. Microsoft now recommends applications tone-map for the display rather than assuming explicit HDR metadata reaches the monitor ([Windows advanced color](https://learn.microsoft.com/en-us/windows/win32/direct3darticles/high-dynamic-range), [`SetHDRMetaData`](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_5/nf-dxgi1_5-idxgiswapchain4-sethdrmetadata)). Windows spatial audio can handle object-based audio, but the user's endpoint and selected system spatial format remain decisive ([Windows spatial sound](https://learn.microsoft.com/en-us/windows/win32/coreaudio/spatial-sound)).

An E-AC3 codec tag does not prove Atmos. E-AC3 JOC, TrueHD Atmos, AC-4 Atmos, and MAT are different carriers/paths. Android exposes route formats such as E-AC3 JOC, TrueHD, MAT, AC-4, DTS-UHD, MPEG-H, and IAMF at different API levels, but the presence of an API constant is not device decoder or output support. `AudioManager.getDirectPlaybackSupport` must be queried for the active attributes/format/route on API 33+ ([AudioManager](https://developer.android.com/reference/android/media/AudioManager), [AudioFormat](https://developer.android.com/reference/android/media/AudioFormat)).

Dolby recommends testing actual controls, format transitions, profiles, frame rates, DASH/HLS, A/V sync, and receiver/display information, with no dropped/corrupt frames ([Dolby Vision test cases](https://professionalsupport.dolby.com/s/article/Test-Cases-and-Test-Scenarios-for-Dolby-Vision-v2), [endpoint testing](https://professionalsupport.dolby.com/s/article/Endpoint-Device-Testing-for-Streaming-Services)). A player label is not acceptance evidence.

### Dolby specifications catalogue: what applies to Izumi

The [Dolby specifications and white-papers catalogue](https://dolby.my.site.com/professionalsupport/s/specifications-and-white-papers?language=en_US) adds several authoritative inputs to the router and qualification work:

- **Use now:** Dolby Vision Profiles and Levels, plus Dolby's ISOBMFF, HLS, and MPEG-DASH signalling documents. Together they define why profile/level, layer/cross-compatibility, container boxes, codec strings, and manifest signalling—not a release name—must drive eligibility ([profiles and levels](https://dolby.my.site.com/professionalsupport/s/article/What-is-Dolby-Vision-Profile), [ISOBMFF](https://dolby.my.site.com/professionalsupport/s/article/How-to-signal-Dolby-Vision-in-ISOBMFF-format-AKA-mp4-container), [HLS](https://dolby.my.site.com/professionalsupport/s/article/How-to-signal-Dolby-Vision-in-HLS), [DASH](https://dolby.my.site.com/professionalsupport/s/article/How-to-signal-Dolby-Vision-in-MPEG-DASH)). Dolby's open-source `dlb_mp4base` and `dlb_mp4demux` projects, linked from the ISOBMFF article, can serve as independent test oracles for the inspection spike; they are not needed as production player dependencies.
- **Use now:** Dolby's Android Atmos guidance confirms that Media3 is the preferred route to licensed device-integrated E-AC3/JOC and AC-4 decoders. For on-device immersive rendering, qualification must also record `Spatializer` availability/enabled state, `canBeSpatialized`, output channel behavior, and state changes during playback ([Android Atmos guidance](https://dolby.my.site.com/professionalsupport/s/article/Enabling-Dolby-Atmos-in-Android-Mobile-media-apps)). A custom raw `MediaCodec` route would additionally need Dolby's maximum-output-channel guidance; the recommended Media3 route should be tested before adding custom codec plumbing.
- **Use now:** the AC-4-in-ISOBMFF specification covers immersive-audio signalling, dialogue enhancement, CENC, CMAF, and streaming interoperability ([AC-4 in ISOBMFF](https://professionalsupport.dolby.com/s/article/Dolby-AC-4-Streams-Within-the-ISO-Base-Media-File-Format)). AC-4 is not one capability: IMS, Level 3, and Level 4 target different experiences and deployments ([AC-4 overview](https://dolby.my.site.com/professionalsupport/s/article/What-is-AC-4)). The support matrix and corpus must preserve that distinction.
- **Use now:** Dolby's JOC explanation confirms that a normal E-AC3 decoder can ignore JOC object data and output the backward-compatible multichannel render. Therefore successful `audio/eac3` playback is not proof that Atmos objects were rendered ([Dolby Digital Plus JOC](https://dolby.my.site.com/professionalsupport/s/article/What-is-Dolby-Digital-Plus-JOC-Joint-Object-Coding)).
- **Use for qualification, not runtime:** Dolby Stream Validator, Dolby MP4 Inspector, and the Professional Verification Toolkit Lite should validate the known-good source corpus before client testing. This prevents a malformed sample from being mistaken for a player defect ([Dolby ISOBMFF/QC guidance](https://dolby.my.site.com/professionalsupport/s/article/How-to-signal-Dolby-Vision-in-ISOBMFF-format-AKA-mp4-container)).
- **Future/niche:** Profile 20 concerns stereoscopic Dolby Vision for immersive/Apple Vision Pro delivery, so it belongs in a future spatial-video track rather than the current general player milestone ([Profile 20](https://dolby.my.site.com/professionalsupport/s/article/Introduction-to-Dolby-Vision-Profile-20)).
- **Not client-runtime requirements:** ADM profile, IMF channel-label, mastering, mixing-room, and display-grading documents concern content creation and professional deliverables. They become relevant only if Izumi later encodes/packages media or operates a transform service.

#### Review of the supplied Dolby specifications

| Document | Player relevance | Decision |
|---|---|---|
| Dolby Vision Streams Within the ISO Base Media File Format, v2.8 (2026-07-09) | **Direct and high** | Use its Annex B as the normative model for the inspection spike. Parse the visual sample entry, codec configuration, `dvcC`/`dvvC`, profile, level, RPU/base/enhancement-layer flags, base-layer compatibility, color description, and metadata-compression mode before choosing native DV or a base-layer fallback. |
| Dolby Vision Streams within HLS, v3.0 (2026-03-24) | **Direct and high** | Parse `CODECS`, `SUPPLEMENTAL-CODECS`, `VIDEO-RANGE`, profile, and level at manifest time. Non-cross-compatible P5/P10.0 requires a DV decoder; P8.1/P10.1 can select an HDR10-compatible base layer; P8.4/P10.4 can select an HLG-compatible base layer. Prefer a separate SDR rendition when supplied rather than attempting an invalid decode. |
| Dolby AC-4 Streams Within ISOBMFF, v1.0 (2026-01-29) | **Direct but narrower** | Use as a validation/parser reference for `ac-4`/`dac4`, decoder-specific information, CENC/CMAF carriage, presentations, language/labels, selection priority, preferred rendering mode, accessibility roles, immersive indication, and dialogue-enhancement metadata. Let Media3 handle demux/decode initially; add custom parsing only for metadata Media3 does not expose. |
| Dolby Atmos Master ADM Profile v1.1 (2022-01-05) | **Not normal playback** | Defines professional ADM BWF master interchange: up to 128 PCM channels, beds/objects, XML metadata, and Dolby metadata chunks. Do not add it to the consumer-player milestone. Revisit only for a professional master-file inspector or an encoding/transform service. |
| Additional Audio Channels and Soundfields for Immersive Audio (2018-11-14) | **Not normal playback** | Defines IMF MCA labels and channel/soundfield groups such as 5.1.4, 7.1.4, and 9.1.x. Relevant to authoring/IMF validation, not decoding ordinary streaming tracks. |
| IMF IAB Interoperability Guidelines (2020-05-29) | **Not normal playback** | Covers IMF immersive-audio bitstream track files, frame/object consistency, flattening/upmixing, and Dolby-tool interoperability. This is a professional interchange path, not E-AC3-JOC, TrueHD, AC-4, or MAT consumer playback. |

The v2.8 ISOBMFF document makes the Android routing requirement more concrete:

- `dvcC` is used for profiles up to 7 and profile 20; `dvvC` is used for profiles 8 through 10.
- Dolby Vision configuration includes `dv_profile`, `dv_level`, `rpu_present_flag`, `el_present_flag`, `bl_present_flag`, base-layer signal compatibility, metadata compression, and feature flags. MIME alone cannot represent these constraints.
- Cross-compatible sample entries (`hev1`/`hvc1`, `avc1`/`avc3`, `av01`) may safely fall back to their signaled base-layer color format when the Dolby configuration is missing or invalid. Non-compatible entries (`dvhe`/`dvh1`, `dvav`/`dva1`, `dav1`) must be rejected when their required Dolby configuration/profile combination is invalid; they must not be guessed as ordinary HDR.
- CMAF brands (`dv58`, `dv09`, `dv10`, `dv20`) express decoder-profile conformance, while compatibility brands (`db1p`, `db2g`, `db4h`, `db4g`) express decoded-signal compatibility. The router should retain both facts rather than collapsing them into one “DV” flag.
- Dolby Vision Common Encryption allows `cenc` or `cbcs`, but requires Dolby RPU metadata to remain clear and the original sample-entry FourCC to be preserved in `frma`. This belongs in DRM test-vector validation, not custom client encryption code.

The HLS document also gives a fast manifest-first route: a Dolby codec string is `[FourCC].[two-digit profile].[two-digit level]`. For a cross-compatible stream, the standard HEVC/AV1 codec remains in `CODECS` and the Dolby alternative plus compatibility brand is carried in `SUPPLEMENTAL-CODECS`. The bounded inspector should use this information before fetching media boxes, then confirm it against the initialization segment when practical.

### More engines do not automatically mean more support

LibVLC overlaps heavily with libmpv: FFmpeg-based demux/decode, hardware decode, subtitles, HDR, and passthrough. Adding it would create another native binary, surface/lifecycle model, option model, telemetry adapter, failure taxonomy, and per-device test matrix without adding DRM or a uniquely required format ([VLC Android](https://github.com/videolan/vlc-android)).

GStreamer is more composable but requires platform-specific hardware decoders, memory/surface negotiation, plugin ranking, and subtitle-overlay handling. Its own documentation notes platform-dependent hardware plugins and troublesome decoders, while its subtitle design explains why overlaying text on hardware video paths is not trivial ([hardware decoding](https://gstreamer.freedesktop.org/documentation/tutorials/playback/hardware-accelerated-video-decoding.html), [subtitle overlays](https://gstreamer.freedesktop.org/documentation/additional/design/subtitle-overlays.html)).

Media Foundation supports fewer general containers/codecs than the existing FFmpeg path ([Media Foundation formats](https://learn.microsoft.com/en-us/windows/win32/medfound/supported-media-formats-in-media-foundation)). AVFoundation has a similar role on Apple platforms: strong native integration for Apple-approved forms, not broad Matroska/anime compatibility.

Jellyfin's documented model is the useful precedent: support is a tuple of container, video, audio, subtitle, and device capability; when direct play is impossible, it remuxes or transcodes ([codec support](https://jellyfin.org/docs/general/clients/codec-support/), [transcoding](https://jellyfin.org/docs/general/post-install/transcoding/)). “Everything plays” comes from a controlled fallback ladder, not a pile of interchangeable local engines.

## Architecture options evaluated

Scores are a decision aid, not benchmark results. Each criterion is 1 (poor) to 5 (excellent); the weighted total is out of 100. Weights reflect Izumi's actual goal: coverage 25%, output/subtitle correctness 20%, performance/power 20%, maintainability 15%, DRM 10%, legal/distribution risk 10%.

| Option | Coverage | Correctness | Efficiency | Maintainability | DRM | Legal/distribution | Weighted | Judgment |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| libmpv only | 5 | 4 | 4 | 5 | 1 | 4 | 82 | Excellent unencrypted baseline; cannot solve commercial DRM or guaranteed native DV |
| Platform-native players replace mpv | 3 | 4 | 5 | 3 | 5 | 5 | 80 | Good native integration; loses long-tail containers and anime subtitle fidelity |
| **Capability-routed libmpv + narrow native/DRM paths** | **5** | **5** | **4** | **3** | **5** | **4** | **88** | Best balance if routing and fallback remain bounded |
| Add LibVLC/GStreamer as additional general engine | 5 | 4 | 3 | 1 | 2 | 2 | 64 | Duplicates most capabilities and multiplies defects/test burden |
| Depend primarily on remux/transcode service | 5 | 4 | 3 | 3 | 4 | 3 | 76 | Strong last-resort coverage; adds infrastructure, latency, cost, and privacy concerns |

The hybrid wins only if native routes are **narrow**. If selection becomes heuristic, unbounded, or engine-specific behavior leaks into the UI, its maintainability score collapses.

## Recommended routing contract

The router input must be structured source facts plus live sink capability, never a release-name badge.

```text
source URL/manifest
        |
        v
bounded inspection ---- timeout/unknown -------------------+
        |                                                   |
        v                                                   v
container + DRM + video profile/level + audio + subtitles  libmpv default
        |
        v
device decoder + display HDR mode + active audio route + route failure cache
        |
        +--> encrypted Android DASH/HLS/fMP4 --> Media3/MediaDrm
        +--> encrypted desktop DASH/HLS --------> Shaka/EME
        +--> exact Android native HDR candidate --> Media3/SurfaceView
        +--> arbitrary MKV / ASS / PGS / filter --> libmpv
        +--> no direct route --> remux/transcode/external ladder
```

### Initial policy

| Source/requirement | Preferred path | Required evidence | Fallback |
|---|---|---|---|
| Clear arbitrary MKV/WebM/MP4, especially anime ASS/PGS | libmpv | Demux opens; decoder selected; first frame/audio observed | software decode, then transform/external |
| Android clear MP4/fMP4/HLS/DASH Dolby Vision | Media3 `SurfaceView` | HLS `CODECS`/`SUPPLEMENTAL-CODECS` or ISOBMFF sample entry plus `dvcC`/`dvvC` yields a valid codec/profile/level/layer/compression combination; `findDecoderForFormat` succeeds; display advertises DV; no incompatible subtitle/filter need; route not circuit-broken | spec-permitted HDR10/HLG base layer when cross-compatible, otherwise libmpv metadata-aware conversion or a compatible rendition |
| Android HDR10+/HLG/HDR10 | Media3 only where exact extractor/container support and measured device output justify it | Parsed `ColorInfo`/profile plus matching display/decoder | libmpv |
| Android Dolby Vision in arbitrary MKV | libmpv initially | Media3 documentation does not establish generic DV-in-Matroska native extraction; require a separate proven corpus before enabling | libmpv |
| Android Widevine DASH/HLS fMP4 | Media3/MediaDrm | Authorized license flow, scheme/robustness/API support, secure decoder/surface | compatible lower representation or user-facing error |
| Desktop Widevine/PlayReady/FairPlay content | Shaka/EME | Browser CDM and service license policy approve selected representation | compatible representation or external official client |
| Apple-compatible clear HLS/MP4 special case | libmpv now; later AVFoundation spike only if demand is measured | Exact Apple authoring/profile constraints and measurable native-output benefit | libmpv |
| Complex ASS, PGS, filters, speed != 1x, screenshot/GIF | libmpv | Required feature active | no automatic native switch |
| Unsupported container but supported codecs | lossless remux | no DRM; timestamp/subtitle/attachment preservation validated | audio/video transform |
| Unsupported audio output/decoder | audio-only transcode | video can be copied losslessly | full transform/external |
| Unsupported video/profile/HDR | hardware video transcode or tone-map | explicit user/server capability and resource budget | external player/error |

### Router safety rules

- Inspection gets a strict time and byte budget. On timeout or ambiguity, clear content goes to libmpv; DRM follows its required native/browser route.
- Route decisions include a reason code and inspected facts in diagnostics.
- A failed native route falls back once. No ping-pong between engines.
- Cache a failure by device build/decoder/source-class for a bounded period; invalidate on app, OS, firmware, or Media3 change.
- Never route only because a filename contains `DV`, `Atmos`, `HDR`, `AV1`, or `10bit`.
- Audio filters, time-stretching, or incompatible spatial processing disable encoded passthrough before playback changes.
- Never label native Dolby Vision until the active decoded `Format` is Dolby Vision and an external display/device observation confirms the mode during qualification.
- Never label Atmos from `ec-3` alone. Qualification requires JOC/TrueHD/AC-4/MAT source evidence plus receiver/device confirmation.

## Format-support priorities

### Priority 0: describe support honestly

Create a generated compatibility record with separate fields for:

- container parsed;
- video codec/profile/level decoded in hardware or software;
- HDR metadata understood;
- actual output mode: DV, HDR10+, HDR10, HLG, or SDR;
- audio decoded vs encoded passthrough;
- active sink format and route confidence;
- subtitle parsed and renderer used;
- DRM scheme, robustness, and secure-decoder result.

This turns “supports Atmos/Vision” into auditable facts and prevents misleading badges.

### Priority 1: proven high-value additions

- Exact Dolby Vision Profile 5/8.x/9/10 inspection and route reporting for ISOBMFF; HLS routing covers the profiles its v3.0 specification lists (5, 8, 10, and future/niche 20). Profile 9/AVC and Profile 10/AV1 remain exact-device-gated rather than inferred from the base codec.
- Android AC-4 IMS/L3/L4, E-AC3-JOC, TrueHD/MAT, and DTS-UHD direct-route reporting where the parsed source and active device route report the required profile/level and output support. On-device immersive tests also record live `Spatializer` state.
- HDR10+, HDR10, and HLG exact detection rather than filename-only inference.
- A persistent Media3 player and shared modern HTTP stack if benchmarks pass.
- Android Widevine through Media3 if the authorized DRM spike passes.

### Priority 2: experiments, not claims

- Media3 IAMF and MPEG-H extension modules behind build/feature flags. Measure APK size, startup, software decode cost, channel/spatial output, and device availability.
- xHE-AAC qualification across the FFmpeg software decoder and Android AAC MediaCodec path where the exact bundled build exposes it. Test loudness/DRC metadata, stereo/multichannel output, seeks, track changes, and fallback; do not infer xHE-AAC support from ordinary AAC playback.
- VVC only after build parity. The Android libmpv build is pinned to a newer FFmpeg than the Ubuntu/Linux dependency path, so a format working on Android/Windows may fail on Linux. FFmpeg documents broad format support but build-time libraries matter ([FFmpeg formats](https://ffmpeg.org/general.html)).
- MediaCodec tunneling only on a tested Android TV allowlist. Android explicitly warns about device-specific tunneling issues and recommends manual testing ([Media3 track selection](https://developer.android.com/media/media3/exoplayer/track-selection)).
- Audio offload as a separate power experiment; do not combine it with tunneling or native-HDR changes in the same benchmark.
- Frame-rate matching as a user setting that respects system preference and non-seamless mode changes, not a universal forced default ([Android frame-rate guidance](https://developer.android.com/media/optimize/performance/frame-rate)).

## Performance plan

### Instrumentation

On Android, attach `AnalyticsListener` and `PlaybackStatsListener` to both experiments and production candidates. Media3 exposes first-frame, dropped-frame, decoder, bandwidth, DRM, load, and format events; `PlaybackStats` derives rebuffering, dropped-frame rate, average resolution, and network bytes ([Media3 analytics](https://developer.android.com/media/media3/exoplayer/analytics), [`AnalyticsListener`](https://developer.android.com/reference/androidx/media3/exoplayer/analytics/AnalyticsListener)). Do not retain full event history in normal playback unless needed, because the API warns about memory overhead.

Use release-like, non-debuggable builds on physical devices. Android Macrobenchmark produces JSON and a Perfetto trace for each iteration; emulators are explicitly discouraged for representative performance numbers ([Macrobenchmark](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview)). Use custom trace sections for click -> route decision -> prepare -> decoder initialized -> first frame. `PowerMetric` is useful on supported Pixel devices but is system-wide and experimental, so corroborate it with long steady-state runs and controlled background activity ([Macrobenchmark metrics](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics)).

Desktop runs should log the same semantic timestamps plus mpv properties/events. Capture CPU/GPU utilization, process working set/RSS, hardware-decoder choice, dropped frames, A/V sync, display mode, and power where platform tools expose it. The cross-platform report schema must be identical even when the profiler differs.

### Device matrix

Minimum qualification matrix:

- Android: API 26 low-end phone/box, API 29 TV, API 33 mid-range, API 34+ HttpEngine device, API 36 device; at least one DV display/device, one HDR10+ non-DV device, one HDR10-only device, and one SDR device.
- Audio: phone speakers, Bluetooth, USB DAC, HDMI ARC, HDMI eARC, AVR/soundbar with an information screen; route changes while playing.
- Windows: Intel, AMD, and NVIDIA hardware where available; SDR and HDR displays; 100%, 125%, and 150% scaling.
- macOS: Intel if supported, Apple Silicon before M3, and M3+ for any Profile 10 claim; internal and external HDR displays.
- Linux: Intel/AMD/NVIDIA across Wayland and X11/XWayland; include Steam Deck Game mode because it has a distinct output path.

This matrix is intentionally broader than CI. Format/HDR/audio qualification cannot be completed on emulators or headless runners.

### Legal test corpus

Use redistributable or explicitly test-only assets and record their permitted use. Do not check commercial movie samples or DRM keys into the repository.

The corpus should include:

- Containers/protocols: MP4/fMP4, MKV, WebM, MPEG-TS, HLS, DASH, local file, debrid signed URL, redirecting CDN URL, and loopback P2P URL.
- Video: H.264 8-bit, H.264 Hi10P anime, HEVC Main/Main10, VP9, AV1 8/10-bit, and separately gated VVC.
- HDR: SDR BT.709; HDR10; HDR10+; HLG; Dolby Vision P5, P7 MEL/FEL, P8.1, P8.4, P9, P10.0/P10.1/P10.4, and separately gated P20 where authorized samples exist; 23.976/24/25/29.97/30/50/59.94/60 fps.
- Audio: AAC-LC, HE-AAC, xHE-AAC, Opus, FLAC, AC-3, E-AC3, E-AC3-JOC, TrueHD Atmos, DTS, DTS-HD MA, AC-4, DTS-UHD, and experimental IAMF/MPEG-H. For immersive carriers, include both encoded transport and software/native decode expectations.
- Subtitles: simple SRT/WebVTT, complex ASS with fonts/attachments/karaoke/transforms, PGS/VobSub over SDR, HDR10, and Dolby Vision conversion, forced tracks, RTL, CJK, and overlapping cues.
- DRM: authorized Widevine CENC/CBCS DASH and fMP4 HLS across allowed security levels and HDCP states.
- Failure cases: truncated headers, missing index/cues, late Matroska tracks, bad timestamps, unsupported profile, demux-without-decoder such as AC-4 in FFmpeg, hardware decoder corruption/stall, decoder init failure, expired signed URL, midstream network loss, route hot-plug, display sleep/wake, and rapid source switching.

Apple publishes test-only HLS examples containing AVC, HEVC, AV1, Dolby Vision 5, HDR10, AC-3, Atmos, and WebVTT ([Apple HLS examples](https://developer.apple.com/streaming/examples/)). Android's Media3 demo can play Izumi's corpus and provides a useful control implementation ([Media3 demo](https://developer.android.com/media/media3/exoplayer/demo-application)). Dolby publishes endpoint and Vision test scenarios/signals under their stated testing restrictions; retain those restrictions with the corpus. Validate Dolby MP4/HLS/DASH samples with Dolby Stream Validator/MP4 Inspector or the applicable Verification Toolkit before using them as player ground truth.

### Network profiles

Run local/unshaped and controlled profiles, with identical conditions for A/B routes:

| Profile | Downlink | RTT | Loss/jitter | Purpose |
|---|---:|---:|---:|---|
| LAN | >=500 Mb/s | <5 ms | none | isolate player/decoder startup |
| Good broadband | 100 Mb/s | 20 ms | none | normal CDN |
| Constrained broadband | 25 Mb/s | 50 ms | light jitter | high-bitrate 4K pressure |
| Marginal | 8 Mb/s | 100 ms | 1% loss | ABR/rebuffer/fallback |
| Unstable | 20 Mb/s | 80 ms | 2% loss + bursts | reconnect and route recovery |

Test HTTP/1.1, HTTP/2, and HTTP/3 where the origin actually supports them. Include Range 206, ignored Range 200, chunked responses, redirects, signed-query URLs, custom request headers, cookies, compressed manifests, IPv4/IPv6, and CDN connection reuse.

### Metrics

Record per run:

- click-to-first-frame and prepare-to-first-frame, p50/p95;
- seek request-to-correct-frame and seek request-to-audible synchronized playback, p50/p95;
- next-episode transition time;
- rebuffer count, total rebuffer time, rebuffer ratio, and “starts then immediately stalls” incidence;
- dropped, skipped, and late frames; rendered frame rate; A/V sync distribution;
- selected container/extractor, decoder name, hardware/software mode, video/audio `Format`, and fallback reason;
- average/peak CPU and GPU, process RSS/PSS/working set, network bytes, and allocation/GC spikes;
- steady-state energy over at least 30 minutes, battery temperature, thermal status, and throttling;
- HDR/display mode and AVR input mode, captured from device/receiver information screens during qualification;
- subtitle golden-frame diffs and timing at known timestamps;
- crash, ANR, decoder-stuck, black/green/purple frame, audio silence, and fallback-loop counts.

Run at least 10 cold and 10 warm iterations for startup/seek comparisons, randomized A/B on the same device and network. Report raw results, median, p95, dispersion, app/version, OS/firmware, codec build versions, power state, display topology, and thermal starting conditions. Do not combine results from different devices into one headline number.

## Proof-spike gates

Thresholds are conservative release gates, not promises that an experiment will pass.

### Spike A: exact Android routing

Build a standalone inspection/routing prototype before modifying production load behavior.

Pass only if:

- all authoritative samples produce container, codec, profile/level, color, audio, subtitle, and DRM facts required by the policy;
- each result separately states demux support, selected decoder, hardware/software mode, HDR processing/output mode, encoded/PCM audio route, and subtitle renderer; AC-4 or IAMF recognition without a usable decoder must be reported as such rather than accepted as playable;
- the ISOBMFF decision table matches Dolby v2.8 Annex B for HEVC, AVC, and AV1 sample entries, including base-layer fallback versus rejection;
- the HLS decision table distinguishes non-cross-compatible `CODECS` from cross-compatible `CODECS` plus `SUPPLEMENTAL-CODECS`, and verifies the profile/level against the initialization segment when available;
- native eligibility agrees with `findDecoderForFormat` and Media3 track support for every tested source/device combination;
- unsupported DV profiles/levels/containers never enter the native route in the qualification corpus;
- unknown/timeout returns control within 300 ms on warm manifest/MP4 cases and within a strict 1 s absolute ceiling, then chooses the safe route;
- the fallback is single-shot, produces a first frame within 2 s after a native decoder failure on LAN, and never loops;
- release-name labels have zero influence over the route.

If byte-addressable remote MKV inspection cannot meet the time/byte budget, do not inspect it for native eligibility; send it directly to libmpv.

### Spike B: persistent Media3 player and shared HTTP stack

Compare the current per-load ExoPlayer/`DefaultHttpDataSource` construction against:

- one reusable ExoPlayer with `setMediaItem`/`prepare` across episodes;
- a shared HttpEngine on eligible API 34+ devices;
- shared Play-services Cronet with documented fallback elsewhere.

Pass only if:

- warm next-episode p50 improves by at least 10% **or** 100 ms, whichever is easier to exceed, on at least three representative devices;
- p95 click-to-first-frame and seek regress by no more than 5% on any qualification device;
- no signed URL, Range, redirect, header, cookie, loopback, IPv6, or CDN compatibility test regresses;
- stopped/changed items do not leak surfaces, decoders, requests, listeners, DRM sessions, or more than 20 MiB of retained process memory after stabilization relative to baseline;
- 30-minute energy is no worse than baseline by more than measurement noise, and decoder reuse does not create wrong-format frames or audio session bugs.

Ship player reuse and network-stack changes separately so a regression can be attributed and rolled back.

### Spike C: Android Widevine Media3

Use only content and license endpoints the tester is authorized to access.

Pass only if:

- CENC and CBCS cases supported by the target API/device play through the required secure decoder/surface;
- license request headers, signed URLs, redirects, renewals, expiry, and error mapping work without exposing secrets in logs;
- switching clear <-> encrypted and SDR <-> HDR releases all sessions/surfaces correctly;
- unsupported robustness/HDCP produces a compatible representation or a precise error, never an infinite spinner;
- startup/rebuffer performance is at least as good as the current authorized Shaka/WebView Android path on the same devices, or the native route has a documented quality/power advantage that justifies a small latency cost.

## Phased implementation after the gates

No phase should begin merely because the previous code was written; it begins only after evidence is reviewed.

1. **Measurement foundation:** versioned playback-session schema, route reason codes, Media3/mpv event parity, generated native-build manifest, physical-device harness, legal corpus manifest.
2. **Router correctness:** bounded inspection, exact `MediaFormat`, display/audio-route capability, safe default, circuit breaker. Keep release-name parsing for UI only.
3. **Android lifecycle/network:** persistent Media3 instance, then shared HttpEngine/Cronet as independent rollouts behind flags.
4. **Android DRM:** Media3 Widevine for qualified source/API combinations; retain Shaka/EME where it is the supported desktop path.
5. **Format experiments:** AC-4/DTS-UHD route reporting, xHE-AAC qualification, optional IAMF/MPEG-H, VVC build parity. Each gets its own APK-size/performance/license review.
6. **Compatibility service:** only if telemetry shows meaningful failures that lossless remux/audio transform would solve. Design it as an optional sidecar/server boundary rather than another in-process player.
7. **Apple native spike:** only if macOS/iOS demand and exact Apple-compatible DV/Atmos assets justify maintaining AVFoundation beside libmpv.

Every new route ships behind a remote/local kill switch, reports its reason, and preserves one-click external-player recovery.

## Risks and controls

| Risk | Why it matters | Control |
|---|---|---|
| False Dolby claims | Technical playback is not certification; labels can mislead | Preserve current cautious language; require external mode evidence; legal/brand review |
| Device fragmentation | MediaCodec, AudioTrack, MediaDrm, and secure surfaces fail differently by OEM | physical-device matrix, exact-format queries, sticky circuit breaker, one fallback |
| Hybrid complexity | Two paths can drift in features/state/events | narrow eligibility, common session schema, shared UI contract, route-parity tests |
| Startup inspection cost | Probing can erase any native-speed win | byte/time budget, cache by source fingerprint, safe default |
| Network regression | modern stack may handle headers/ranges/CDNs differently | contract corpus, singleton client, independent feature flag |
| Subtitle regression | native surfaces do not guarantee libass fidelity; bitmap subtitles can be color-wrong over HDR | complex ASS disqualifies native route; PGS/VobSub HDR golden frames gate mpv renderer changes |
| Codec/build inconsistency | FFmpeg/optional-module versions differ by platform | generated build manifest and per-platform capability matrix; no global claim |
| Recognition mistaken for playback | a demuxer, codec tag, or Android constant may exist without a decoder, renderer, or sink | require a successful end-to-end route at every layer; explicit unsupported-layer reason |
| Transform cost/privacy | remux/transcode adds compute, delay, and potentially remote content processing | local/owned sidecar preference, explicit opt-in, direct play first |
| DRM/security | license headers, tokens, keys, and secure-decode policy are sensitive | authorized endpoints, redacted logs, platform DRM APIs, no key persistence outside API contract |
| Licensing/patents | open-source license compliance and codec patent rights are separate | release-specific dependency/SBOM review and qualified legal advice |

## Licensing and distribution checkpoint

Izumi is distributed under AGPL-3.0-or-later in the checked-out repository. That does not remove component-specific obligations or patent/trademark questions.

- mpv is GPLv2+ by default and can be built under LGPLv2.1+ only with the corresponding configuration/feature restrictions ([mpv repository](https://github.com/mpv-player/mpv)). Record the exact build configuration and provide required notices/source.
- FFmpeg's licensing depends on build flags and linked libraries; its legal page explicitly separates license compliance from patent questions ([FFmpeg legal](https://ffmpeg.org/legal.html)).
- Dolby branding, incorporation of licensed Dolby technology, and certification require Dolby agreements, implementation testing, and approval. Technical compatibility alone grants no right to advertise certification ([Dolby licensing](https://professional.dolby.com/licensing/)).
- Adding VLC/GStreamer or proprietary decoder SDKs would expand the binary/SBOM/compliance matrix. This is another reason not to add an engine without a unique measured requirement.

This section is an engineering checkpoint, not legal advice. A distribution-specific legal review is required before branded or patented-format claims ship.

## Go/no-go conclusion

**Go** for the three isolated proof spikes and measurement work.
**No-go** for adding a third general playback engine, claiming universal Dolby support, blanket-routing all “DV” names to Media3, forcing tunneling/frame-rate switching, or advertising experimental codecs before device/build qualification.
**No-go** for blanket `gpu-next`, Vulkan Video, AAudio, `vd-lavc-fast`, latency hacks, reduced probing, or buffer/thread changes until the relevant physical-device A/B and subtitle/HDR gates pass.
**No-go** for production player changes until the raw benchmark data and qualification matrix are reviewed.

The likely highest-return sequence is:

1. exact source facts and route diagnostics;
2. persistent Media3 lifecycle;
3. shared modern Android network client;
4. Android Media3 DRM;
5. only then, narrowly justified new formats or transform services.

That sequence improves speed and support while keeping Izumi's strongest existing assets—libmpv breadth, libass subtitle fidelity, direct Windows output, and current fallback behavior—intact.
