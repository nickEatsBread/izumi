//! v0.1.40 aborted ~250ms after launch on macOS 26 (SIGABRT / abort()).
//!
//! The crashed thread was the AppKit main thread inside
//! `NSApplication _postDidFinishNotification` → a Tauri setup observer.
//! That observer called `macos_embed::prepare`, which KVC'd the private
//! WKWebView key `drawsBackground`. An uncaught NSException is abort.

#[test]
fn macos_embed_does_not_kvc_draws_background() {
    let src = include_str!("../src/player/macos_embed.rs");
    assert!(
        !src.contains("\"drawsBackground\""),
        "setValue:forKey: drawsBackground threw NSUnknownKeyException and aborted izumi at launch"
    );
}

#[test]
fn app_setup_does_not_create_macos_mpv_view() {
    let src = include_str!("../src/lib.rs");
    assert!(
        !src.contains("macos_embed::prepare"),
        "prepare() during Tauri setup aborted at NSApplicationDidFinishLaunching (v0.1.40)"
    );
}

#[test]
fn macos_player_embed_must_not_pass_wid_to_cocoa_cb() {
    let src = include_str!("../src/lib.rs");
    assert!(
        !src.contains("macos_embed::ensure_ready"),
        "cocoa-cb --wid on macOS creates a separate mpv NSWindow; use vo=libmpv + NSOpenGLView"
    );
    assert!(
        !src.contains("macos_embed::wid"),
        "macOS player_embed must not hand an NSView pointer to mpv as --wid"
    );
}

#[test]
fn macos_play_embedded_render_must_compile_on_macos() {
    let src = include_str!("../src/player/mod.rs");
    let play_idx = src
        .find("pub fn play_embedded_render")
        .expect("play_embedded_render must exist");
    let cfg_line = src[..play_idx]
        .lines()
        .rev()
        .find(|l| l.contains("cfg"))
        .expect("play_embedded_render must be cfg-gated");
    assert!(
        cfg_line.contains("macos"),
        "play_embedded_render must compile on macOS (vo=libmpv render API), got: {cfg_line}"
    );
}

#[test]
fn macos_wkwebview_uses_method_not_kvc_to_clear_background() {
    let src = include_str!("../src/player/macos_embed.rs");
    assert!(
        !src.contains("\"drawsBackground\""),
        "KVC drawsBackground aborted izumi on macOS 26"
    );
    assert!(
        src.contains("_setDrawsBackground:"),
        "macOS 26 WKWebView only clears via _setDrawsBackground: (setDrawsBackground: is gone)"
    );
}

#[test]
fn macos_gl_view_must_not_be_layer_backed() {
    // Layer-backed NSOpenGLView + an opaque black CALayer is a known blank-surface
    // failure: mpv still decodes and plays audio, but AppKit composites the layer
    // instead of the GL framebuffer. Harbor-style wantsLayer is wrong on macOS 26.
    let src = include_str!("../src/player/macos_embed.rs");
    assert!(
        !src.contains("view_as_view.setWantsLayer(true)"),
        "NSOpenGLView must not be layer-backed or the video surface stays black"
    );
    assert!(
        !src.contains("paint_black_layer"),
        "an opaque black CALayer on the GL view hides mpv's framebuffer"
    );
}

#[test]
fn macos_fullscreen_must_refit_and_refocus() {
    let lib = include_str!("../src/lib.rs");
    assert!(
        lib.contains("macos_embed::resize"),
        "native fullscreen changes the content view; the GL view must be refit"
    );
    assert!(
        lib.contains("macos_embed::refocus_webview"),
        "fullscreen steals first responder; restore it so player hotkeys keep working"
    );
    let embed = include_str!("../src/player/macos_embed.rs");
    assert!(
        embed.contains("makeFirstResponder"),
        "refocus must hand key events back to WKWebView, not the NSOpenGLView"
    );
    assert!(
        embed.contains("is_wk_webview"),
        "wry's class is WryWebView0.xx, not WKWebView; refocus must match that name"
    );
}

#[test]
fn macos_transparency_must_not_punch_opengl_surface() {
    let src = include_str!("../src/player/macos_embed.rs");
    assert!(
        src.contains("NSOpenGL"),
        "apply_clear_background must skip NSOpenGLView so the CGL layer stays opaque"
    );
    let apply = src
        .split("fn apply_clear_background")
        .nth(1)
        .expect("apply_clear_background");
    let body = apply.split("fn call_bool_setter").next().expect("body");
    assert!(
        body.contains("NSOpenGL") && body.contains("return"),
        "clearing NSOpenGLView's layer hides mpv's framebuffer"
    );
}

#[test]
fn macos_embed_attaches_owned_opengl_surface() {
    let embed = include_str!("../src/player/macos_embed.rs");
    let player = include_str!("../src/player/mod.rs");
    assert!(
        embed.contains("NSOpenGLView"),
        "macOS video surface must be an NSOpenGLView we own, not cocoa-cb's window"
    );
    assert!(
        embed.contains("RenderContext") || embed.contains("create_render_context"),
        "macOS embed must drive mpv through the OpenGL render API"
    );
    assert!(
        player.contains("macos_embed::attach"),
        "first play must attach the macOS OpenGL render context before loadfile"
    );
    assert!(
        player.contains("macos_embed::detach"),
        "stop() must drop the macOS render context before quitting the core"
    );
}
