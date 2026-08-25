//! Pure Game-mode performance helpers.
//!
//! Kept free of GTK/libmpv so Windows CI can test the policy without `mpv.lib`.
//! Shared by the Linux overlay/OSD paths and the torrent engine (including Android).

#![allow(dead_code)]

use std::num::NonZeroU32;

/// Native ASS overlay cadence. The Deck's touch skim has to track the finger; 30fps
/// made the native bar feel sticky. Loading spinner phase also uses this clock.
pub const OSD_FPS: u64 = 60;
/// Snapshot the HTML chrome only when it changes (show/hide or a menu). Idle 12fps rasters
/// were the dominant Game-mode cost while the control bar sat still.
pub const OVERLAY_IDLE_FPS: u64 = 0;
/// Menu highlight / d-pad navigation still needs a high snapshot cadence.
pub const OVERLAY_SCRUB_FPS: u64 = 30;
/// Native fade of an already-snapshotted overlay. Each short animation tick reissues
/// `overlay-add` because mpv copies BGRA input when the command runs; WebKit is not rastered
/// again. Kept short enough to feel like Leanback chrome rather than a modal transition.
// Timer cadence quantises the visible duration upward by roughly one frame. 150 ms keeps the
// motion in the snappier Leanback/VacuumTube range rather than the old ~195 ms.
pub const OVERLAY_FADE_MS: u64 = 150;
/// Re-uploading a premultiplied control bitmap can take 8–18ms on Deck. Driving that work every
/// 16ms monopolises mpv's render thread and makes the playing video hitch during the outro. Six
/// evenly-spaced frames retain the short Leanback-style motion while leaving a decode/present gap.
pub const OVERLAY_FADE_FRAME_MS: u64 = 25;
/// Upward travel paired with the control fade, matching the old CSS Leanback motion.
pub const OVERLAY_MOTION_PX: i64 = 16;
/// Right-hand settings sheets only need a short travel cue; the small distance reads as motion
/// without making the panel feel as though it is waiting off-screen.
pub const OVERLAY_SHEET_MOTION_PX: i64 = 40;
/// Premultiply scale uses 0..=1000 so a fade tick can be integer math.
pub const OVERLAY_FADE_FULL: u32 = 1000;
/// The source Leanback CSS declares a long parent opacity transition, but on the native mpv path
/// that duration reads as input latency. A 160ms display-cadence reveal preserves its ease while
/// matching the immediate feel of VacuumTube on Deck hardware.
pub const NATIVE_CONTROLS_FADE_MS: u64 = 160;
/// Content settles just ahead of the wash so buttons feel attached to the input edge.
pub const NATIVE_CONTROLS_CONTENT_MS: u64 = 120;
/// Short travel avoids the slow "rising tray" effect of the former 30px motion.
pub const NATIVE_CONTROLS_MOTION_PX: f64 = 18.0;
/// Bottom fraction of the viewport that holds the control strip (idle snapshots only).
/// 0.28 sliced the Game-mode title/episode line (64px play + seek + two text rows).
pub const CONTROL_STRIP_FRACTION: f64 = 0.36;
/// Ignore Gamescope touch-restore wakes closer together than this.
pub const TOUCH_RESTORE_MIN_INTERVAL_MS: u64 = 400;
/// After the first frame, cap torrent download so piece hashing/IO does not fight the GPU.
pub const POST_START_DOWNLOAD_BPS: u32 = 4 * 1024 * 1024;

/// Game mode keeps WebKit's GPU compositor. Ghost trails are handled by turning off WebKitGTK
/// 2.50 damage propagation, not by forcing the software rasterizer (which aliases curves).
pub fn game_mode_uses_hardware_webkit() -> bool {
    true
}

/// Native Gamescope Wayland can import the Deck's VAAPI surfaces directly into libmpv's EGL
/// renderer. mpv's `auto` policy already orders whitelisted direct methods before their copy
/// variants and retains software fallback; appending `auto-copy` is redundant. Desktop Wayland
/// keeps the conservative copy path because its wider driver matrix is not Deck-qualified.
pub fn libmpv_hwdec(game_mode_wayland: bool) -> &'static str {
    if game_mode_wayland {
        "auto"
    } else {
        "auto-copy"
    }
}

/// Whether this overlay tick should take a WebKit snapshot.
pub fn overlay_should_snapshot(fast: bool, force: bool, busy: bool) -> bool {
    if busy {
        return false;
    }
    fast || force
}

/// Advance a 0..=1000 overlay alpha. `fade_in` climbs toward full; otherwise it falls to 0.
pub fn overlay_fade_step(current: u32, fade_in: bool, dt_ms: u64, duration_ms: u64) -> u32 {
    let duration_ms = duration_ms.max(1);
    let delta = ((dt_ms.saturating_mul(OVERLAY_FADE_FULL as u64)) / duration_ms) as u32;
    if fade_in {
        current.saturating_add(delta).min(OVERLAY_FADE_FULL)
    } else {
        current.saturating_sub(delta)
    }
}

/// CSS `ease` (`cubic-bezier(.25,.1,.25,1)`) evaluated by time rather than Bézier parameter.
/// The native OSD uses the browser's actual curve so its 60Hz motion matches VacuumTube.
pub fn css_ease(progress: f64) -> f64 {
    let x = progress.clamp(0.0, 1.0);
    if x <= 0.0 || x >= 1.0 {
        return x;
    }

    fn sample(t: f64, p1: f64, p2: f64) -> f64 {
        let inv = 1.0 - t;
        3.0 * inv * inv * t * p1 + 3.0 * inv * t * t * p2 + t * t * t
    }
    fn slope(t: f64, p1: f64, p2: f64) -> f64 {
        3.0 * (1.0 - t).powi(2) * p1 + 6.0 * (1.0 - t) * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2)
    }

    let mut t = x;
    for _ in 0..6 {
        let dx = sample(t, 0.25, 0.25) - x;
        let d = slope(t, 0.25, 0.25);
        if d.abs() < 1e-7 {
            break;
        }
        t = (t - dx / d).clamp(0.0, 1.0);
    }
    sample(t, 0.1, 1.0).clamp(0.0, 1.0)
}

/// Scale premultiplied BGRA by `alpha_millis` (0..=1000) into `dst`.
pub fn scale_premult_bgra(src: &[u8], dst: &mut [u8], alpha_millis: u32) {
    let n = src.len().min(dst.len());
    if alpha_millis == 0 {
        dst[..n].fill(0);
        return;
    }
    if alpha_millis >= OVERLAY_FADE_FULL {
        dst[..n].copy_from_slice(&src[..n]);
        return;
    }
    for i in 0..n {
        dst[i] = ((src[i] as u32 * alpha_millis) / OVERLAY_FADE_FULL) as u8;
    }
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
pub fn control_strip_crop(width: i64, height: i64, fast: bool) -> Option<(i64, i64, i64, i64)> {
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

/// Per-torrent peer ceiling. `None` uses librqbit's default (128). Game mode used to
/// cut this to 48; that is not needed once download is capped after the first healthy
/// frame, and it can starve a thin swarm of the peers that actually have the first pieces.
pub fn torrent_peer_limit(_game_mode: bool) -> Option<usize> {
    None
}

/// librqbit blocking-pool size. `None` uses the library default of 8.
///
/// Game mode used to pass 2. That deadlocked click-to-first-frame: mpv opens overlapping
/// range readers (start + Cues), each `spawn_blocking` wait-for-piece occupies a slot,
/// and with only two slots the incoming-piece hash/write work never runs. The HTTP
/// connections then sit in CLOSE-WAIT under an ASS loading spinner forever.
pub fn torrent_runtime_threads(_game_mode: bool) -> Option<usize> {
    None
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

/// A normal touch release keeps a short grace deadline so a transient Gamescope focus-return
/// cannot inject XTest events into WebKit's still-settling kinetic scroll. A genuinely lost
/// release is recovered by the webview watchdog after its own quiet-window check.
pub fn touch_focus_recovery_allowed(hold_until_ms: u64, now_ms: u64) -> bool {
    now_ms >= hold_until_ms
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

/// Skip / toast chrome as ASS events. P2P is always the proper HTML status card.
pub fn chrome_ass(skip_text: &str, notice_text: &str, width: f64, height: f64) -> String {
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

    let skip = skip_text.trim();
    if !skip.is_empty() {
        let tw = (skip.len() as f64 * 16.0 + 56.0).clamp(160.0, 360.0);
        let th = 56.0;
        let x = w - tw - 40.0;
        let y = h - th - 128.0;
        lines.push(ass_rect(x, y, tw, th, "000000", "4D"));
        lines.push(ass_text(x + tw / 2.0, y + th / 2.0, 28.0, skip));
    }

    lines
        .into_iter()
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
