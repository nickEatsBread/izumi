//! Native mpv OSD for fast-moving Game mode player UI.
//!
//! The HTML controls still handle input, but loading and active scrub visuals must not be
//! driven by repeated WebKit snapshots on the Deck. Those states are drawn here as ASS vector
//! events inside mpv's renderer, so gamescope receives one already-composited video surface.

#![cfg(target_os = "linux")]

use std::f64::consts::PI;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use gtk::glib;
use tauri::{AppHandle, Manager};

use crate::{player::PlayerHandle, GmDynamicOverlay};

// Separate osd-overlay ids so the STATIC parts of the scrub bar (dim gradient, empty track,
// buffered range) are pushed ONCE and only the MOVING parts (played fill, knob, time text) are
// re-pushed each frame. Each id is its own libass ASS_Track in mpv (sub/osd_libass.c), so
// re-pushing the dynamic id never re-parses/re-rasters the static gradient — per-frame ASS work
// on the Deck iGPU drops from ~30 vector shapes to ~4. (Re-pushing identical ASS every frame is
// NOT free — mpv#7615 — so the static layer is content-gated and pushed only when it changes.)
const OSD_SCRUB_DYN_ID: i64 = 2; // played fill + knob + time text (per frame while animating)
const OSD_SCRUB_STATIC_ID: i64 = 3; // dim gradient + empty track + buffered range (on change)
const OSD_LOADING_ID: i64 = 4; // pre-first-frame black + buffering spinner (per frame)
const OSD_FPS: u64 = 60;
// Tween time-constants (seconds) for the native scrub bar, chosen per input source. A trigger
// (pad) steps in 5s jumps and is indirect, so a longer tween smooths the steps; a finger is
// direct manipulation and must feel attached, so it gets ~1 frame of catch-up. Tune on-device.
const PAD_SCRUB_TAU: f64 = 0.045;
const TOUCH_SCRUB_TAU: f64 = 0.025;
const SCRUB_EPSILON: f64 = 0.02;
// osd-overlay z (higher = nearer the viewer): gradient/track behind, played/knob above, spinner
// on top. overlay-add bitmaps (the snapshot chrome, id 1) always sit above ALL of these.
const Z_SCRUB_STATIC: i64 = 48;
const Z_SCRUB_DYN: i64 = 50;
const Z_LOADING: i64 = 60;

static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();
static RUNNING: AtomicBool = AtomicBool::new(false);
static GEN: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
struct Runtime {
    state: GmDynamicOverlay,
    version: u64,
}

/// What each osd-overlay id currently holds, so the loop only pushes a layer when its content
/// actually changes and only issues an overlay-remove on a real hide transition (not every idle
/// frame). Owned by the loop closure — one per running loop.
#[derive(Default)]
struct Shown {
    /// Last ASS pushed to the static scrub layer; `None` when the layer is not shown.
    static_ass: Option<String>,
    /// The dynamic scrub layer (played/knob/time) is currently up.
    scrub: bool,
    /// The loading layer (dim/spinner) is currently up.
    loading: bool,
}

pub fn update(app: AppHandle, state: GmDynamicOverlay) {
    let visible = state.visible;
    let runtime = RUNTIME.get_or_init(|| Mutex::new(Runtime::default()));
    if let Ok(mut rt) = runtime.lock() {
        rt.state = sanitize_state(state);
        rt.version = rt.version.wrapping_add(1);
    }

    if !visible {
        GEN.fetch_add(1, Ordering::SeqCst);
        RUNNING.store(false, Ordering::SeqCst);
        remove(&app);
        return;
    }

    start_loop(app);
}

fn start_loop(app: AppHandle) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    let my_gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    glib::MainContext::default().invoke(move || start_loop_on_main(app, my_gen));
}

fn start_loop_on_main(app: AppHandle, my_gen: u64) {
    let t0 = Instant::now();
    let mut last_tick = t0;
    let mut last_drawn_version = u64::MAX;
    let mut shown_scrub_time: Option<f64> = None;
    let mut shown = Shown::default();

    glib::timeout_add_local(Duration::from_millis(1000 / OSD_FPS), move || {
        let now = Instant::now();
        let dt = now.duration_since(last_tick).as_secs_f64().clamp(0.0, 0.1);
        last_tick = now;

        if GEN.load(Ordering::SeqCst) != my_gen {
            RUNNING.store(false, Ordering::SeqCst);
            return glib::ControlFlow::Break;
        }

        let Some((state, version)) = latest_state() else {
            RUNNING.store(false, Ordering::SeqCst);
            return glib::ControlFlow::Break;
        };
        if !state.visible {
            remove(&app);
            RUNNING.store(false, Ordering::SeqCst);
            return glib::ControlFlow::Break;
        }

        let mut draw_state = state.clone();
        let scrub_animating = prepare_scrub_display(&mut draw_state, &mut shown_scrub_time, dt);

        // Loading animates at 60fps inside mpv. Touch scrub redraws only when input changes.
        // Pad-trigger scrub gets a native visual tween between stepped repeat targets.
        if !draw_state.loading
            && (!draw_state.scrubbing || !scrub_animating)
            && version == last_drawn_version
        {
            return glib::ControlFlow::Continue;
        }

        draw(&app, &draw_state, spinner_phase(t0), &mut shown);
        last_drawn_version = version;
        glib::ControlFlow::Continue
    });
}

fn prepare_scrub_display(
    state: &mut GmDynamicOverlay,
    shown_scrub_time: &mut Option<f64>,
    dt: f64,
) -> bool {
    if !state.scrubbing || state.dur <= 0.0 {
        *shown_scrub_time = None;
        return false;
    }

    let target = state.scrub_time.clamp(0.0, state.dur);
    if !state.smooth_scrub {
        *shown_scrub_time = Some(target);
        state.scrub_time = target;
        return false;
    }

    let tau = if state.pad_scrub { PAD_SCRUB_TAU } else { TOUCH_SCRUB_TAU };
    // First frame of the gesture: a trigger scrub begins at the playhead and steps away from it,
    // but a finger lands directly on a point — so touch starts AT the target (no visible slide
    // from the current playback position on the very first touch).
    let current = shown_scrub_time.unwrap_or_else(|| {
        if state.pad_scrub { state.pos.clamp(0.0, state.dur) } else { target }
    });
    let next = smooth_scrub_time(current, target, dt, tau).clamp(0.0, state.dur);
    let animating = (next - target).abs() > SCRUB_EPSILON;
    *shown_scrub_time = Some(next);
    state.scrub_time = next;
    animating
}

fn smooth_scrub_time(current: f64, target: f64, dt: f64, tau: f64) -> f64 {
    let delta = target - current;
    if delta.abs() <= SCRUB_EPSILON {
        return target;
    }

    // Frame-rate-independent exponential approach: alpha = 1 - e^(-dt/tau). Driving it from the
    // OSD loop's real dt (not a fixed per-frame alpha) keeps a given tau's wall-clock smoothing
    // constant even though IPC samples arrive at a jittery 20-40Hz.
    let alpha = if dt <= 0.0 {
        0.0
    } else if tau <= 0.0 {
        1.0
    } else {
        1.0 - (-dt / tau).exp()
    };
    current + delta * alpha.clamp(0.0, 1.0)
}

fn latest_state() -> Option<(GmDynamicOverlay, u64)> {
    let rt = RUNTIME.get_or_init(|| Mutex::new(Runtime::default())).lock().ok()?;
    Some((rt.state.clone(), rt.version))
}

fn sanitize_state(mut state: GmDynamicOverlay) -> GmDynamicOverlay {
    state.width = state.width.clamp(1.0, 7680.0);
    state.height = state.height.clamp(1.0, 4320.0);
    if !state.pos.is_finite() {
        state.pos = 0.0;
    }
    if !state.dur.is_finite() {
        state.dur = 0.0;
    }
    if !state.buffer.is_finite() {
        state.buffer = 0.0;
    }
    if !state.scrub_time.is_finite() {
        state.scrub_time = state.pos;
    }
    state
}

fn draw(app: &AppHandle, state: &GmDynamicOverlay, phase: u32, shown: &mut Shown) {
    let w = state.width.round() as i64;
    let h = state.height.round() as i64;
    let (wf, hf) = (w as f64, h as f64);
    let Some(player) = app.try_state::<PlayerHandle>() else {
        return;
    };

    // --- Scrub bar: static layer (gradient/track/buffer) pushed only when its content changes;
    // dynamic layer (played/knob/time) re-pushed each animating frame.
    if state.scrubbing && state.dur > 0.0 {
        let (bx, by, bw, bh) = scrub_geometry(state, wf, hf);
        let static_ass = scrub_static_ass(state, wf, hf, bx, by, bw, bh);
        if shown.static_ass.as_deref() != Some(static_ass.as_str()) {
            let _ = player.osd_overlay_ass(OSD_SCRUB_STATIC_ID, &static_ass, w, h, Z_SCRUB_STATIC);
            shown.static_ass = Some(static_ass);
        }
        let dyn_ass = scrub_dynamic_ass(state, wf, bx, by, bw, bh);
        let _ = player.osd_overlay_ass(OSD_SCRUB_DYN_ID, &dyn_ass, w, h, Z_SCRUB_DYN);
        shown.scrub = true;
    } else if shown.scrub {
        let _ = player.osd_overlay_remove(OSD_SCRUB_DYN_ID);
        let _ = player.osd_overlay_remove(OSD_SCRUB_STATIC_ID);
        shown.static_ass = None;
        shown.scrub = false;
    }

    // --- Loading: pre-first-frame black backdrop + buffering spinner (animates every frame).
    if state.loading {
        let ass = loading_ass(state, phase, wf, hf);
        if ass.is_empty() {
            if shown.loading {
                let _ = player.osd_overlay_remove(OSD_LOADING_ID);
                shown.loading = false;
            }
        } else {
            let _ = player.osd_overlay_ass(OSD_LOADING_ID, &ass, w, h, Z_LOADING);
            shown.loading = true;
        }
    } else if shown.loading {
        let _ = player.osd_overlay_remove(OSD_LOADING_ID);
        shown.loading = false;
    }
}

fn remove(app: &AppHandle) {
    if let Some(player) = app.try_state::<PlayerHandle>() {
        let _ = player.osd_overlay_remove(OSD_SCRUB_DYN_ID);
        let _ = player.osd_overlay_remove(OSD_SCRUB_STATIC_ID);
        let _ = player.osd_overlay_remove(OSD_LOADING_ID);
    }
}

fn spinner_phase(t0: Instant) -> u32 {
    ((t0.elapsed().as_secs_f64() * OSD_FPS as f64) as u32) % 60
}

/// The scrub bar's on-screen geometry: (x, y-centre, width, height). Prefers the HTML seek bar's
/// rect (sent from the frontend) so the native bar sits exactly on it — dragging feels like
/// dragging the player's own bar, not a separate mini-skimmer. Falls back to a computed layout
/// if absent.
fn scrub_geometry(state: &GmDynamicOverlay, w: f64, h: f64) -> (f64, f64, f64, f64) {
    if state.bar_w > 0.0 {
        (state.bar_x, state.bar_y, state.bar_w, state.bar_h.clamp(6.0, 18.0))
    } else {
        let pad = (w * 0.06).clamp(54.0, 96.0);
        (pad, h - 76.0, (w - pad * 2.0).max(1.0), 8.0)
    }
}

/// STATIC scrub layer: the legibility gradient, the empty track, and the buffered range. None of
/// these move while a finger drags, so the string is byte-stable across a gesture and pushed only
/// once (the loop content-gates it). Byte-stability matters: jittering coordinates would miss
/// libass's bitmap cache and re-tessellate the 24 gradient bands every frame.
fn scrub_static_ass(state: &GmDynamicOverlay, w: f64, h: f64, x: f64, y: f64, bw: f64, bh: f64) -> String {
    let mut lines = Vec::new();

    // Soft bottom gradient for legibility over bright frames (matches the HTML controls'
    // from-black → transparent gradient). Stacked black bands with an eased alpha, each BLURRED so
    // the per-band alpha steps blend into a continuous fade — plain \p1 rects show their alpha
    // steps as hard horizontal LINES on the Deck panel (the reported "weird black lines"). This is
    // the push-once static layer, so the blur is paid once per scrub, never per frame. ASS alpha:
    // 00 = opaque, FF = transparent.
    let grad_top = (y - h * 0.18).max(0.0);
    let span = (h - grad_top).max(1.0);
    let bands = 20usize;
    let band_h = span / bands as f64;
    for i in 0..bands {
        let f = (i as f64 + 0.5) / bands as f64; // 0 (top) → 1 (bottom)
        let opacity = 0.72 * f * f; // eased: barely-there at the top, ~0.72 at the bottom
        let a = ((1.0 - opacity) * 255.0).round().clamp(0.0, 255.0) as i64;
        let by = grad_top + span * (i as f64 / bands as f64);
        // Blur ≈ band height so adjacent bands overlap-blend into a smooth ramp (kills the steps).
        push(&mut lines, rect_blur(0.0, by, w, band_h + 2.0, "000000", &format!("{a:02X}"), band_h));
    }

    let top = y - bh / 2.0;
    // Track (white/25) · buffered (white/40) — the same fills the HTML seek bar uses.
    push(&mut lines, rect(x, top, bw, bh, "FFFFFF", "BF"));
    let buffer_pct = pct(state.buffer, state.dur);
    if buffer_pct > 0.0 {
        push(&mut lines, rect(x, top, bw * buffer_pct, bh, "FFFFFF", "99"));
    }
    lines.join("\n")
}

/// DYNAMIC scrub layer: the played fill up to the (tweened) scrub point, the knob, and the
/// scrubbed time floating above it. Re-pushed each animating frame; its own libass track, so it
/// never re-parses the static gradient above it.
fn scrub_dynamic_ass(state: &GmDynamicOverlay, w: f64, x: f64, y: f64, bw: f64, bh: f64) -> String {
    let mut lines = Vec::new();
    let top = y - bh / 2.0;
    let scrub_pct = pct(state.scrub_time, state.dur);

    // Played to the scrub point (opaque).
    push(&mut lines, rect(x, top, bw * scrub_pct, bh, "FFFFFF", "00"));
    // Handle (matches the HTML ~22px knob) + the scrubbed time floating just above it.
    let knob_x = x + bw * scrub_pct;
    push(&mut lines, circle(knob_x, y, 11.0, "FFFFFF", "00"));
    let time = fmt_time(state.scrub_time);
    push(&mut lines, text(knob_x.clamp(60.0, w - 60.0), y - 42.0, 32.0, &time));
    lines.join("\n")
}

/// LOADING layer: an opaque black backdrop before the first frame (covers the white webview and
/// the transparent hole) plus the buffering spinner. Animates every frame (the spinner sweeps),
/// so it's always re-pushed while loading.
fn loading_ass(state: &GmDynamicOverlay, phase: u32, w: f64, h: f64) -> String {
    let mut lines = Vec::new();
    if state.loading && !state.first_frame {
        push(&mut lines, rect(0.0, 0.0, w, h, "000000", "00"));
    }
    if state.loading {
        loading_overlay(phase, w, h, &mut lines);
    }
    lines.join("\n")
}

fn loading_overlay(phase: u32, w: f64, h: f64, lines: &mut Vec<String>) {
    let cx = w / 2.0;
    let cy = h / 2.0;
    let segments = 24usize;
    let head = ((phase % 60) as f64 / 60.0) * PI * 2.0 - PI / 2.0;
    let alphas = ["00", "0C", "1A", "2A", "40", "58", "74", "92", "B0", "C8", "D8"];

    for i in 0..segments {
        let theta = (i as f64 / segments as f64) * PI * 2.0 - PI / 2.0;
        let delta = (head - theta).rem_euclid(PI * 2.0);
        let age = ((delta / (PI * 2.0)) * segments as f64).round() as usize;
        let alpha = alphas[age.min(alphas.len() - 1)];
        let half = PI / segments as f64 * 0.34;
        push(lines, ring_segment(cx, cy, 24.0, 31.0, theta - half, theta + half, "FFFFFF", alpha));
    }
}

fn push(lines: &mut Vec<String>, line: String) {
    if !line.is_empty() {
        lines.push(line);
    }
}

fn pct(value: f64, duration: f64) -> f64 {
    if duration <= 0.0 || !duration.is_finite() || !value.is_finite() {
        return 0.0;
    }
    (value / duration).clamp(0.0, 1.0)
}

fn fmt_time(seconds: f64) -> String {
    let seconds = if seconds.is_finite() { seconds.max(0.0) } else { 0.0 };
    let total = seconds.floor() as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

fn text(x: f64, y: f64, size: f64, body: &str) -> String {
    format!(
        "{{\\an5\\pos({},{})\\fs{}\\bord2\\shad0\\1c&HFFFFFF&\\3c&H000000&\\1a&H00&\\3a&H40&}}{}",
        ir(x),
        ir(y),
        ir(size),
        ass_escape(body)
    )
}

fn rect(x: f64, y: f64, w: f64, h: f64, color: &str, alpha: &str) -> String {
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
        "{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H{}&\\1a&H{}&\\p1}}m {} {} l {} {} l {} {} l {} {}{{\\p0}}",
        color, alpha, x0, y0, x1, y0, x1, y1, x0, y1
    )
}

/// A filled rect with a Gaussian `\blur` (soft edges). Used for the legibility gradient bands so
/// their alpha steps blend instead of showing as hard horizontal lines. `blur` is the ASS blur
/// strength (~pixels).
fn rect_blur(x: f64, y: f64, w: f64, h: f64, color: &str, alpha: &str, blur: f64) -> String {
    if w <= 0.0 || h <= 0.0 || blur <= 0.0 {
        return rect(x, y, w, h, color, alpha);
    }
    let x0 = ir(x);
    let y0 = ir(y);
    let x1 = ir(x + w);
    let y1 = ir(y + h);
    if x1 <= x0 || y1 <= y0 {
        return String::new();
    }
    format!(
        "{{\\an7\\pos(0,0)\\bord0\\shad0\\blur{}\\1c&H{}&\\1a&H{}&\\p1}}m {} {} l {} {} l {} {} l {} {}{{\\p0}}",
        ir(blur).max(1),
        color,
        alpha,
        x0, y0, x1, y0, x1, y1, x0, y1
    )
}

fn circle(cx: f64, cy: f64, r: f64, color: &str, alpha: &str) -> String {
    if r <= 0.0 {
        return String::new();
    }

    let k = r * 0.552_284_749_8;
    let cx = ir(cx);
    let cy = ir(cy);
    let r = ir(r) as i64;
    let k = ir(k) as i64;

    format!(
        "{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H{}&\\1a&H{}&\\p1}}m {} {} b {} {} {} {} {} {} b {} {} {} {} {} {} b {} {} {} {} {} {} b {} {} {} {} {} {}{{\\p0}}",
        color,
        alpha,
        cx,
        cy - r,
        cx + k,
        cy - r,
        cx + r,
        cy - k,
        cx + r,
        cy,
        cx + r,
        cy + k,
        cx + k,
        cy + r,
        cx,
        cy + r,
        cx - k,
        cy + r,
        cx - r,
        cy + k,
        cx - r,
        cy,
        cx - r,
        cy - k,
        cx - k,
        cy - r,
        cx,
        cy - r
    )
}

fn ring_segment(cx: f64, cy: f64, inner: f64, outer: f64, a0: f64, a1: f64, color: &str, alpha: &str) -> String {
    if inner <= 0.0 || outer <= inner {
        return String::new();
    }

    let p = |r: f64, a: f64| (ir(cx + a.cos() * r), ir(cy + a.sin() * r));
    let (x0, y0) = p(outer, a0);
    let (x1, y1) = p(outer, a1);
    let (x2, y2) = p(inner, a1);
    let (x3, y3) = p(inner, a0);

    format!(
        "{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H{}&\\1a&H{}&\\p1}}m {} {} l {} {} l {} {} l {} {}{{\\p0}}",
        color, alpha, x0, y0, x1, y1, x2, y2, x3, y3
    )
}

fn ass_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('{', "\\{").replace('}', "\\}")
}

fn ir(v: f64) -> i64 {
    v.round() as i64
}
