// Isolated from the native libmpv test binary, which needs mpv.lib on Windows.
#![allow(dead_code)]

#[path = "../src/gm_perf.rs"]
mod gm_perf;

use gm_perf::*;
use std::num::NonZeroU32;

#[test]
fn game_mode_keeps_hardware_webkit() {
    assert!(game_mode_uses_hardware_webkit());
    let lib = include_str!("../src/lib.rs");
    assert!(lib.contains("HardwareAccelerationPolicy::OnDemand"));
    assert!(lib.contains("game_mode_uses_hardware_webkit"));
}

#[test]
fn overlay_cpu_fade_scales_premultiplied_bgra() {
    assert_eq!(OVERLAY_FADE_MS, 180);
    assert_eq!(overlay_fade_step(0, true, 180, 180), OVERLAY_FADE_FULL);
    assert_eq!(overlay_fade_step(OVERLAY_FADE_FULL, false, 180, 180), 0);
    assert_eq!(overlay_fade_step(500, true, 90, 180), 1000);
    assert!(overlay_fade_step(0, true, 16, 180) > 0);
    assert!(overlay_fade_step(0, true, 16, 180) < OVERLAY_FADE_FULL);

    let src = vec![10u8, 20, 30, 40, 200, 200, 200, 200];
    let mut dst = vec![255u8; 8];
    scale_premult_bgra(&src, &mut dst, 0);
    assert_eq!(dst, vec![0, 0, 0, 0, 0, 0, 0, 0]);
    scale_premult_bgra(&src, &mut dst, OVERLAY_FADE_FULL);
    assert_eq!(dst, src);
    scale_premult_bgra(&src, &mut dst, 500);
    assert_eq!(dst, vec![5, 10, 15, 20, 100, 100, 100, 100]);

    let overlay = include_str!("../src/player/linux_overlay.rs");
    assert!(overlay.contains("kick_fade"));
    assert!(overlay.contains("scale_premult_bgra"));
    assert!(overlay.contains("BASE"));
    assert!(overlay.contains("empty snapshot"));
    assert!(overlay.contains("SHOWN.store(true"));
    // mpv copies raw-address overlay pixels during overlay-add. A buffer mutation without
    // another command is invisible, which was the frozen/no-animation regression.
    assert!(overlay.contains("present(&app, y_offset)"));
    assert!(!overlay.contains("present(&app, false)"));
    assert!(overlay.contains("saturating_add(y_offset)"));
}

#[test]
fn idle_overlay_does_not_raster_unless_forced() {
    assert_eq!(OVERLAY_IDLE_FPS, 0);
    assert!(!overlay_should_snapshot(false, false, false));
    assert!(overlay_should_snapshot(false, true, false));
    assert!(overlay_should_snapshot(true, false, false));
    assert!(!overlay_should_snapshot(true, true, true));
    assert_eq!(overlay_loop_fps(false), 0);
    assert_eq!(overlay_loop_fps(true), 60);
}

#[test]
fn idle_snapshots_clip_to_the_control_strip() {
    let strip = control_strip_crop(1280, 800, false).expect("idle crop");
    assert_eq!(strip, (0, 512, 1280, 288));
    assert!(control_strip_crop(1280, 800, true).is_none());

    let full = (0, 0, 1280, 800);
    assert_eq!(clip_to_strip(full, Some(strip)), Some((0, 512, 1280, 288)));
    assert_eq!(clip_to_strip((40, 600, 200, 80), Some(strip)), Some((40, 600, 200, 80)));
    assert!(clip_to_strip((10, 10, 40, 40), Some(strip)).is_none());
    assert_eq!(clip_to_strip(full, None), Some(full));
}

#[test]
fn osd_cadence_tracks_a_finger_skim() {
    assert_eq!(OSD_FPS, 60);
}

#[test]
fn p2p_chrome_sits_above_the_loading_backdrop() {
    let osd = include_str!("../src/player/gm_osd.rs");
    assert!(osd.contains("const Z_LOADING: i64 = 60"));
    assert!(osd.contains("const Z_CHROME: i64 = 70"));
}

#[test]
fn ui_lite_opts_drop_expensive_scalers() {
    let opts: std::collections::HashMap<_, _> = ui_lite_render_opts().into_iter().collect();
    assert_eq!(opts.get("scale").map(String::as_str), Some("bilinear"));
    assert_eq!(opts.get("deband").map(String::as_str), Some("no"));
    assert_eq!(opts.get("glsl-shaders").map(String::as_str), Some(""));
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
fn touch_restore_coalesces_and_ignores_player_grips() {
    assert!(!should_restore_touch(1_000, 1_200));
    assert!(should_restore_touch(1_000, 1_400));
    assert!(should_restore_touch(5_000, 10));
    assert!(!gamepad_input_restores_touch("l4"));
    assert!(!gamepad_input_restores_touch("r2"));
    assert!(gamepad_input_restores_touch("a"));
    assert!(gamepad_input_restores_touch("down"));
}

#[test]
fn chrome_ass_omits_empty_layers_and_escapes_text() {
    assert!(chrome_ass("", "", "", 1280.0, 800.0, false).is_empty());
    let skip = chrome_ass("Skip Opening", "", "", 1280.0, 800.0, false);
    assert!(skip.contains("Skip Opening"));
    let notice = chrome_ass("", "Next episode {loading}", "", 1280.0, 800.0, false);
    assert!(notice.contains("Next episode \\{loading\\}"));
    let p2p = chrome_ass("", "", "12 peers", 1280.0, 800.0, true);
    assert!(p2p.contains("12 peers"));
}
