# Dolby playback implementation and validation

Last validated: 2026-08-29

## What Izumi supports

| Path | Dolby audio | Dolby Atmos | Dolby Vision |
|---|---|---|---|
| Desktop embedded player | AC-3, E-AC3 and TrueHD decode; optional mpv IEC-61937 passthrough | Preserved as E-AC3 or TrueHD bitstream to a compatible HDMI receiver; Izumi does not render objects | mpv/libplacebo reads DV metadata and can target the display automatically, convert to HDR10, or tone-map to SDR. Native/certified DV output is not claimed |
| Android full build, libmpv | AC-3, E-AC3 and TrueHD decode/passthrough according to the routed device | E-AC3-JOC, TrueHD and MAT route capabilities are probed; encoded passthrough preserves the stream | Safe mpv fallback and HDR10/SDR rendering |
| Android fulgol build, native route | Media3 `AudioTrack` output with platform decoder/passthrough selection | Device-dependent E-AC3-JOC/TrueHD handling | Direct Media3/MediaCodec-to-Surface route, enabled only for a positively identified DV source when Android reports both a DV display and decoder |
| DRM/WebView | Shaka/EME playback | Exact E-AC3/TrueHD carrier is checked with MediaCapabilities `spatialRendering`; this does not prove JOC object metadata exists | Exact `dvhe`/`dvh1`/`dvav`/`dva1` codec and CDM robustness are checked with MediaCapabilities; a definitive rejection selects a compatible variant |
| Android lite build | Controlled by the selected external player | Controlled by the external player | Controlled by the external player |

“Atmos support” here means transport compatibility. A receiver/soundbar performs the Dolby object decode and render. An EC-3 codec string by itself proves only an Atmos-capable carrier, not that a particular track contains JOC metadata. “Dolby Vision support” on desktop means correct metadata-aware rendering/conversion, not a licensed native DV output claim.

## Safety policy

- Decoded PCM is the default.
- Auto passthrough enables only formats reported for Android's predicted media route. API 33+ additionally requires Android's direct bitstream flag; older Android exposes no predicted-route API, so Izumi conservatively infers only from connected HDMI/USB digital endpoint encodings and labels the result `inferred`. Desktop probing remains conservative because its OS backends do not expose one portable, trustworthy sink-format API; a user can explicitly choose HDMI after checking the receiver.
- Optical/S/PDIF is restricted to AC-3. E-AC3/TrueHD Atmos requires a suitable HDMI path; TrueHD normally requires direct HDMI or eARC.
- Any audio filter or a playback speed other than 1× disables passthrough before the operation reaches the player. Returning to 1× or disabling the filter reapplies the selected transport policy.
- Route changes trigger a fresh Android capability probe. A ten-second refresh also updates actual output diagnostics.
- A native Android DV decoder failure automatically tears down the native route and reloads the same item with libmpv.
- Native DV is reported only after Media3 exposes `video/dolby-vision` for the active video format. Profile 7 FEL processing is not claimed.

## Automated validation

Run from the repository root:

```powershell
npm test -- --run src/lib/player/dolby.test.ts src/lib/player/drm-dolby.test.ts src/lib/player/android-mpv.test.ts scripts/ci/dolby-build-contract.test.ts
npm run check
npm run build
rustc --test src-tauri/tests/dolby_output.rs -o tmp/dolby_output_contract.exe
.\tmp\dolby_output_contract.exe
Set-Location src-tauri\gen\android
.\gradlew.bat :app:compileArm64DebugKotlin --console=plain
```

The policy tests cover PCM-safe defaults, optical restrictions, AC-3/E-AC3/TrueHD HDMI selection, Android routed-format gating, MAT as a TrueHD-compatible route, filter and speed interlocks, exact DV codec recognition, DRM robustness queries and compatible fallback selection. The Rust source contract prevents either backend from silently dropping the options/probes. Kotlin compilation verifies the Media3, MediaCodec and Android audio APIs together.

Release builds use mpv 0.41.0 on Linux/Flatpak, a SHA-256-pinned 2026-08-29 Windows libmpv snapshot, and Media3 1.11.0 on Android. This removes distro-old player behavior from the support floor.

## Required hardware acceptance test

Software-only CI cannot verify an HDMI handshake, an AVR decoder lock, speaker placement, or the TV's active output mode. Before calling a device combination validated, test legal samples whose metadata has independently been confirmed:

| Test | Settings | Required observation |
|---|---|---|
| AC-3 5.1 baseline | HDMI, AC-3 on | Stats says `AC3`; receiver says Dolby Digital, with stable 5.1 channel mapping |
| E-AC3-JOC Atmos | HDMI, E-AC3 on | Stats says `EAC3`; receiver information screen explicitly says Dolby Atmos/Dolby Digital Plus |
| TrueHD Atmos | direct HDMI/eARC, TrueHD on | Stats says `TRUEHD`; receiver explicitly says Dolby Atmos/TrueHD and playback is gap/error free |
| Optical negative case | Optical, all format toggles on | Izumi sends AC-3 only; E-AC3 and TrueHD are not bitstreamed |
| Processing interlock | Start a verified Atmos stream, enable Dialogue boost | Output changes to PCM and remains audible; disabling the filter at 1× restores the selected encoded route |
| Speed interlock | Start a verified Atmos stream, select 1.25×, then 1× | Encoded output drops before time stretching and returns only at 1×; no burst/noise occurs |
| Hot-plug/route change | Auto mode, disconnect/reconnect HDMI | Capability diagnostics change and unsupported bitstreams are not retained |
| Android native DV | DV-capable Android device and display, known Profile 5/8 sample | Diagnostics say display `yes`, decoder `yes`, native path `yes`; the TV information screen enters Dolby Vision and colors are correct |
| Android DV fallback | Unsupported DV profile or forced decoder failure | Native path is not claimed; playback automatically continues through libmpv without a purple/green image |
| Desktop DV conversion | Known DV source, test Auto, HDR10, SDR | Stats reports actual HDR10 only for BT.2020/PQ; SDR reports SDR; neither mode falsely reports native DV |
| DRM Dolby | Authorized DV/Atmos service asset | Diagnostics show the exact carrier/path result; a rejected representation changes to a playable compatible variant |

Record the client version, OS/device, GPU/driver, connection topology, TV/AVR model and firmware, source container/codec/profile, and photographs of the TV and receiver information screens. Those receiver/TV observations are the acceptance evidence for Atmos/native DV, not a filename badge or Izumi's source label.

## Known boundaries

- Passthrough success depends on the OS audio backend, EDID/route reporting, cable/link topology and receiver firmware.
- ARC, eARC and vendor MAT behavior vary. Izumi reports Android's route data but does not override a device that rejects a direct format.
- Dolby Vision profiles and enhancement layers are device-specific. The direct Android route is guarded and falls back; desktop output remains metadata-aware conversion.
- DRM results depend on the platform CDM, license policy, robustness level and service manifest. An unavailable MediaCapabilities API is treated as unknown rather than as unsupported.
- Dolby trademarks/certification are separate from technical compatibility. Shipping branded claims or a certified Dolby implementation requires Dolby's licensing and product approval process.

## Primary references

- [mpv stable manual: audio-spdif and target colorspace behavior](https://mpv.io/manual/stable/)
- [Android Media3 supported formats](https://developer.android.com/media/media3/exoplayer/supported-formats)
- [Android AudioManager direct playback support](https://developer.android.com/reference/android/media/AudioManager#getDirectPlaybackSupport(android.media.AudioFormat,%20android.media.AudioAttributes))
- [Android Media3 releases](https://developer.android.com/jetpack/androidx/releases/media3)
- [W3C Media Capabilities](https://www.w3.org/TR/media-capabilities/)
- [Microsoft IEC-61937 format representation](https://learn.microsoft.com/en-us/windows/win32/coreaudio/representing-formats-for-iec-61937-transmissions)
- [Dolby licensing and product approval](https://professional.dolby.com/licensing/)
