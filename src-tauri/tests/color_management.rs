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

#[test]
fn cores_do_not_force_fbo_format() {
    // Current mpv auto already prefers 16-bit float FBOs. A forced format
    // (rgba16hf) is a no-op on gpu-next and can disable GLES fallback.
    for src in [
        include_str!("../src/player/mod.rs"),
        include_str!("../src/player/color_management.rs"),
        include_str!("../tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt"),
    ] {
        assert!(
            !src.contains("set_option(\"fbo-format\"")
                && !src.contains("setOptionString(\"fbo-format\"")
                && !src.contains("(\"fbo-format\""),
            "do not force --fbo-format; leave mpv auto"
        );
    }
}

#[test]
fn macos_embed_stays_on_libmpv_opengl() {
    // gpu-next has no libmpv render API (mpv wiki GPU-Next-vs-GPU) and macOS
    // gpu-next needs MoltenVK, which the dmg does not bundle.
    let player = include_str!("../src/player/mod.rs");
    let embed = include_str!("../src/player/macos_embed.rs");
    assert!(
        player.contains("init.set_option(\"vo\", \"libmpv\")"),
        "Linux/macOS embed must use vo=libmpv for the OpenGL render API"
    );
    assert!(
        player.contains("gpu-next wants macvk/MoltenVK"),
        "own-window macOS must keep the documented gpu-next skip"
    );
    assert!(
        embed.contains("OpenGL render API is the working embed path"),
        "macOS embed must stay on NSOpenGLView, not macvk"
    );
}

#[test]
fn android_plugin_stores_and_applies_render_opts() {
    let src = include_str!("../tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt");
    assert!(
        src.contains("fun setRenderOpts"),
        "Android must accept the quality-preset option set"
    );
    assert!(
        src.contains("storedRenderOpts"),
        "Android must stash render opts for the next ensureCore, like desktop RENDER_OPTS"
    );
}
