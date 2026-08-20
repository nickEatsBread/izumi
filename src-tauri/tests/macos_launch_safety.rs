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
