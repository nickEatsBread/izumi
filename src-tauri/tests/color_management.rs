// Isolated from the native libmpv test binary, which needs mpv.lib on Windows.
#![allow(dead_code)]

#[path = "../src/player/color_management.rs"]
mod color_management;

#[test]
fn desktop_cores_apply_shared_color_opts() {
    let src = include_str!("../src/player/mod.rs");
    assert!(
        src.contains("COLOR_OPTS"),
        "Windows/Linux/macOS cores must share color_management::COLOR_OPTS"
    );
    assert!(
        !src.contains("tone-mapping\", \"bt.2390\""),
        "forcing bt.2390 skips gpu-next spline tone-mapping"
    );
}

#[test]
fn android_core_sets_stock_tone_mapping() {
    let src = include_str!("../tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt");
    assert!(
        src.contains("setOptionString(\"tone-mapping\", \"auto\")"),
        "Android libmpv must not skip HDR tone-mapping"
    );
    assert!(
        src.contains("setOptionString(\"dither-depth\", \"auto\")"),
        "Android must dither 10-bit to the panel"
    );
}

#[test]
fn macos_surface_prefers_float_edr_over_8bit() {
    let src = include_str!("../src/player/macos_embed.rs");
    assert!(
        src.contains("NSOPENGLPFA_COLOR_FLOAT"),
        "macOS must try a float pixel format so 10-bit is not truncated to 8-bit"
    );
    assert!(
        src.contains("setWantsExtendedDynamicRangeOpenGLSurface"),
        "macOS should request EDR when the float format is available"
    );
}
