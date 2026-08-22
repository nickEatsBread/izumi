//! Color / HDR options shared by every desktop mpv core.
//!
//! These match current mpv master defaults (`video/out/gpu/video.c` +
//! `etc/builtin.conf`). Forcing `tone-mapping=bt.2390` is the one look we
//! used to impose: on `--vo=gpu-next` stock `auto` is spline, not bt.2390.
//! The other keys are explicit so cores cannot drift; they are already mpv's
//! defaults if left unset.

/// `(key, value)` pairs applied best-effort at core init. Unknown names are ignored
/// by the caller (`let _ =`) so older libmpv still starts.
pub const COLOR_OPTS: &[(&str, &str)] = &[
    // Swapchain colorspace hint: HDR passthrough on D3D11 / Wayland when the
    // display parameters are known; no-op elsewhere.
    ("target-colorspace-hint", "auto"),
    // `auto` → bt.2390 on vo=gpu/libmpv, spline on gpu-next. Do not hard-code
    // bt.2390 or gpu-next loses libplacebo's better curve.
    ("tone-mapping", "auto"),
    // Stock default is auto (enable only if compute shaders/SSBOs exist).
    // Forcing yes can tank some GLES/iGPU drivers; the manual warns about that.
    ("hdr-compute-peak", "auto"),
    ("gamut-mapping-mode", "auto"),
    ("dither-depth", "auto"),
];

#[cfg(test)]
mod tests {
    use super::COLOR_OPTS;

    fn get(key: &str) -> Option<&'static str> {
        COLOR_OPTS
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| *v)
    }

    #[test]
    fn tone_mapping_is_auto_not_forced_bt2390() {
        assert_eq!(get("tone-mapping"), Some("auto"));
        assert!(
            COLOR_OPTS
                .iter()
                .all(|(k, v)| !(*k == "tone-mapping" && *v == "bt.2390"))
        );
    }

    #[test]
    fn hdr_peak_detection_is_auto() {
        assert_eq!(get("hdr-compute-peak"), Some("auto"));
    }

    #[test]
    fn dither_and_hint_match_stock_mpv() {
        assert_eq!(get("dither-depth"), Some("auto"));
        assert_eq!(get("target-colorspace-hint"), Some("auto"));
        assert_eq!(get("gamut-mapping-mode"), Some("auto"));
    }

    #[test]
    fn does_not_force_full_range_or_a_primaries_guess() {
        // video-output-levels=full washes out TV-range anime. target-prim/trc
        // guesses fight the display. Leave them to mpv auto.
        for (k, _) in COLOR_OPTS {
            assert_ne!(*k, "video-output-levels");
            assert_ne!(*k, "target-prim");
            assert_ne!(*k, "target-trc");
        }
    }
}
