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

const OSD_ID: i64 = 2;
const OSD_FPS: u64 = 60;
const PAD_SCRUB_TAU: f64 = 0.045;
const SCRUB_EPSILON: f64 = 0.02;

static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();
static RUNNING: AtomicBool = AtomicBool::new(false);
static GEN: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
struct Runtime {
    state: GmDynamicOverlay,
    version: u64,
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

        draw(&app, &draw_state, spinner_phase(t0));
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

    let current = shown_scrub_time
        .unwrap_or_else(|| state.pos.clamp(0.0, state.dur));
    let next = smooth_scrub_time(current, target, dt).clamp(0.0, state.dur);
    let animating = (next - target).abs() > SCRUB_EPSILON;
    *shown_scrub_time = Some(next);
    state.scrub_time = next;
    animating
}

fn smooth_scrub_time(current: f64, target: f64, dt: f64) -> f64 {
    let delta = target - current;
    if delta.abs() <= SCRUB_EPSILON {
        return target;
    }

    let alpha = if dt <= 0.0 {
        0.0
    } else {
        1.0 - (-dt / PAD_SCRUB_TAU).exp()
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

fn draw(app: &AppHandle, state: &GmDynamicOverlay, phase: u32) {
    let w = state.width.round() as i64;
    let h = state.height.round() as i64;
    let ass = build_ass(state, w as f64, h as f64, phase);
    let Some(player) = app.try_state::<PlayerHandle>() else {
        return;
    };

    if ass.is_empty() {
        let _ = player.osd_overlay_remove(OSD_ID);
    } else {
        let _ = player.osd_overlay_ass(OSD_ID, &ass, w, h, 50);
    }
}

fn remove(app: &AppHandle) {
    if let Some(player) = app.try_state::<PlayerHandle>() {
        let _ = player.osd_overlay_remove(OSD_ID);
    }
}

fn spinner_phase(t0: Instant) -> u32 {
    ((t0.elapsed().as_secs_f64() * OSD_FPS as f64) as u32) % 60
}

fn build_ass(state: &GmDynamicOverlay, w: f64, h: f64, phase: u32) -> String {
    let mut lines = Vec::new();

    if state.loading && !state.first_frame {
        push(&mut lines, rect(0.0, 0.0, w, h, "000000", "00"));
    }

    if state.scrubbing && state.dur > 0.0 {
        scrub_overlay(state, w, h, &mut lines);
    }

    if state.loading {
        loading_overlay(phase, w, h, &mut lines);
    }

    lines.join("\n")
}

fn scrub_overlay(state: &GmDynamicOverlay, w: f64, h: f64, lines: &mut Vec<String>) {
    let band_h = 150.0_f64.min(h * 0.28).max(110.0);
    let band_y = (h - band_h).max(0.0);
    push(lines, rect(0.0, band_y, w, band_h, "000000", "70"));

    let pad = (w * 0.06).clamp(54.0, 96.0);
    let x = pad;
    let y = h - 76.0;
    let bw = (w - pad * 2.0).max(1.0);
    let bh = 7.0;

    let pos_pct = pct(state.pos, state.dur);
    let buffer_pct = pct(state.buffer, state.dur);
    let scrub_pct = pct(state.scrub_time, state.dur);

    push(lines, rect(x, y - bh / 2.0, bw, bh, "FFFFFF", "CA"));
    if buffer_pct > 0.0 {
        push(lines, rect(x, y - bh / 2.0, bw * buffer_pct, bh, "FFFFFF", "A8"));
    }
    if pos_pct > 0.0 {
        push(lines, rect(x, y - bh / 2.0, bw * pos_pct, bh, "FFFFFF", "28"));
    }
    push(lines, rect(x, y - bh / 2.0, bw * scrub_pct, bh, "FFFFFF", "58"));

    let knob_x = x + bw * scrub_pct;
    push(lines, circle(knob_x, y, 9.5, "FFFFFF", "00"));

    let time = format!("{} / {}", fmt_time(state.scrub_time), fmt_time(state.dur));
    push(lines, text(w / 2.0, y - 36.0, 30.0, &time));
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
