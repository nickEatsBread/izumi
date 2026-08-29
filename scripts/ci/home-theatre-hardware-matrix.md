# Home-theatre physical regression matrix

This matrix is the release gate for bitstream and HDR claims. Emulator, unit and codec-enumeration
results are useful preflight evidence, but do not prove an AVR decoded an object-audio stream or a
TV entered its HDR mode. A completed report must validate with real hardware and
[`home-theatre-report.mjs`](./home-theatre-report.mjs).

## Required topologies

1. `desktop-avr-tv`: desktop HDMI → AVR HDMI input → AVR HDMI output → HDR TV.
2. `desktop-tv-earc-avr`: desktop HDMI → HDR TV → TV eARC → AVR/eARC soundbar.
3. `android-tv-earc-avr`: Android TV box HDMI → HDR TV → TV eARC → AVR/eARC soundbar.

Record exact source, GPU/driver or Android build, TV firmware, AVR firmware, HDMI port and eARC
mode. Disable TV post-processing that hides source format, but do not force an HDR picture preset.

## Fixture set

Use legally obtained, short fixtures whose codec metadata has been verified with `ffprobe`. Record
the SHA-256 hashes in the report so every topology uses the same bytes. The required cases cover:

- AC-3 5.1, E-AC3 JOC Atmos, TrueHD Atmos, DTS core, DTS-HD MA, DTS:X carried by DTS-HD MA, and a
  DTS-UHD/DTS:X Profile 1 or 2 negative/positive capability check.
- HDR10, HDR10+, HLG, Dolby Vision Profiles 5, 7 MEL, 7 FEL, 8.1 and 8.4.
- HEVC Main10 Level 5.1, AV1 Main 10-bit and VP9 Profile 2.
- Audio-filter and 1.25× speed PCM fallbacks, plus a live HDMI/eARC route change.

Profile 7 FEL is not a presumed pass: record the device’s actual enhancement-layer behaviour.
Likewise, mpv’s `dts-hd` path covers DTS core/DTS-HD; DTS-UHD is a distinct Android encoding and
must be reported as blocked when the active engine cannot bitstream it.

## Evidence for every executed case

- `clientDiagnostics`: Izumi’s Home-theatre capability diagnostics, including route confidence,
  active engine, codec string/profile decision, native HDR path and output classification.
- `sinkObservation`: AVR front-panel/app codec indication for audio, or the TV signal-information
  panel for HDR. “It sounds/looks right” is not sufficient.
- `notes`: audible channel check or visible test-pattern result, unexpected mute/flash, seek result,
  and any TV passthrough/eARC setting needed.

Use `blocked` (with a reason) for a limitation such as an AVR without DTS:X or a TV without Dolby
Vision. Use `fail` when hardware claims support but playback, routing, metadata or fallback is
wrong. Do not convert an unavailable device into a pass.

## Running the gate

Copy `scripts/ci/home-theatre-report.template.json`, fill in the equipment and fixture hashes, and execute:

```text
node scripts/ci/home-theatre-report.mjs path/to/completed-report.json
```

The checked-in all-`not-run` template can only be structurally checked with `--allow-not-run`.
This is intentional: CI has no AVR, eARC link or Android TV display and cannot truthfully satisfy
the physical gate.

The matrix follows the platform boundaries documented by the
[Android HDR playback guide](https://developer.android.com/media/grow/hdr-playback),
[Media3 device guidance](https://developer.android.com/media/media3/exoplayer/supported-devices),
[Android audio-format API](https://developer.android.com/reference/android/media/AudioFormat), and
[mpv audio passthrough manual](https://mpv.io/manual/stable/#options-audio-spdif).
