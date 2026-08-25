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
fn deck_wayland_prefers_zero_copy_with_safe_fallbacks() {
    assert_eq!(libmpv_hwdec(true), "auto");
    assert_eq!(libmpv_hwdec(false), "auto-copy");
    let player = include_str!("../src/player/mod.rs");
    assert!(player.contains("libmpv_hwdec(game_mode_wayland)"));
}

#[test]
fn gamepad_blocks_until_input_instead_of_polling_at_120hz() {
    let gamepad = include_str!("../src/player/gamepad_linux.rs");
    assert!(gamepad.contains("next_event_blocking(Some(Duration::from_millis(250)))"));
    assert!(gamepad.contains("with_default_filters(false)"));
    assert!(gamepad.contains("Axis::DPadX | Axis::DPadY"));
    assert!(gamepad.contains("RUN_ID"));
    assert!(!gamepad.contains("sleep(Duration::from_millis(8))"));
}

#[test]
fn gamescope_wayland_is_opt_in_and_reports_live_chrome() {
    let lib = include_str!("../src/lib.rs");
    assert!(lib.contains("IZUMI_GAMESCOPE_NATIVE_WAYLAND"));
    assert!(lib.contains("gamescope_native_wayland_ready"));
    assert!(lib.contains("GDK_BACKEND\", \"wayland"));
    assert!(lib.contains("player_compositor_path"));
    assert!(lib.contains("wayland-live"));
    assert!(lib.contains("x11-snapshot"));
}

#[test]
fn overlay_cpu_fade_scales_premultiplied_bgra() {
    assert_eq!(OVERLAY_FADE_MS, 150);
    assert_eq!(OVERLAY_FADE_FRAME_MS, 25);
    assert_eq!(overlay_fade_step(0, true, 150, 150), OVERLAY_FADE_FULL);
    assert_eq!(overlay_fade_step(OVERLAY_FADE_FULL, false, 150, 150), 0);
    assert_eq!(overlay_fade_step(500, true, 75, 150), 1000);
    assert!(overlay_fade_step(0, true, 16, 150) > 0);
    assert!(overlay_fade_step(0, true, 16, 150) < OVERLAY_FADE_FULL);

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
    assert!(overlay.contains("present(&app, hidden)"));
    assert!(overlay.contains("fade_in || FAST.load(Ordering::Relaxed)"));
    assert!(!overlay.contains("present(&app, false)"));
    assert!(overlay.contains("saturating_add(x_offset)"));
    assert!(overlay.contains("present_sheet_backdrop"));
}

#[test]
fn native_controls_match_vacuumtube_motion_curve() {
    assert_eq!(NATIVE_CONTROLS_FADE_MS, 160);
    assert_eq!(NATIVE_CONTROLS_CONTENT_MS, 120);
    assert_eq!(NATIVE_CONTROLS_MOTION_PX, 18.0);
    assert_eq!(OVERLAY_SHEET_MOTION_PX, 40);
    assert_eq!(css_ease(0.0), 0.0);
    assert_eq!(css_ease(1.0), 1.0);
    assert!((css_ease(0.5) - 0.8024).abs() < 0.001);

    let osd = include_str!("../src/player/gm_osd.rs");
    assert!(osd.contains("ControlTween"));
    assert!(osd.contains("controls_background_ass"));
    assert!(osd.contains("controls_content_ass"));
    assert!(osd.contains("1000 / OSD_FPS"));
    assert!(osd.contains("\\fnNunito"));
    assert!(osd.contains("player_title_text"));
    // The current Lucide controls use real strokes; the obsolete compound ASS ring produced
    // filled/garbled icons and is explicitly forbidden by the matching frontend contract test.
    assert!(!osd.contains("rounded_rect_ring"));
    assert!(osd.contains("h - 12.0"));
    assert!(osd.contains("timeline_marks_ass"));
    assert!(osd.contains("timeline_segments"));
    assert!(osd.contains("chapter_marks"));
    assert!(osd.contains("OSD_TIMELINE_MARKS_ID"));
    assert!(osd.contains("&mut shown.marks_ass"));
}

#[test]
fn idle_overlay_does_not_raster_unless_forced() {
    assert_eq!(OVERLAY_IDLE_FPS, 0);
    assert!(!overlay_should_snapshot(false, false, false));
    assert!(overlay_should_snapshot(false, true, false));
    assert!(overlay_should_snapshot(true, false, false));
    assert!(!overlay_should_snapshot(true, true, true));
    assert_eq!(overlay_loop_fps(false), 0);
    assert_eq!(overlay_loop_fps(true), 30);
    assert_eq!(OVERLAY_ACTIVE_POLL_MS, 8);

    let overlay = include_str!("../src/player/linux_overlay.rs");
    assert!(overlay.contains("SnapshotOptions::TRANSPARENT_BACKGROUND"));
    assert!(overlay.contains("if exact_crop && strip.is_some()"));
    assert!(overlay.contains("clip_to_strip((0, 0, w as usize, h as usize), strip)"));
    assert!(overlay.contains("Duration::from_millis(OVERLAY_ACTIVE_POLL_MS)"));
}

#[test]
fn idle_snapshots_clip_to_the_control_strip() {
    let strip = control_strip_crop(1280, 800, false).expect("idle crop");
    assert_eq!(strip, (0, 512, 1280, 288));
    assert!(control_strip_crop(1280, 800, true).is_none());

    let full = (0, 0, 1280, 800);
    assert_eq!(clip_to_strip(full, Some(strip)), Some((0, 512, 1280, 288)));
    assert_eq!(
        clip_to_strip((40, 600, 200, 80), Some(strip)),
        Some((40, 600, 200, 80))
    );
    assert!(clip_to_strip((10, 10, 40, 40), Some(strip)).is_none());
    assert_eq!(clip_to_strip(full, None), Some(full));
}

#[test]
fn osd_cadence_tracks_a_finger_skim() {
    assert_eq!(OSD_FPS, 60);
    let osd = include_str!("../src/player/gm_osd.rs");
    assert!(osd.contains("const PROGRESS_FRAME_MS: u64 = 100"));
    assert!(osd.contains("state.scrubbing || state.controls"));
    assert!(osd.contains("progress_dynamic_ass"));
}

#[test]
fn transient_chrome_sits_above_the_loading_backdrop() {
    let osd = include_str!("../src/player/gm_osd.rs");
    assert!(osd.contains("const Z_LOADING: i64 = 60"));
    assert!(osd.contains("const Z_CHROME: i64 = 70"));
}

#[test]
fn p2p_text_fallback_is_removed() {
    assert!(!include_str!("../src/lib.rs").contains("p2p_text"));
    assert!(!include_str!("../../src/lib/components/player/PlayerOverlay.svelte")
        .contains("p2pText"));
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
    assert!(!touch_focus_recovery_allowed(1_600, 1_200));
    assert!(touch_focus_recovery_allowed(1_600, 1_600));
}

#[test]
fn chrome_ass_omits_empty_layers_and_escapes_text() {
    assert!(chrome_ass("", "", 1280.0, 800.0).is_empty());
    let skip = chrome_ass("Skip Opening", "", 1280.0, 800.0);
    assert!(skip.contains("Skip Opening"));
    let notice = chrome_ass("", "Next episode {loading}", 1280.0, 800.0);
    assert!(notice.contains("Next episode \\{loading\\}"));
}
