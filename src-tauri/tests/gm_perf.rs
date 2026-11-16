// Isolated from the native libmpv test binary, which needs mpv.lib on Windows.
#![allow(dead_code)]

#[path = "../src/gm_perf.rs"]
mod gm_perf;

use gm_perf::*;
use std::num::NonZeroU32;

#[test]
fn deck_wayland_prefers_zero_copy_with_safe_fallbacks() {
    assert_eq!(libmpv_hwdec(true), "auto");
    assert_eq!(libmpv_hwdec(false), "auto-copy");
    let player = include_str!("../src/player/mod.rs");
    assert!(player.contains("libmpv_hwdec(game_mode_wayland)"));
}

#[test]
fn gamepad_blocks_until_input_instead_of_polling_at_120hz() {
    let gamepad = include_str!("../src/player/gamepad_linux.rs");
    // Blocks until input, waking only for a held direction's next repeat or the 250 ms bound.
    assert!(gamepad.contains("next_event_blocking(Some(dirs.wait(Instant::now())))"));
    assert!(gamepad.contains("const READ_BOUND: Duration = Duration::from_millis(250);"));
    assert!(gamepad.contains("with_default_filters(false)"));
    assert!(gamepad.contains("Axis::DPadX | Axis::DPadY"));
    assert!(gamepad.contains("RUN_ID"));
    assert!(!gamepad.contains("sleep(Duration::from_millis(8))"));
}

#[test]
fn torrent_eases_after_the_first_healthy_frame() {
    let user = NonZeroU32::new(20 * 1024 * 1024);
    assert_eq!(playback_download_bps(user, false, false), user);
    assert_eq!(playback_download_bps(user, true, true), user);
    assert_eq!(
        playback_download_bps(None, true, false).map(|v| v.get()),
        Some(POST_START_DOWNLOAD_BPS)
    );
    assert_eq!(torrent_peer_limit(true), None);
    assert_eq!(torrent_peer_limit(false), None);
    assert_eq!(torrent_runtime_threads(true), None);
    assert_eq!(torrent_runtime_threads(false), None);
}

#[test]
fn grip_reader_idles_outside_the_player() {
    assert_eq!(grip_poll_sleep_ms(true), GRIP_POLL_ACTIVE_SLEEP_MS);
    assert_eq!(grip_poll_sleep_ms(false), GRIP_POLL_IDLE_SLEEP_MS);
    assert!(GRIP_POLL_IDLE_SLEEP_MS >= 100);
    assert!(GRIP_POLL_ACTIVE_SLEEP_MS <= 20);
    let gamepad = include_str!("../src/player/gamepad_linux.rs");
    assert!(gamepad.contains("grip_poll_sleep_ms("));
    assert!(!gamepad.contains("sleep(Duration::from_millis(16))"));
    let player = include_str!("../src/player/mod.rs");
    assert!(player.contains("PLAYER_ACTIVE.store(true"));
    assert!(player.contains("PLAYER_ACTIVE.store(false"));
}

#[test]
fn gamepad_edges_do_not_touch_the_log_file() {
    let gamepad = include_str!("../src/player/gamepad_linux.rs");
    assert!(!gamepad.contains("elog(&format!(\"gamepad: {}={}\""));
    assert!(gamepad.contains("gamepad_log_enabled()"));
}

#[test]
fn gamescope_never_restores_remembered_window_geometry() {
    // A Desktop-mode size (1280x560 under KDE's panel) restored under gamescope letterboxes and
    // crops the whole app. The window-state plugin must not exist in Game mode.
    let lib = include_str!("../src/lib.rs");
    assert!(lib.contains("let under_gamescope = std::env::var_os(\"GAMESCOPE_WAYLAND_DISPLAY\").is_some();"));
    let gate = lib.find("let builder = if under_gamescope {").expect("gamescope gate");
    let plugin = lib.find("tauri_plugin_window_state::Builder::default()").expect("plugin");
    assert!(gate < plugin, "the plugin must only be registered on the non-gamescope branch");
}
