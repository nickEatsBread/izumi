//! Pure Game-mode performance helpers.
//!
//! Kept free of GTK/libmpv so Windows CI can test the policy without `mpv.lib`.
//! Shared by the Linux overlay/OSD paths and the torrent engine (including Android).

#![allow(dead_code)]

use std::num::NonZeroU32;

/// Native ASS overlay cadence. Loading/scrub visuals are drawn inside mpv; 30fps is enough
/// for a spinner and a tweened scrub knob without occupying the Deck iGPU at 60.
pub const OSD_FPS: u64 = 30;
/// Snapshot the HTML chrome only when it changes (show/hide or a menu). Idle 12fps rasters
/// were the dominant Game-mode cost while the control bar sat still.
pub const OVERLAY_IDLE_FPS: u64 = 0;
/// Menu highlight / d-pad navigation still needs a high snapshot cadence.
pub const OVERLAY_SCRUB_FPS: u64 = 60;
/// Bottom fraction of the viewport that holds the control strip (idle snapshots only).
pub const CONTROL_STRIP_FRACTION: f64 = 0.28;
/// Ignore Gamescope touch-restore wakes closer together than this.
pub const TOUCH_RESTORE_MIN_INTERVAL_MS: u64 = 400;
/// After the first frame, cap torrent download so piece hashing/IO does not fight the GPU.
pub const POST_START_DOWNLOAD_BPS: u32 = 4 * 1024 * 1024;
/// Connected-peer ceiling while the session is a Game-mode handheld.
pub const GAME_MODE_PEER_LIMIT: usize = 48;
/// Tokio blocking-pool size for the torrent session on Game mode.
pub const GAME_MODE_RUNTIME_THREADS: usize = 2;

/// Game mode keeps WebKit's GPU compositor. Ghost trails are handled by turning off WebKitGTK
/// 2.50 damage propagation, not by forcing the software rasterizer (which aliases curves).
pub fn game_mode_uses_hardware_webkit() -> bool {
    true
}

/// Whether this overlay tick should take a WebKit snapshot.
pub fn overlay_should_snapshot(fast: bool, force: bool, busy: bool) -> bool {
    if busy {
        return false;
    }
    fast || force
}

/// Idle overlay loops must not raster. Fast (menu) loops run at [`OVERLAY_SCRUB_FPS`].
pub fn overlay_loop_fps(fast: bool) -> u64 {
    if fast {
        OVERLAY_SCRUB_FPS
    } else {
        OVERLAY_IDLE_FPS
    }
}

/// Intersect a non-transparent snapshot crop with an optional control-strip rectangle.
/// `bounds` and `strip` are `(x, y, w, h)`.
pub fn clip_to_strip(
    bounds: (usize, usize, usize, usize),
    strip: Option<(i64, i64, i64, i64)>,
) -> Option<(usize, usize, usize, usize)> {
    let Some((sx, sy, sw, sh)) = strip else {
        return Some(bounds);
    };
    if sw <= 0 || sh <= 0 {
        return Some(bounds);
    }
    let (bx, by, bw, bh) = bounds;
    let bx2 = bx.saturating_add(bw);
    let by2 = by.saturating_add(bh);
    let sx = sx.max(0) as usize;
    let sy = sy.max(0) as usize;
    let sx2 = sx.saturating_add(sw as usize);
    let sy2 = sy.saturating_add(sh as usize);
    let x0 = bx.max(sx);
    let y0 = by.max(sy);
    let x1 = bx2.min(sx2);
    let y1 = by2.min(sy2);
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    Some((x0, y0, x1 - x0, y1 - y0))
}

/// Bottom control-strip crop in CSS pixels. `None` while a menu needs the full overlay.
pub fn control_strip_crop(
    width: i64,
    height: i64,
    fast: bool,
) -> Option<(i64, i64, i64, i64)> {
    if fast || width <= 0 || height <= 0 {
        return None;
    }
    let h = ((height as f64) * CONTROL_STRIP_FRACTION).round() as i64;
    let h = h.clamp(1, height);
    Some((0, height - h, width, h))
}

/// mpv render options that drop the expensive scaler/deband/shader chain while Game-mode
/// chrome is on screen. Not written to the stored user preset.
pub fn ui_lite_render_opts() -> Vec<(String, String)> {
    vec![
        ("scale".into(), "bilinear".into()),
        ("dscale".into(), "bilinear".into()),
        ("cscale".into(), "bilinear".into()),
        ("deband".into(), "no".into()),
        ("glsl-shaders".into(), "".into()),
        ("sigmoid-upscaling".into(), "no".into()),
    ]
}

pub fn torrent_peer_limit(game_mode: bool) -> Option<usize> {
    game_mode.then_some(GAME_MODE_PEER_LIMIT)
}

pub fn torrent_runtime_threads(game_mode: bool) -> Option<usize> {
    game_mode.then_some(GAME_MODE_RUNTIME_THREADS)
}

/// After the first frame, and only while the playback buffer is healthy, cap download so
/// hashing/IO yields to the GPU. A stall or the pre-first-frame window keeps the user cap
/// (or unlimited).
pub fn playback_download_bps(
    user_limit: Option<NonZeroU32>,
    first_frame: bool,
    buffer_low: bool,
) -> Option<NonZeroU32> {
    if !first_frame || buffer_low {
        return user_limit;
    }
    let cap = NonZeroU32::new(POST_START_DOWNLOAD_BPS).expect("post-start cap is non-zero");
    Some(user_limit.map(|limit| limit.min(cap)).unwrap_or(cap))
}

pub fn should_restore_touch(last_ms: u64, now_ms: u64) -> bool {
    now_ms.saturating_sub(last_ms) >= TOUCH_RESTORE_MIN_INTERVAL_MS || now_ms < last_ms
}

/// Player-only grips/triggers never change Gamescope's screen, so they must not wake the
/// XWayland touch-mode writer.
pub fn gamepad_input_restores_touch(name: &str) -> bool {
    !matches!(name, "l2" | "r2" | "l4" | "r4" | "l5" | "r5")
}

fn ass_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
}

fn ir(v: f64) -> i64 {
    v.round() as i64
}

fn ass_rect(x: f64, y: f64, w: f64, h: f64, color: &str, alpha: &str) -> String {
    if w <= 0.0 || h <= 0.0 {
        return String::new();
    }
    let x0 = ir(x);
    let y0 = ir(y);
    let x1 = ir(x + w);
    let y1 = ir(y + h);
    if x1 <= x0 || y1 <= y0 {
        return String::new();
    }
    format!(
        "{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H{color}&\\1a&H{alpha}&\\p1}}m {x0} {y0} l {x1} {y0} l {x1} {y1} l {x0} {y1}{{\\p0}}"
    )
}

fn ass_text(x: f64, y: f64, size: f64, body: &str) -> String {
    format!(
        "{{\\an5\\pos({},{})\\fs{}\\bord2\\shad0\\1c&HFFFFFF&\\3c&H000000&\\1a&H00&\\3a&H40&}}{}",
        ir(x),
        ir(y),
        ir(size),
        ass_escape(body)
    )
}

/// Skip / toast / P2P chrome as ASS events. Empty when every string is empty.
pub fn chrome_ass(
    skip_text: &str,
    notice_text: &str,
    p2p_text: &str,
    width: f64,
    height: f64,
    loading: bool,
) -> String {
    let w = width.max(1.0);
    let h = height.max(1.0);
    let mut lines = Vec::new();

    let notice = notice_text.trim();
    if !notice.is_empty() {
        let tw = (notice.len() as f64 * 14.0 + 48.0).clamp(160.0, w - 32.0);
        let th = 44.0;
        let x = (w - tw) / 2.0;
        let y = 24.0;
        lines.push(ass_rect(x, y, tw, th, "000000", "33"));
        lines.push(ass_text(w / 2.0, y + th / 2.0, 22.0, notice));
    }

    let p2p = p2p_text.trim();
    if !p2p.is_empty() {
        let tw = (p2p.len() as f64 * 13.0 + 48.0).clamp(220.0, w - 32.0);
        let th = 56.0;
        let x = (w - tw) / 2.0;
        let y = if loading { h * 0.5 + 68.0 } else { 24.0 };
        lines.push(ass_rect(x, y, tw, th, "000000", "40"));
        lines.push(ass_text(w / 2.0, y + th / 2.0, 20.0, p2p));
    }

    let skip = skip_text.trim();
    if !skip.is_empty() {
        let tw = (skip.len() as f64 * 16.0 + 56.0).clamp(160.0, 360.0);
        let th = 56.0;
        let x = w - tw - 40.0;
        let y = h - th - 128.0;
        lines.push(ass_rect(x, y, tw, th, "000000", "4D"));
        lines.push(ass_text(x + tw / 2.0, y + th / 2.0, 28.0, skip));
    }

    lines.into_iter().filter(|line| !line.is_empty()).collect::<Vec<_>>().join("\n")
}
