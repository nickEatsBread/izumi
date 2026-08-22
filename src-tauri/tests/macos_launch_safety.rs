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
