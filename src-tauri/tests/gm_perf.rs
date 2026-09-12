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
fn native_controls_match_crunchy_deck_motion_and_seekbar() {
    assert_eq!(NATIVE_CONTROLS_FADE_MS, 300);
    assert_eq!(NATIVE_CONTROLS_MOTION_PX, 0.0);
    assert_eq!(NATIVE_SEEKBAR_IDLE_PX, 6.0);
    assert_eq!(NATIVE_SEEKBAR_ACTIVE_PX, 10.0);
    assert_eq!(NATIVE_SEEKBAR_TWEEN_MS, 150);
    assert_eq!(OVERLAY_SHEET_MOTION_PX, 40);
    assert_eq!(css_ease(0.0), 0.0);
    assert_eq!(css_ease(1.0), 1.0);
    assert!((css_ease(0.5) - 0.7756).abs() < 0.001);
    assert_eq!(NATIVE_ASS_TWEEN_STEPS, 30.0);
    assert_eq!(quantize_animation_unit(0.0), 0.0);
    assert_eq!(quantize_animation_unit(1.0), 1.0);
    assert_eq!(quantize_animation_unit(0.501), 0.5);

    let osd = include_str!("../src/player/gm_osd.rs");
    assert!(osd.contains("ControlTween"));
    assert!(osd.contains("quantize_animation_unit"));
    assert!(osd.contains("controls_background_ass"));
    assert!(osd.contains("controls_content_ass"));
    assert!(osd.contains("1000 / OSD_FPS"));
    assert!(osd.contains("\\fnNunito"));
    assert!(osd.contains("\\fnDejaVu Sans Mono"));
    assert!(osd.contains("SeekbarTween"));
    assert!(osd.contains("state.title_size"));
    assert!(osd.contains("player_title_text"));
    // The player uses one interrupted opacity tween just like CrunchyDeck's parent chrome layer.
    assert!(osd.contains("start_opacity"));
    assert!(!osd.contains("start_content"));
    // Native shapes keep 1/8px ASS coordinates and use the same icon identities as the HTML HUD.
    assert!(osd.contains(r"\\p4"));
    assert!(!osd.contains(r"\\p1"));
    assert!(osd.contains("Lucide Settings silhouette"));
    assert!(osd.contains("Lucide MessageSquare"));
    assert!(!osd.contains("rounded_rect_ring"));
    // The seek track has no independent shadow; the one bottom wash uses the reference's stops.
    assert!(!osd.contains("rect_blur"));
    assert!(!osd.contains("fade_h"));
    assert!(osd.contains("soft_rect"));
    assert!(osd.contains("surface_opacity"));
    assert!(osd.contains("height * 0.68"));
    assert!(!osd.contains("let bands = 16usize"));
    assert!(osd.contains("0.90 * opacity"));
    assert!(!osd.contains("PAD_SCRUB_TAU"));
    assert!(!osd.contains("smooth_scrub_time"));
    assert!(osd.contains("alpha_hex(opacity * 0.50)"));
    assert!(osd.contains("h - 12.0"));
    assert!(osd.contains("timeline_marks_ass"));
    assert!(osd.contains("timeline_segments"));
    assert!(osd.contains("chapter_marks"));
    assert!(osd.contains("OSD_TIMELINE_MARKS_ID"));
    assert!(osd.contains("&mut shown.marks_ass"));
}

#[test]
fn gamescope_mpv_work_never_blocks_the_gtk_producer() {
    let player = include_str!("../src/player/mod.rs");
    let dispatch = include_str!("../src/player/mpv_dispatch.rs");
    let overlay = include_str!("../src/player/linux_overlay.rs");

    assert!(player.contains("command_from_ui"));
    assert!(player.contains("dispatch.bitmap_add"));
    assert!(player.contains("dispatch.ass"));
    assert!(dispatch.contains("izumi-mpv-ui"));
    assert!(dispatch.contains("MAX_PENDING"));
    assert!(dispatch.contains("CoalesceKey::Seek"));
    assert!(dispatch.contains(".retain(|pending|"));
    assert!(overlay.contains("let pixels ="));
    assert!(!overlay.contains("buf.as_ptr() as usize"));
    let commands = include_str!("../src/lib.rs");
    assert!(commands.contains("async fn close_player"));
    assert!(commands.contains("player.command_from_ui"));
}

#[test]
fn gamescope_touch_reveals_controls_from_the_native_begin_edge() {
    let commands = include_str!("../src/lib.rs");
    assert!(commands.contains("connect_touch_event"));
    assert!(commands.contains("gdk::EventType::TouchBegin"));
    assert!(commands.contains("gm-native-touch-begin"));
    // Observing the edge must not consume it: WebKit still owns the actual touch gesture.
    assert!(commands.contains("glib::Propagation::Proceed"));
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
    assert!(
        !include_str!("../../src/lib/components/player/PlayerOverlay.svelte").contains("p2pText")
    );
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

#[test]
fn compositor_probe_is_opt_in() {
    let lib = include_str!("../src/lib.rs");
    assert!(lib.contains("IZUMI_COMPOSITOR_PROBE"));
}

#[test]
fn refresh_cycle_targets_whole_fps_and_clears_otherwise() {
    // NTSC-ish rates round to their integer cadence; gamescope then picks the highest panel
    // refresh that is a multiple (24 → 72 Hz on the OLED Deck, 30 → 90 Hz).
    assert_eq!(refresh_target_fps(23.976), Some(24));
    assert_eq!(refresh_target_fps(24.0), Some(24));
    assert_eq!(refresh_target_fps(25.0), Some(25));
    assert_eq!(refresh_target_fps(29.97), Some(30));
    assert_eq!(refresh_target_fps(59.94), Some(60));
    // Unknown, variable or absurd container rates leave the panel alone.
    assert_eq!(refresh_target_fps(0.0), None);
    assert_eq!(refresh_target_fps(-1.0), None);
    assert_eq!(refresh_target_fps(f64::NAN), None);
    assert_eq!(refresh_target_fps(12.5), None);
    assert_eq!(refresh_target_fps(1000.0), None);
    assert_eq!(refresh_target_fps(15.0), None);
    // internal_display | allow_refresh_switching | only_change_refresh_rate — never the fps cap.
    assert_eq!(REFRESH_CYCLE_FLAGS_INTERNAL, 0x1 | 0x2 | 0x4);
    assert_eq!(REFRESH_CYCLE_FLAGS_EXTERNAL, 0x2 | 0x4);
    let player = include_str!("../src/player/mod.rs");
    assert!(player.contains("gamescope_refresh::on_file_loaded("));
    assert!(player.contains("gamescope_refresh::clear()"));
    let lib = include_str!("../src/lib.rs");
    assert!(lib.contains("gamescope_refresh::clear_blocking()"));
}

#[test]
fn overlay_fade_frames_come_from_one_pass_over_the_snapshot() {
    let src: Vec<u8> = (0..=255u8).collect();
    for alpha in [0u32, 1, 137, 500, 999, 1000, 1500] {
        let mut dst = vec![255u8; src.len()];
        scale_premult_bgra(&src, &mut dst, alpha);
        let owned = scale_premult_bgra_vec(&src, alpha);
        assert_eq!(owned, dst, "alpha {alpha}");
        for (i, &b) in owned.iter().enumerate() {
            let expected = ((i as u32 * alpha.min(OVERLAY_FADE_FULL)) / OVERLAY_FADE_FULL) as u8;
            assert_eq!(b, expected, "alpha {alpha} byte {i}");
        }
    }
    // Each fade tick hands the dispatcher one owned frame: no scratch buffer, no clone.
    let overlay = include_str!("../src/player/linux_overlay.rs");
    assert!(overlay.contains("scale_premult_bgra_vec"));
    assert!(!overlay.contains("buf.clone()"));
    assert!(!overlay.contains("static BUF"));
}

#[test]
fn ui_lite_scaler_swap_runs_on_the_dispatcher_thread() {
    let player = include_str!("../src/player/mod.rs");
    let dispatch = include_str!("../src/player/mpv_dispatch.rs");
    assert!(player.contains("dispatch.render_opts(opts.clone())"));
    assert!(dispatch.contains("Work::RenderOpts"));
    assert!(dispatch.contains("CoalesceKey::RenderOpts"));
}

#[test]
fn osd_idle_ticks_share_state_without_cloning() {
    let osd = include_str!("../src/player/gm_osd.rs");
    assert!(osd.contains("state: Arc<GmDynamicOverlay>"));
    assert!(osd.contains("let mut draw_state = (*state).clone();"));
    assert!(!osd.contains("let mut draw_state = state.clone();"));
}

#[test]
fn pointer_unstick_reuses_the_keepalive_connection() {
    let x11 = include_str!("../src/player/linux_x11.rs");
    assert!(x11.contains("TouchCmd::Unstick"));
    assert!(x11.contains("fn existing_touch_worker"));
    assert!(x11.contains("release_pointer_buttons(dpy, root)"));
}
