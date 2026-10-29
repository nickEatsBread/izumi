//! Native mpv OSD for fast-moving Game mode player UI.
//!
//! The HTML controls still handle input, but normal chrome, loading, live progress and active
//! scrub visuals must not be driven by repeated WebKit snapshots on the Deck. Those states are
//! drawn here as ASS vectors inside mpv, so gamescope receives one composited video surface.

#![cfg(target_os = "linux")]

use std::f64::consts::PI;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use gtk::glib;
use tauri::{AppHandle, Manager};

use crate::gm_perf::{
    chrome_ass, css_ease, quantize_animation_unit, NATIVE_CONTROLS_FADE_MS,
    NATIVE_CONTROLS_MOTION_PX, NATIVE_SEEKBAR_ACTIVE_PX, NATIVE_SEEKBAR_IDLE_PX,
    NATIVE_SEEKBAR_TWEEN_MS, OSD_FPS,
};
use crate::{player::PlayerHandle, GmControlItem, GmDynamicOverlay};

// Separate osd-overlay ids so the STATIC parts of the scrub bar (empty track and buffered range)
// are pushed ONCE and only the MOVING parts (played fill, knob, time text) are
// re-pushed each frame. Each id is its own libass ASS_Track in mpv (sub/osd_libass.c), so
// re-pushing the dynamic id never re-parses/re-rasters the static gradient — per-frame ASS work
// on the Deck iGPU drops from ~30 vector shapes to ~4. (Re-pushing identical ASS every frame is
// NOT free — mpv#7615 — so the static layer is content-gated and pushed only when it changes.)
const OSD_SCRUB_DYN_ID: i64 = 2; // played fill + knob + time text (per frame while animating)
const OSD_SCRUB_STATIC_ID: i64 = 3; // empty track + buffered range (on change)
const OSD_LOADING_ID: i64 = 4; // pre-first-frame black + buffering spinner (per frame)
const OSD_CHROME_ID: i64 = 5; // skip / P2P / toast (on change)
const OSD_CONTROLS_BG_ID: i64 = 6; // native bottom wash (60Hz only during reveal/hide)
const OSD_CONTROLS_CONTENT_ID: i64 = 7; // title + buttons/focus (60Hz during reveal/hide)
const OSD_TIMELINE_MARKS_ID: i64 = 8; // OP/ED/recap + chapter cuts (content-gated)
static LITE: AtomicBool = AtomicBool::new(false);
/// Normal playback progress needs to feel live, but a few vector shapes do not need a 60fps ASS
/// reparse. Ten updates per second is smooth at seekbar scale and keeps ample video-render headroom.
const PROGRESS_FRAME_MS: u64 = 100;
/// Same length as the HTML play/pause crossfade.
const PLAY_FADE_MS: f64 = 150.0;
// osd-overlay z (higher = nearer the viewer): gradient/track behind, played/knob above, spinner
// next, then skip/toasts. The P2P status is the HTML bitmap card, never an ASS fallback.
// overlay-add bitmaps (the snapshot chrome, id 1) always sit above ALL of these.
const Z_SCRUB_STATIC: i64 = 48;
const Z_SCRUB_DYN: i64 = 50;
const Z_TIMELINE_MARKS: i64 = 51;
const Z_CONTROLS_BG: i64 = 46;
const Z_CONTROLS_CONTENT: i64 = 55;
const Z_LOADING: i64 = 60;
const Z_CHROME: i64 = 70;

static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();
static RUNNING: AtomicBool = AtomicBool::new(false);
static GEN: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
struct Runtime {
    /// Shared with the 60 Hz loop by reference count: an idle tick reads it without cloning the
    /// title, control items, timeline segments and chapter marks.
    state: Arc<GmDynamicOverlay>,
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
    /// Last timeline annotations pushed above the played fill; unchanged during a scrub gesture.
    marks_ass: Option<String>,
    /// The loading layer (dim/spinner) is currently up.
    loading: bool,
    /// Last skip/toast ASS; `None` when that layer is not shown.
    chrome: Option<String>,
    control_bg: Option<String>,
    control_content: Option<String>,
}

#[derive(Clone, Copy, Default)]
struct ControlMotion {
    main: f64,
    content: f64,
    y: f64,
    animating: bool,
}

struct ControlTween {
    target: bool,
    opacity: f64,
    start_opacity: f64,
    started: Instant,
}

impl ControlTween {
    fn new(now: Instant) -> Self {
        Self {
            target: false,
            opacity: 0.0,
            start_opacity: 0.0,
            started: now,
        }
    }

    fn step(&mut self, target: bool, animate: bool, now: Instant) -> ControlMotion {
        if target != self.target {
            self.target = target;
            self.start_opacity = self.opacity;
            self.started = now;
        }
        let end = if target { 1.0 } else { 0.0 };
        if !animate {
            self.opacity = end;
        } else {
            let elapsed = now.duration_since(self.started).as_secs_f64() * 1000.0;
            let t = (elapsed / NATIVE_CONTROLS_FADE_MS as f64).clamp(0.0, 1.0);
            self.opacity = self.start_opacity + (end - self.start_opacity) * css_ease(t);
        }
        let opacity = self.opacity.clamp(0.0, 1.0);
        // Keep the easing and full 300ms duration, but feed libass deterministic frame values.
        // Timer-jitter-derived alpha strings made its blurred-bitmap cache grow on every reveal.
        let rendered_opacity = quantize_animation_unit(opacity);
        let animating = (self.opacity - end).abs() > 0.0005;
        ControlMotion {
            // CrunchyDeck fades the full chrome under one parent opacity. Keep every native layer
            // on that same interrupted tween so the title cannot trail the bar or button row.
            main: rendered_opacity,
            content: rendered_opacity,
            y: (1.0 - rendered_opacity) * NATIVE_CONTROLS_MOTION_PX,
            animating,
        }
    }
}

struct SeekbarTween {
    active: bool,
    height: f64,
    start_height: f64,
    started: Instant,
}

impl SeekbarTween {
    fn new(now: Instant) -> Self {
        Self {
            active: false,
            height: NATIVE_SEEKBAR_IDLE_PX,
            start_height: NATIVE_SEEKBAR_IDLE_PX,
            started: now,
        }
    }

    fn step(&mut self, active: bool, now: Instant) -> (f64, bool) {
        if active != self.active {
            self.active = active;
            self.start_height = self.height;
            self.started = now;
        }
        let end = if active {
            NATIVE_SEEKBAR_ACTIVE_PX
        } else {
            NATIVE_SEEKBAR_IDLE_PX
        };
        let elapsed = now.duration_since(self.started).as_secs_f64() * 1000.0;
        let t = (elapsed / NATIVE_SEEKBAR_TWEEN_MS.max(1) as f64).clamp(0.0, 1.0);
        self.height = self.start_height + (end - self.start_height) * css_ease(t);
        let span = NATIVE_SEEKBAR_ACTIVE_PX - NATIVE_SEEKBAR_IDLE_PX;
        let unit = (self.height - NATIVE_SEEKBAR_IDLE_PX) / span;
        let rendered = NATIVE_SEEKBAR_IDLE_PX + span * quantize_animation_unit(unit);
        (rendered, (self.height - end).abs() > 0.01)
    }
}

/// Play/pause crossfade weight: 1 = play glyph, 0 = pause glyph. Keyed off the measured button
/// label, so it flips exactly when the HTML control does (PlayPauseIcon.svelte).
struct PlayFade {
    target: Option<f64>,
    value: f64,
    start: f64,
    started: Instant,
}

impl PlayFade {
    fn new(now: Instant) -> Self {
        Self {
            target: None,
            value: 1.0,
            start: 1.0,
            started: now,
        }
    }

    fn step(&mut self, items: &[GmControlItem], animate: bool, now: Instant) -> (f64, bool) {
        let shown = items
            .iter()
            .find_map(|item| match item.label.to_ascii_lowercase().as_str() {
                "play" => Some(1.0),
                "pause" => Some(0.0),
                _ => None,
            });
        if let Some(end) = shown {
            if self.target != Some(end) {
                // The first sighting snaps; only a real toggle fades.
                self.start = if animate && self.target.is_some() {
                    self.value
                } else {
                    end
                };
                self.target = Some(end);
                self.started = now;
            }
        }
        let end = self.target.unwrap_or(1.0);
        let elapsed = now.duration_since(self.started).as_secs_f64() * 1000.0;
        let t = (elapsed / PLAY_FADE_MS).clamp(0.0, 1.0);
        // Sine-out tracks the HTML control's CSS ease-out within 0.025.
        self.value = self.start + (end - self.start) * (t * PI / 2.0).sin();
        (
            quantize_animation_unit(self.value),
            (self.value - end).abs() > 0.0005,
        )
    }
}

pub fn update(app: AppHandle, state: GmDynamicOverlay) {
    let visible = state.visible;
    let runtime = RUNTIME.get_or_init(|| Mutex::new(Runtime::default()));
    if let Ok(mut rt) = runtime.lock() {
        rt.state = Arc::new(sanitize_state(state));
        rt.version = rt.version.wrapping_add(1);
    }

    if !visible && !RUNNING.load(Ordering::SeqCst) {
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
    let mut last_drawn_version = u64::MAX;
    let mut shown_scrub_time: Option<f64> = None;
    let mut progress_anchor_pos = 0.0;
    let mut progress_anchor_at = t0;
    let mut last_progress_draw = t0
        .checked_sub(Duration::from_millis(PROGRESS_FRAME_MS))
        .unwrap_or(t0);
    let mut shown = Shown::default();
    let mut control_tween = ControlTween::new(t0);
    let mut seekbar_tween = SeekbarTween::new(t0);
    let mut play_fade = PlayFade::new(t0);
    let mut last_control_state: Option<Arc<GmDynamicOverlay>> = None;

    glib::timeout_add_local(Duration::from_millis(1000 / OSD_FPS), move || {
        let now = Instant::now();
        if GEN.load(Ordering::SeqCst) != my_gen {
            RUNNING.store(false, Ordering::SeqCst);
            return glib::ControlFlow::Break;
        }

        let Some((state, version)) = latest_state() else {
            RUNNING.store(false, Ordering::SeqCst);
            return glib::ControlFlow::Break;
        };
        if state.controls {
            last_control_state = Some(Arc::clone(&state));
        }
        let motion = control_tween.step(state.controls, state.animate_controls, now);

        // The frontend unmounts Controls as soon as auto-hide fires. Retain the last measured
        // geometry/content until the short native outro reaches zero instead of snapping away.
        let retained = match &last_control_state {
            Some(last) if !state.controls && motion.main > 0.0 => Some(Arc::clone(last)),
            _ => None,
        };
        let chrome: &GmDynamicOverlay = retained.as_deref().unwrap_or(&state);
        let controls = state.controls || retained.is_some();
        let (bar_height, bar_animating) = seekbar_tween.step(state.scrubbing, now);
        let (play, play_animating) =
            play_fade.step(&chrome.control_items, state.animate_controls, now);
        if !state.visible && motion.main <= 0.0 && !motion.animating {
            remove(&app);
            RUNNING.store(false, Ordering::SeqCst);
            return glib::ControlFlow::Break;
        }
        if version != last_drawn_version && (state.controls || state.scrubbing || state.loading) {
            progress_anchor_pos = state.pos;
            progress_anchor_at = now;
        }

        hold_lite(&app, state.scrubbing || state.loading);

        // Loading animates at OSD_FPS inside mpv. Touch scrub redraws only when input changes.
        // Ordinary playback extrapolates between frontend samples and redraws at a lightweight
        // 10fps. Everything above is decided on the shared snapshot, so an idle tick returns here
        // without cloning any overlay state.
        let progress_due = controls
            && (version != last_drawn_version
                || (!chrome.paused
                    && now.duration_since(last_progress_draw)
                        >= Duration::from_millis(PROGRESS_FRAME_MS)));
        // The rating card fades on its own clock, so it redraws every tick while it shows.
        if !state.loading
            && !progress_due
            && !motion.animating
            && !bar_animating
            && !play_animating
            && !rating_active(&state, unix_ms())
            && version == last_drawn_version
        {
            return glib::ControlFlow::Continue;
        }

        let mut draw_state = (*state).clone();
        if let Some(last) = &retained {
            draw_state.controls = true;
            draw_state.paused = last.paused;
            draw_state.pos = last.pos;
            draw_state.dur = last.dur;
            draw_state.buffer = last.buffer;
            draw_state.width = last.width;
            draw_state.height = last.height;
            draw_state.bar_x = last.bar_x;
            draw_state.bar_y = last.bar_y;
            draw_state.bar_w = last.bar_w;
            draw_state.bar_h = last.bar_h;
            draw_state.title.clone_from(&last.title);
            draw_state.title_x = last.title_x;
            draw_state.title_y = last.title_y;
            draw_state.title_size = last.title_size;
            draw_state.title_weight = last.title_weight;
            draw_state.episode_text.clone_from(&last.episode_text);
            draw_state.episode_x = last.episode_x;
            draw_state.episode_y = last.episode_y;
            draw_state.episode_size = last.episode_size;
            draw_state.episode_weight = last.episode_weight;
            draw_state.control_items.clone_from(&last.control_items);
            draw_state
                .timeline_segments
                .clone_from(&last.timeline_segments);
            draw_state.chapter_marks.clone_from(&last.chapter_marks);
        }
        draw_state.bar_h = bar_height;
        prepare_scrub_display(&mut draw_state, &mut shown_scrub_time);
        if draw_state.controls && !draw_state.paused && !draw_state.scrubbing && !draw_state.loading
        {
            draw_state.pos = (progress_anchor_pos
                + now.duration_since(progress_anchor_at).as_secs_f64())
            .clamp(0.0, draw_state.dur.max(0.0));
        }

        draw(
            &app,
            &draw_state,
            spinner_phase(),
            motion,
            play,
            &mut shown,
        );
        if draw_state.controls {
            last_progress_draw = now;
        }
        last_drawn_version = version;
        glib::ControlFlow::Continue
    });
}

fn prepare_scrub_display(state: &mut GmDynamicOverlay, shown_scrub_time: &mut Option<f64>) -> bool {
    if !state.scrubbing || state.dur <= 0.0 {
        *shown_scrub_time = None;
        return false;
    }

    let target = state.scrub_time.clamp(0.0, state.dur);
    // Direct manipulation must remain attached to the newest input sample. The previous
    // exponential catch-up deliberately trailed pad targets by ~55ms and touch by ~12ms; combined
    // with IPC/frame pacing that became visible latency at press, drag, and release.
    *shown_scrub_time = Some(target);
    state.scrub_time = target;
    false
}

fn latest_state() -> Option<(Arc<GmDynamicOverlay>, u64)> {
    let rt = RUNTIME
        .get_or_init(|| Mutex::new(Runtime::default()))
        .lock()
        .ok()?;
    Some((Arc::clone(&rt.state), rt.version))
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
    state.title = state.title.chars().take(180).collect();
    state.episode_text = state.episode_text.chars().take(80).collect();
    state.title_size = if state.title_size.is_finite() && state.title_size > 0.0 {
        state.title_size.clamp(10.0, 96.0)
    } else {
        30.0
    };
    state.episode_size = if state.episode_size.is_finite() && state.episode_size > 0.0 {
        state.episode_size.clamp(8.0, 72.0)
    } else {
        18.0
    };
    state.title_weight = if state.title_weight == 0 {
        900
    } else {
        state.title_weight.clamp(100, 900)
    };
    state.episode_weight = if state.episode_weight == 0 {
        600
    } else {
        state.episode_weight.clamp(100, 900)
    };
    for value in [
        &mut state.title_x,
        &mut state.title_y,
        &mut state.episode_x,
        &mut state.episode_y,
    ] {
        if !value.is_finite() {
            *value = 0.0;
        }
    }
    state.control_items.truncate(24);
    state.control_items.retain(|item| {
        item.x.is_finite()
            && item.y.is_finite()
            && item.w.is_finite()
            && item.h.is_finite()
            && item.w > 0.0
            && item.h > 0.0
    });
    for item in &mut state.control_items {
        item.x = item.x.clamp(-256.0, state.width + 256.0);
        item.y = item.y.clamp(-256.0, state.height + 256.0);
        item.w = item.w.clamp(1.0, 256.0);
        item.h = item.h.clamp(1.0, 256.0);
        item.label = item.label.chars().take(80).collect();
        item.text = item.text.chars().take(24).collect();
        item.text_size = if item.text_size.is_finite() { item.text_size.clamp(0.0, 64.0) } else { 0.0 };
        item.text_weight = item.text_weight.min(1000);
    }
    state.rating_label = state.rating_label.trim().chars().take(12).collect();
    state.rating_detail = state.rating_detail.trim().chars().take(80).collect();
    if !state.rating_shown_at.is_finite() || state.rating_shown_at < 0.0 {
        state.rating_shown_at = 0.0;
    }
    state.timeline_segments.truncate(64);
    state.timeline_segments.retain(|segment| {
        segment.start.is_finite()
            && segment.end.is_finite()
            && segment.end > segment.start
            && matches!(segment.kind.as_str(), "op" | "ed" | "recap")
    });
    for segment in &mut state.timeline_segments {
        segment.start = segment.start.clamp(0.0, state.dur.max(0.0));
        segment.end = segment.end.clamp(0.0, state.dur.max(0.0));
    }
    state
        .timeline_segments
        .retain(|segment| segment.end > segment.start);
    state.chapter_marks.truncate(256);
    state
        .chapter_marks
        .retain(|time| time.is_finite() && *time > 0.0 && *time < state.dur);
    // Theme colours go straight into ASS override tags: anything but BBGGRR hex keeps the white.
    for color in [&mut state.theme_accent, &mut state.theme_focus] {
        if color.len() != 6 || !color.bytes().all(|b| b.is_ascii_hexdigit()) {
            color.clear();
        }
        color.make_ascii_uppercase();
    }
    state
}

/// A theme colour from the frontend (ASS BGR hex, already sanitized), or the OSD's own white.
fn theme_color(value: &str) -> &str {
    if value.is_empty() {
        "FFFFFF"
    } else {
        value
    }
}

/// Black or white, whichever reads better on `color` (ASS BGR hex), by WCAG relative luminance:
/// a dark theme accent behind a focused control must not swallow its black glyph.
fn ink_on(color: &str) -> &'static str {
    let channel = |at: usize| {
        let c = color
            .get(at..at + 2)
            .and_then(|hex| u8::from_str_radix(hex, 16).ok())
            .unwrap_or(255) as f64
            / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    // BGR: blue at 0, green at 2, red at 4. Above 0.179 black has the higher contrast.
    let luminance = 0.0722 * channel(0) + 0.7152 * channel(2) + 0.2126 * channel(4);
    if luminance > 0.179 {
        "000000"
    } else {
        "FFFFFF"
    }
}

fn draw(
    app: &AppHandle,
    state: &GmDynamicOverlay,
    phase: f64,
    motion: ControlMotion,
    play: f64,
    shown: &mut Shown,
) {
    let w = state.width.round() as i64;
    let h = state.height.round() as i64;
    let (wf, hf) = (w as f64, h as f64);
    let Some(player) = app.try_state::<PlayerHandle>() else {
        return;
    };

    let control_bg = if state.controls && motion.main > 0.0005 {
        controls_background_ass(wf, hf, motion.main)
    } else {
        String::new()
    };
    update_ass_layer(
        player.inner(),
        OSD_CONTROLS_BG_ID,
        Z_CONTROLS_BG,
        w,
        h,
        control_bg,
        &mut shown.control_bg,
    );

    // --- Progress/scrub bar: static layer (gradient/track/buffer) is content-gated; the dynamic
    // layer is normal played-fill + flanking times, or the active scrub knob + floating time.
    if (state.scrubbing || state.controls) && state.dur > 0.0 {
        let (bx, by, bw, bh) = scrub_geometry(state, wf, hf);
        let opacity = if state.scrubbing { 1.0 } else { motion.main };
        let static_ass = scrub_static_ass(state, wf, hf, bx, by, bw, bh, opacity);
        if shown.static_ass.as_deref() != Some(static_ass.as_str()) {
            let _ = player.osd_overlay_ass(OSD_SCRUB_STATIC_ID, &static_ass, w, h, Z_SCRUB_STATIC);
            shown.static_ass = Some(static_ass);
        }
        let marks_ass = timeline_marks_ass(state, bx, by - bh / 2.0, bw, bh, opacity);
        update_ass_layer(
            player.inner(),
            OSD_TIMELINE_MARKS_ID,
            Z_TIMELINE_MARKS,
            w,
            h,
            marks_ass,
            &mut shown.marks_ass,
        );
        let dyn_ass = if state.scrubbing {
            scrub_dynamic_ass(state, wf, bx, by, bw, bh, 1.0)
        } else {
            progress_dynamic_ass(state, bx, by, bw, bh, opacity)
        };
        let _ = player.osd_overlay_ass(OSD_SCRUB_DYN_ID, &dyn_ass, w, h, Z_SCRUB_DYN);
        shown.scrub = true;
    } else if shown.scrub {
        let _ = player.osd_overlay_remove(OSD_SCRUB_DYN_ID);
        let _ = player.osd_overlay_remove(OSD_SCRUB_STATIC_ID);
        let _ = player.osd_overlay_remove(OSD_TIMELINE_MARKS_ID);
        shown.static_ass = None;
        shown.marks_ass = None;
        shown.scrub = false;
    }

    let control_content = if state.controls && motion.content > 0.0005 {
        controls_content_ass(state, motion.content, motion.y, play)
    } else {
        String::new()
    };
    update_ass_layer(
        player.inner(),
        OSD_CONTROLS_CONTENT_ID,
        Z_CONTROLS_CONTENT,
        w,
        h,
        control_content,
        &mut shown.control_content,
    );

    let mut chrome = chrome_ass(&state.skip_text, &state.notice_text, wf, hf);
    let now_ms = unix_ms();
    if rating_active(state, now_ms) {
        // Sized in screen pixels, like the loading ring.
        let unit = player
            .get_property("osd-width")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|px| *px > 0.0)
            .map_or(1.0, |px| wf / px);
        let card = rating_card_ass(
            &state.rating_label,
            &state.rating_detail,
            rating_opacity(now_ms - state.rating_shown_at),
            wf,
            unit,
        );
        if !card.is_empty() {
            if !chrome.is_empty() {
                chrome.push('\n');
            }
            chrome.push_str(&card);
        }
    }
    if chrome.is_empty() {
        if shown.chrome.is_some() {
            let _ = player.osd_overlay_remove(OSD_CHROME_ID);
            shown.chrome = None;
        }
    } else if shown.chrome.as_deref() != Some(chrome.as_str()) {
        let _ = player.osd_overlay_ass(OSD_CHROME_ID, &chrome, w, h, Z_CHROME);
        shown.chrome = Some(chrome);
    }

    // --- Loading: pre-first-frame black backdrop + buffering spinner (animates every frame).
    if state.loading {
        // The ring keeps one size on screen whatever canvas the page last described: its first
        // state can still carry the browse page's zoom, which drew it a quarter bigger and then
        // shrank it once the next state came. The page's own ring is that size too.
        let unit = player.get_property("osd-width").ok().and_then(|v| v.parse::<f64>().ok()).filter(|px| *px > 0.0).map_or(1.0, |px| wf / px);
        let ass = loading_ass(state, phase, wf, hf, unit);
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

fn update_ass_layer(
    player: &PlayerHandle,
    id: i64,
    z: i64,
    w: i64,
    h: i64,
    ass: String,
    shown: &mut Option<String>,
) {
    if ass.is_empty() {
        if shown.take().is_some() {
            let _ = player.osd_overlay_remove(id);
        }
    } else if shown.as_deref() != Some(ass.as_str()) {
        let _ = player.osd_overlay_ass(id, &ass, w, h, z);
        *shown = Some(ass);
    }
}

fn remove(app: &AppHandle) {
    hold_lite(app, false);
    if let Some(player) = app.try_state::<PlayerHandle>() {
        let _ = player.osd_overlay_remove(OSD_SCRUB_DYN_ID);
        let _ = player.osd_overlay_remove(OSD_SCRUB_STATIC_ID);
        let _ = player.osd_overlay_remove(OSD_LOADING_ID);
        let _ = player.osd_overlay_remove(OSD_CHROME_ID);
        let _ = player.osd_overlay_remove(OSD_CONTROLS_BG_ID);
        let _ = player.osd_overlay_remove(OSD_CONTROLS_CONTENT_ID);
        let _ = player.osd_overlay_remove(OSD_TIMELINE_MARKS_ID);
    }
}

fn hold_lite(app: &AppHandle, on: bool) {
    if LITE.swap(on, Ordering::SeqCst) == on {
        return;
    }
    if let Some(player) = app.try_state::<PlayerHandle>() {
        player.set_ui_render_lite(on);
    }
}

/// The spinner's turn from the wall clock rather than from this loop's start, so it is in step with
/// the page's copies of it (Spinner.svelte `player`), which this window covers when it maps: the
/// hand-off then shows no jump. A fraction of a turn: one turn a second.
fn spinner_phase() -> f64 {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_millis();
    ms as f64 / 1000.0
}

/// Now, in Unix milliseconds (the clock the page stamps `rating_shown_at` with).
fn unix_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or_default()
}

/// The scrub bar's on-screen geometry: (x, y-centre, width, height). Prefers the HTML seek bar's
/// rect (sent from the frontend) so the native bar sits exactly on it — dragging feels like
/// dragging the player's own bar, not a separate mini-skimmer. Falls back to a computed layout
/// if absent.
fn scrub_geometry(state: &GmDynamicOverlay, w: f64, h: f64) -> (f64, f64, f64, f64) {
    if state.bar_w > 0.0 {
        (
            state.bar_x,
            state.bar_y,
            state.bar_w,
            state.bar_h.clamp(6.0, 18.0),
        )
    } else {
        let pad = (w * 0.06).clamp(54.0, 96.0);
        (pad, h - 76.0, (w - pad * 2.0).max(1.0), 8.0)
    }
}

/// STATIC scrub layer: the empty track and buffered range. The surrounding bottom gradient is
/// owned by the complete control chrome; adding another fade here creates a visible dark halo
/// behind the seekbar that CrunchyDeck does not have.
fn scrub_static_ass(
    state: &GmDynamicOverlay,
    _w: f64,
    _h: f64,
    x: f64,
    y: f64,
    bw: f64,
    bh: f64,
    master_opacity: f64,
) -> String {
    let mut lines = Vec::new();

    let top = y - bh / 2.0;
    // Track (white/25) · buffered (white/40) — the same fills the HTML seek bar uses.
    push(
        &mut lines,
        rect(x, top, bw, bh, "FFFFFF", &alpha_hex(0.25 * master_opacity)),
    );
    let buffer_pct = pct(state.buffer, state.dur);
    if buffer_pct > 0.0 {
        push(
            &mut lines,
            rect(
                x,
                top,
                bw * buffer_pct,
                bh,
                "FFFFFF",
                &alpha_hex(0.4 * master_opacity),
            ),
        );
    }
    lines.join("\n")
}

/// DYNAMIC scrub layer: the played fill up to the (tweened) scrub point, the knob, and the
/// scrubbed time floating above it. Re-pushed each animating frame; its own libass track, so it
/// never re-parses the static gradient above it.
fn scrub_dynamic_ass(
    state: &GmDynamicOverlay,
    w: f64,
    x: f64,
    y: f64,
    bw: f64,
    bh: f64,
    master_opacity: f64,
) -> String {
    let mut lines = Vec::new();
    let top = y - bh / 2.0;
    let scrub_pct = pct(state.scrub_time, state.dur);
    let accent = theme_color(&state.theme_accent);

    // Played to the scrub point (opaque).
    let alpha = alpha_hex(master_opacity);
    push(&mut lines, rect(x, top, bw * scrub_pct, bh, accent, &alpha));
    // Chromium reference: a 16px thumb that appears with the 6px -> 10px track expansion.
    let knob_x = x + bw * scrub_pct;
    let interaction = ((bh - NATIVE_SEEKBAR_IDLE_PX)
        / (NATIVE_SEEKBAR_ACTIVE_PX - NATIVE_SEEKBAR_IDLE_PX))
        .clamp(0.0, 1.0);
    push(
        &mut lines,
        circle(
            knob_x,
            y,
            8.0,
            accent,
            &alpha_hex(master_opacity * interaction),
        ),
    );
    let time = fmt_time(state.scrub_time);
    push(
        &mut lines,
        time_text_opacity(
            knob_x.clamp(60.0, w - 60.0),
            y - 42.0,
            32.0,
            &time,
            master_opacity,
            5,
        ),
    );
    lines.join("\n")
}

/// Normal visible controls: live played fill plus current/total times in the transparent HTML
/// placeholders that flank the seekbar. The HTML elements remain present for layout and touch.
fn progress_dynamic_ass(
    state: &GmDynamicOverlay,
    x: f64,
    y: f64,
    bw: f64,
    bh: f64,
    master_opacity: f64,
) -> String {
    let mut lines = Vec::new();
    let top = y - bh / 2.0;
    push(
        &mut lines,
        rect(
            x,
            top,
            bw * pct(state.pos, state.dur),
            bh,
            theme_color(&state.theme_accent),
            &alpha_hex(master_opacity),
        ),
    );
    push(
        &mut lines,
        time_text_opacity(x - 44.0, y, 20.0, &fmt_time(state.pos), master_opacity, 5),
    );
    push(
        &mut lines,
        time_text_opacity(
            x + bw + 44.0,
            y,
            20.0,
            &fmt_time(state.dur),
            master_opacity,
            5,
        ),
    );
    lines.join("\n")
}

/// OP/ED/recap ranges and chapter cuts live above both the buffered and played fills. This keeps
/// their meaning visible on the native Game-mode seekbar without changing chapter seek behaviour.
fn timeline_marks_ass(
    state: &GmDynamicOverlay,
    x: f64,
    top: f64,
    width: f64,
    height: f64,
    master_opacity: f64,
) -> String {
    if state.dur <= 0.0 || width <= 0.0 {
        return String::new();
    }
    let mut lines = Vec::new();
    for segment in &state.timeline_segments {
        let start = pct(segment.start, state.dur);
        let end = pct(segment.end, state.dur);
        let color = match segment.kind.as_str() {
            // ASS colours are BGR: Tailwind sky-400 / amber-400 match the HTML bar.
            "op" => "F8BD38",
            "ed" => "24BFFB",
            _ => "FFFFFF",
        };
        push(
            &mut lines,
            rect(
                x + width * start,
                top,
                width * (end - start).max(0.0),
                height,
                color,
                &alpha_hex(0.58 * master_opacity),
            ),
        );
    }
    // Mirror the HTML chapter segmentation with a narrow dark cut. A cut, instead of another
    // coloured marker, remains legible inside both played white and coloured skip ranges.
    for time in &state.chapter_marks {
        let mark_x = x + width * pct(*time, state.dur);
        push(
            &mut lines,
            rect(
                mark_x - 1.0,
                top,
                2.0,
                height,
                "000000",
                &alpha_hex(0.76 * master_opacity),
            ),
        );
    }
    lines.join("\n")
}

fn controls_background_ass(w: f64, h: f64, opacity: f64) -> String {
    let mut lines = Vec::new();
    // CrunchyDeck: `from-black/90 via-black/60 to-transparent`. Three overlapping feathered
    // surfaces approximate those stops without re-rastering sixteen full-width blurred bands on
    // every 60Hz fade frame. Extending them sideways keeps their horizontal edges fully opaque.
    let height = (h * 0.34).clamp(180.0, 300.0);
    let top = h - height;
    let blur = 28.0;
    for (offset, surface_height, surface_opacity) in [
        (32.0, height - 20.0, 0.34),
        (height * 0.36, height * 0.68, 0.42),
        (height * 0.68, height * 0.36, 0.58),
    ] {
        push(
            &mut lines,
            soft_rect(
                -blur * 2.0,
                top + offset,
                w + blur * 4.0,
                surface_height,
                "000000",
                &alpha_hex(surface_opacity * opacity),
                blur,
            ),
        );
    }
    // Extend the darkest foot past PlayResY. Rounding between the CSS viewport, mpv's OSD space,
    // and the physical 800-line panel otherwise leaves a one-pixel bright seam under the wash.
    // libass clips this at the framebuffer edge, so the overdraw cannot change layout.
    push(
        &mut lines,
        rect(0.0, h - 12.0, w, 28.0, "000000", &alpha_hex(0.90 * opacity)),
    );
    lines.join("\n")
}

fn controls_content_ass(
    state: &GmDynamicOverlay,
    opacity: f64,
    y_offset: f64,
    play: f64,
) -> String {
    let mut lines = Vec::new();
    let title_at_top = state.title_y < state.height * 0.35;
    if !state.title.trim().is_empty() {
        push(
            &mut lines,
            player_title_text(
                state.title_x,
                state.title_y + y_offset,
                state.title_size,
                state.title.trim(),
                opacity,
                4,
                state.title_weight,
            ),
        );
    }
    if !state.episode_text.trim().is_empty() {
        push(
            &mut lines,
            player_title_text(
                state.episode_x,
                state.episode_y + y_offset,
                state.episode_size,
                state.episode_text.trim(),
                opacity * if title_at_top { 0.7 } else { 0.72 },
                4,
                state.episode_weight,
            ),
        );
    }
    let accent = theme_color(&state.theme_accent);
    let focus = theme_color(&state.theme_focus);
    for item in &state.control_items {
        control_item_ass(item, opacity, y_offset, play, accent, focus, &mut lines);
    }
    lines.join("\n")
}

/// `accent` fills the focused control (Play keeps its white fill until focused); `focus` draws the
/// ring around a focused Play. Both are white without a theme.
fn control_item_ass(
    item: &GmControlItem,
    opacity: f64,
    y_offset: f64,
    play: f64,
    accent: &str,
    focus: &str,
    lines: &mut Vec<String>,
) {
    let text = item.text.trim();
    if !text.is_empty() {
        text_button_ass(item, text, opacity, y_offset, lines);
        return;
    }
    let scale = if item.focused {
        if item.primary {
            1.12
        } else {
            1.08
        }
    } else {
        1.0
    };
    let cx = item.x + item.w / 2.0;
    let cy = item.y + item.h / 2.0 + y_offset;
    let radius = item.w.min(item.h) * 0.5 * scale;
    let focused_fill = item.focused && !item.primary;
    let fill_opacity = if item.primary || focused_fill {
        0.96
    } else {
        0.0
    };
    let fill = if item.focused { accent } else { "FFFFFF" };
    if fill_opacity > 0.0 {
        push(
            lines,
            circle(cx, cy, radius, fill, &alpha_hex(fill_opacity * opacity)),
        );
    }
    if item.focused && !focused_fill {
        push(
            lines,
            circle_ring(
                cx,
                cy,
                radius + 1.0,
                radius + 4.0,
                focus,
                &alpha_hex(opacity),
            ),
        );
    }
    let icon_color = if item.primary || focused_fill {
        ink_on(fill)
    } else {
        "FFFFFF"
    };
    let label = item.label.to_ascii_lowercase();
    // Match the 24px Lucide glyph inside the HTML control's 48px hit target. A 0.5 scale
    // made the ASS approximation fill the whole nominal icon box, visibly boldening captions,
    // discussion and the filled previous/next episode shapes only once video was playing.
    let size = item.w.min(item.h) * 0.42;
    if label == "play" || label == "pause" {
        // Crossfade like the HTML control: the outgoing glyph fades out over the incoming one.
        for (glyph, weight) in [("play", play), ("pause", 1.0 - play)] {
            if weight > 0.0005 {
                control_icon_ass(glyph, cx, cy, size, icon_color, opacity * weight, lines);
            }
        }
    } else {
        control_icon_ass(&label, cx, cy, size, icon_color, opacity, lines);
    }
}

/// A control named in words ("Audio"): the word in the HTML button's own size and weight, with a faint
/// pill behind it while focused. Text renders crisply at any size, where an icon is an approximation.
fn text_button_ass(item: &GmControlItem, text: &str, opacity: f64, y_offset: f64, lines: &mut Vec<String>) {
    let y = item.y + y_offset;
    if item.focused {
        push(
            lines,
            round_rect(item.x, y, item.w, item.h, (item.h * 0.2).min(9.0), "FFFFFF", &alpha_hex(0.2 * opacity)),
        );
    }
    let size = if item.text_size > 0.0 { item.text_size } else { item.h * 0.4 };
    let weight = if item.text_weight > 0 { item.text_weight } else { 600 };
    push(
        lines,
        player_title_text(item.x + item.w / 2.0, y + item.h / 2.0, size, text, 0.9 * opacity, 5, weight),
    );
}

fn control_icon_ass(
    label: &str,
    cx: f64,
    cy: f64,
    size: f64,
    color: &str,
    opacity: f64,
    lines: &mut Vec<String>,
) {
    let a = alpha_hex(opacity);
    if label == "play" {
        push(
            lines,
            polygon(
                &[
                    (cx - size * 0.28, cy - size * 0.48),
                    (cx + size * 0.5, cy),
                    (cx - size * 0.28, cy + size * 0.48),
                ],
                color,
                &a,
            ),
        );
    } else if label == "pause" {
        push(
            lines,
            rect(
                cx - size * 0.38,
                cy - size * 0.48,
                size * 0.25,
                size * 0.96,
                color,
                &a,
            ),
        );
        push(
            lines,
            rect(
                cx + size * 0.13,
                cy - size * 0.48,
                size * 0.25,
                size * 0.96,
                color,
                &a,
            ),
        );
    } else if label.starts_with("previous episode") {
        push(
            lines,
            rect(
                cx - size * 0.5,
                cy - size * 0.48,
                size * 0.12,
                size * 0.96,
                color,
                &a,
            ),
        );
        push(
            lines,
            polygon(
                &[
                    (cx + size * 0.45, cy - size * 0.5),
                    (cx - size * 0.3, cy),
                    (cx + size * 0.45, cy + size * 0.5),
                ],
                color,
                &a,
            ),
        );
    } else if label.starts_with("next episode") {
        push(
            lines,
            rect(
                cx + size * 0.38,
                cy - size * 0.48,
                size * 0.12,
                size * 0.96,
                color,
                &a,
            ),
        );
        push(
            lines,
            polygon(
                &[
                    (cx - size * 0.45, cy - size * 0.5),
                    (cx + size * 0.3, cy),
                    (cx - size * 0.45, cy + size * 0.5),
                ],
                color,
                &a,
            ),
        );
    } else if label == "playback options" {
        // A solid gear, as the HTML button's gear reads at this size. A star outline of joined
        // strokes looked rough and low-resolution on the Deck.
        push(lines, gear(cx, cy, size / 24.0, color, &a));
    } else if label == "discussion" {
        // Lucide MessageSquare, matching the HTML control. Real strokes keep the speech bubble
        // hollow and crisp under libass instead of collapsing into a filled low-resolution blob.
        let u = size / 24.0;
        let stroke = 2.0 * u;
        let point = |x: f64, y: f64| (cx + (x - 12.0) * u, cy + (y - 12.0) * u);
        let outline = [
            point(4.0, 3.0),
            point(20.0, 3.0),
            point(21.4, 3.6),
            point(22.0, 5.0),
            point(22.0, 17.0),
            point(21.4, 18.4),
            point(20.0, 19.0),
            point(6.8, 19.0),
            point(2.0, 22.0),
            point(2.0, 5.0),
            point(2.6, 3.6),
            point(4.0, 3.0),
        ];
        push(lines, stroke_polyline(&outline, stroke, color, &a));
    } else if label == "switch server" {
        let u = size / 24.0;
        let stroke = 2.0 * u;
        push(
            lines,
            round_line(
                cx - 8.0 * u,
                cy - 5.0 * u,
                cx + 8.0 * u,
                cy - 5.0 * u,
                stroke,
                color,
                &a,
            ),
        );
        push(
            lines,
            round_line(
                cx + 4.0 * u,
                cy - 9.0 * u,
                cx + 8.0 * u,
                cy - 5.0 * u,
                stroke,
                color,
                &a,
            ),
        );
        push(
            lines,
            round_line(
                cx + 8.0 * u,
                cy - 5.0 * u,
                cx + 4.0 * u,
                cy - 1.0 * u,
                stroke,
                color,
                &a,
            ),
        );
        push(
            lines,
            round_line(
                cx - 8.0 * u,
                cy + 5.0 * u,
                cx + 8.0 * u,
                cy + 5.0 * u,
                stroke,
                color,
                &a,
            ),
        );
        push(
            lines,
            round_line(
                cx - 4.0 * u,
                cy + 1.0 * u,
                cx - 8.0 * u,
                cy + 5.0 * u,
                stroke,
                color,
                &a,
            ),
        );
        push(
            lines,
            round_line(
                cx - 8.0 * u,
                cy + 5.0 * u,
                cx - 4.0 * u,
                cy + 9.0 * u,
                stroke,
                color,
                &a,
            ),
        );
    } else if label.contains("subtitle") || label.contains("track") {
        // Lucide Captions for the combined media menu and optional subtitle-line controls. Use a
        // stroke polyline so libass cannot collapse its hollow frame into a filled rectangle.
        let u = size / 24.0;
        let stroke = 2.0 * u;
        let outline = [
            (cx - 7.0 * u, cy - 7.0 * u),
            (cx + 7.0 * u, cy - 7.0 * u),
            (cx + 9.0 * u, cy - 5.0 * u),
            (cx + 9.0 * u, cy + 5.0 * u),
            (cx + 7.0 * u, cy + 7.0 * u),
            (cx - 7.0 * u, cy + 7.0 * u),
            (cx - 9.0 * u, cy + 5.0 * u),
            (cx - 9.0 * u, cy - 5.0 * u),
            (cx - 7.0 * u, cy - 7.0 * u),
        ];
        push(lines, stroke_polyline(&outline, stroke, color, &a));
        for (x0, x1, y) in [
            (-5.0, -1.0, 3.0),
            (3.0, 5.0, 3.0),
            (-5.0, -3.0, -1.0),
            (1.0, 5.0, -1.0),
        ] {
            push(
                lines,
                round_line(
                    cx + x0 * u,
                    cy + y * u,
                    cx + x1 * u,
                    cy + y * u,
                    stroke,
                    color,
                    &a,
                ),
            );
        }
    } else {
        let initials: String = label
            .split_whitespace()
            .filter_map(|part| part.chars().next())
            .take(2)
            .collect::<String>()
            .to_uppercase();
        push(
            lines,
            text_color_opacity(cx, cy, size * 0.62, &initials, color, opacity, 5),
        );
    }
}

fn alpha_hex(opacity: f64) -> String {
    format!(
        "{:02X}",
        ((1.0 - opacity.clamp(0.0, 1.0)) * 255.0).round() as u8
    )
}

/// Seek times are application labels, not subtitle text. Use a real mono face with no artificial
/// outline so the Deck rendering matches Chromium's clean Geist Mono duration labels.
fn time_text_opacity(x: f64, y: f64, size: f64, body: &str, opacity: f64, align: u8) -> String {
    format!(
        "{{\\an{}\\pos({},{})\\fnDejaVu Sans Mono\\b400\\i0\\fs{}\\bord0\\shad1\\1c&HFFFFFF&\\4c&H000000&\\1a&H{}&\\4a&H90&}}{}",
        align,
        ir(x),
        ir(y),
        ir(size),
        alpha_hex(opacity),
        ass_escape(body)
    )
}

/// Player metadata should read like application chrome, not a subtitle. Nunito matches the HTML
/// UI (and Crunchy Deck's player heading); a small drop shadow replaces the former heavy outline.
fn player_title_text(
    x: f64,
    y: f64,
    size: f64,
    body: &str,
    opacity: f64,
    align: u8,
    weight: u16,
) -> String {
    format!(
        "{{\\an{}\\pos({},{})\\fnNunito\\b{}\\i0\\fs{}\\bord0\\shad1\\1c&HFFFFFF&\\4c&H000000&\\1a&H{}&\\4a&H{}&}}{}",
        align,
        ir(x),
        ir(y),
        weight,
        ir(size),
        alpha_hex(opacity),
        alpha_hex(opacity * 0.50),
        ass_escape(body)
    )
}

fn text_color_opacity(
    x: f64,
    y: f64,
    size: f64,
    body: &str,
    color: &str,
    opacity: f64,
    align: u8,
) -> String {
    text_color_weight_opacity(x, y, size, body, color, opacity, align, 400)
}

fn text_color_weight_opacity(
    x: f64,
    y: f64,
    size: f64,
    body: &str,
    color: &str,
    opacity: f64,
    align: u8,
    weight: u16,
) -> String {
    format!(
        "{{\\an{}\\pos({},{})\\fnNunito\\b{}\\fs{}\\bord{}\\shad0\\1c&H{}&\\3c&H000000&\\1a&H{}&\\3a&H{}&}}{}",
        align,
        ir(x),
        ir(y),
        weight,
        ir(size),
        if color == "FFFFFF" { 2 } else { 0 },
        color,
        alpha_hex(opacity),
        alpha_hex(opacity * 0.72),
        ass_escape(body)
    )
}

fn polygon(points: &[(f64, f64)], color: &str, alpha: &str) -> String {
    let Some((first, rest)) = points.split_first() else {
        return String::new();
    };
    if rest.len() < 2 {
        return String::new();
    }
    let mut path = format!("m {} {}", dr(first.0), dr(first.1));
    for point in rest {
        path.push_str(&format!(" l {} {}", dr(point.0), dr(point.1)));
    }
    format!("{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H{color}&\\1a&H{alpha}&\\p4}}{path}{{\\p0}}")
}

fn line_shape(
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    thickness: f64,
    color: &str,
    alpha: &str,
) -> String {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let len = (dx * dx + dy * dy).sqrt().max(0.001);
    let px = -dy / len * thickness / 2.0;
    let py = dx / len * thickness / 2.0;
    polygon(
        &[
            (x0 + px, y0 + py),
            (x1 + px, y1 + py),
            (x1 - px, y1 - py),
            (x0 - px, y0 - py),
        ],
        color,
        alpha,
    )
}

fn round_line(
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    thickness: f64,
    color: &str,
    alpha: &str,
) -> String {
    [
        line_shape(x0, y0, x1, y1, thickness, color, alpha),
        circle(x0, y0, thickness / 2.0, color, alpha),
        circle(x1, y1, thickness / 2.0, color, alpha),
    ]
    .join("\n")
}

fn stroke_polyline(points: &[(f64, f64)], thickness: f64, color: &str, alpha: &str) -> String {
    points
        .windows(2)
        .map(|pair| {
            round_line(
                pair[0].0, pair[0].1, pair[1].0, pair[1].1, thickness, color, alpha,
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn circle_ring(cx: f64, cy: f64, inner: f64, outer: f64, color: &str, alpha: &str) -> String {
    if inner <= 0.0 || outer <= inner {
        return String::new();
    }
    let path = |r: f64, clockwise: bool| {
        let k = r * 0.552_284_749_8;
        let (cx, cy, r, k) = (dr(cx), dr(cy), dr(r), dr(k));
        if clockwise {
            format!(
                "m {cx} {} b {} {} {} {} {} {cy} b {} {} {} {} {cx} {} b {} {} {} {} {} {cy} b {} {} {} {} {cx} {}",
                cy - r,
                cx + k, cy - r, cx + r, cy - k, cx + r,
                cx + r, cy + k, cx + k, cy + r, cy + r,
                cx - k, cy + r, cx - r, cy + k, cx - r,
                cx - r, cy - k, cx - k, cy - r, cy - r,
            )
        } else {
            format!(
                "m {cx} {} b {} {} {} {} {} {cy} b {} {} {} {} {cx} {} b {} {} {} {} {} {cy} b {} {} {} {} {cx} {}",
                cy - r,
                cx - k, cy - r, cx - r, cy - k, cx - r,
                cx - r, cy + k, cx - k, cy + r, cy + r,
                cx + k, cy + r, cx + r, cy + k, cx + r,
                cx + r, cy - k, cx + k, cy - r, cy - r,
            )
        }
    };
    format!(
        "{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H{color}&\\1a&H{alpha}&\\p4}}{} {}{{\\p0}}",
        path(outer, true),
        path(inner, false),
    )
}

/// LOADING layer: an opaque black backdrop before the first frame (covers the white webview and
/// the transparent hole) plus the buffering spinner. Animates every frame (the spinner sweeps),
/// so it's always re-pushed while loading.
fn loading_ass(state: &GmDynamicOverlay, phase: f64, w: f64, h: f64, unit: f64) -> String {
    let mut lines = Vec::new();
    if state.loading && !state.first_frame {
        push(&mut lines, rect(0.0, 0.0, w, h, "000000", "00"));
    }
    if state.loading {
        loading_overlay(phase, w, h, unit, theme_color(&state.theme_accent), &mut lines);
    }
    lines.join("\n")
}

/// `turn` is how far into its one-second turn the arc is (wall clock), and `unit` is canvas units per
/// screen pixel. The ring is 84 screen pixels across with a 4.5 px stroke: a faint track with a quarter
/// arc in the accent colour on it, the page's ring exactly (Spinner.svelte `player`).
fn loading_overlay(turn: f64, w: f64, h: f64, unit: f64, color: &str, lines: &mut Vec<String>) {
    let (cx, cy) = (w / 2.0, h / 2.0);
    let outer = 42.0 * unit;
    let inner = (42.0 - 4.5) * unit;
    push(lines, circle_ring(cx, cy, inner, outer, "FFFFFF", &alpha_hex(0.15)));
    let centre = turn.rem_euclid(1.0) * PI * 2.0 - PI / 2.0;
    push(
        lines,
        arc_band(cx, cy, inner, outer, centre - PI / 4.0, centre + PI / 4.0, 24, color, "00"),
    );
}

/// An annulus sector from `a0` to `a1` (radians, clockwise from +x on screen), each edge drawn with
/// `steps` straight pieces: smooth at spinner sizes.
#[allow(clippy::too_many_arguments)]
fn arc_band(
    cx: f64,
    cy: f64,
    inner: f64,
    outer: f64,
    a0: f64,
    a1: f64,
    steps: usize,
    color: &str,
    alpha: &str,
) -> String {
    if inner <= 0.0 || outer <= inner || steps == 0 {
        return String::new();
    }
    let at = |i: usize| a0 + (a1 - a0) * i as f64 / steps as f64;
    let p = |r: f64, a: f64| (dr(cx + a.cos() * r), dr(cy + a.sin() * r));
    let (x, y) = p(outer, a0);
    let mut path = format!("m {x} {y}");
    for i in 1..=steps {
        let (x, y) = p(outer, at(i));
        path.push_str(&format!(" l {x} {y}"));
    }
    for i in (0..=steps).rev() {
        let (x, y) = p(inner, at(i));
        path.push_str(&format!(" l {x} {y}"));
    }
    format!("{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H{color}&\\1a&H{alpha}&\\p4}}{path}{{\\p0}}")
}

/// A solid gear 22 units across (`u` px each) with a round hole: eight teeth on eased flanks,
/// sampled finely enough to draw smooth, the first tooth at the top.
fn gear(cx: f64, cy: f64, u: f64, color: &str, alpha: &str) -> String {
    const TEETH: usize = 8;
    const STEPS: usize = 24;
    let (tip, root, hole) = (11.0 * u, 8.0 * u, 3.5 * u);
    let ease = |x: f64| {
        let x = x.clamp(0.0, 1.0);
        x * x * (3.0 - 2.0 * x)
    };
    let n = TEETH * STEPS;
    let mut path = String::new();
    for i in 0..n {
        // Across one tooth's turn: a gap at the root, a flank up, the flat top, a flank down.
        let t = (i % STEPS) as f64 / STEPS as f64;
        let lift = if t < 0.5 { ease((t - 0.15) / 0.15) } else { ease((0.85 - t) / 0.15) };
        let r = root + (tip - root) * lift;
        let a = -PI / 2.0 - PI / TEETH as f64 + i as f64 / n as f64 * 2.0 * PI;
        let verb = if i == 0 { "m" } else { " l" };
        path.push_str(&format!("{verb} {} {}", dr(cx + a.cos() * r), dr(cy + a.sin() * r)));
    }
    // The hole runs the other way round, so it stays open under either fill rule.
    for i in 0..32 {
        let a = -(i as f64) / 32.0 * 2.0 * PI;
        let verb = if i == 0 { "m" } else { "l" };
        path.push_str(&format!(" {verb} {} {}", dr(cx + a.cos() * hole), dr(cy + a.sin() * hole)));
    }
    format!("{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H{color}&\\1a&H{alpha}&\\p4}}{path}{{\\p0}}")
}

/// A rounded rectangle's outline as an ASS path, clockwise or not (an inner one cut the other way
/// leaves a hole).
fn round_rect_path(x: f64, y: f64, w: f64, h: f64, r: f64, clockwise: bool) -> String {
    let r = r.min(w / 2.0).min(h / 2.0).max(0.0);
    let k = r * 0.552_284_749_8;
    let (x0, y0, x1, y1) = (x, y, x + w, y + h);
    if clockwise {
        format!(
            "m {} {} l {} {} b {} {} {} {} {} {} l {} {} b {} {} {} {} {} {} l {} {} b {} {} {} {} {} {} l {} {} b {} {} {} {} {} {}",
            dr(x0 + r), dr(y0), dr(x1 - r), dr(y0),
            dr(x1 - r + k), dr(y0), dr(x1), dr(y0 + r - k), dr(x1), dr(y0 + r),
            dr(x1), dr(y1 - r),
            dr(x1), dr(y1 - r + k), dr(x1 - r + k), dr(y1), dr(x1 - r), dr(y1),
            dr(x0 + r), dr(y1),
            dr(x0 + r - k), dr(y1), dr(x0), dr(y1 - r + k), dr(x0), dr(y1 - r),
            dr(x0), dr(y0 + r),
            dr(x0), dr(y0 + r - k), dr(x0 + r - k), dr(y0), dr(x0 + r), dr(y0),
        )
    } else {
        format!(
            "m {} {} b {} {} {} {} {} {} l {} {} b {} {} {} {} {} {} l {} {} b {} {} {} {} {} {} l {} {} b {} {} {} {} {} {} l {} {}",
            dr(x0 + r), dr(y0),
            dr(x0 + r - k), dr(y0), dr(x0), dr(y0 + r - k), dr(x0), dr(y0 + r),
            dr(x0), dr(y1 - r),
            dr(x0), dr(y1 - r + k), dr(x0 + r - k), dr(y1), dr(x0 + r), dr(y1),
            dr(x1 - r), dr(y1),
            dr(x1 - r + k), dr(y1), dr(x1), dr(y1 - r + k), dr(x1), dr(y1 - r),
            dr(x1), dr(y0 + r),
            dr(x1), dr(y0 + r - k), dr(x1 - r + k), dr(y0), dr(x1 - r), dr(y0),
            dr(x0 + r), dr(y0),
        )
    }
}

fn round_rect(x: f64, y: f64, w: f64, h: f64, r: f64, color: &str, alpha: &str) -> String {
    if w <= 0.0 || h <= 0.0 {
        return String::new();
    }
    format!(
        "{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H{color}&\\1a&H{alpha}&\\p4}}{}{{\\p0}}",
        round_rect_path(x, y, w, h, r, true)
    )
}

/// A rounded rectangle's border, `stroke` wide on the inside.
#[allow(clippy::too_many_arguments)]
fn round_rect_ring(x: f64, y: f64, w: f64, h: f64, r: f64, stroke: f64, color: &str, alpha: &str) -> String {
    if w <= 2.0 * stroke || h <= 2.0 * stroke {
        return String::new();
    }
    format!(
        "{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H{color}&\\1a&H{alpha}&\\p4}}{} {}{{\\p0}}",
        round_rect_path(x, y, w, h, r, true),
        round_rect_path(x + stroke, y + stroke, w - 2.0 * stroke, h - 2.0 * stroke, (r - stroke).max(0.0), false),
    )
}

const RATING_IN_MS: f64 = 700.0;
const RATING_HOLD_MS: f64 = 3600.0;
const RATING_OUT_MS: f64 = 700.0;

/// The rating card's opacity `since_ms` after it was first shown: in over 0.7 s, held until 3.6 s,
/// out over 0.7 s, easing out both ways.
fn rating_opacity(since_ms: f64) -> f64 {
    let ease = |t: f64| 1.0 - (1.0 - t.clamp(0.0, 1.0)).powi(3);
    if since_ms < 0.0 {
        0.0
    } else if since_ms < RATING_IN_MS {
        ease(since_ms / RATING_IN_MS)
    } else if since_ms < RATING_HOLD_MS {
        1.0
    } else {
        1.0 - ease((since_ms - RATING_HOLD_MS) / RATING_OUT_MS)
    }
}

fn rating_active(state: &GmDynamicOverlay, now_ms: f64) -> bool {
    !state.rating_label.is_empty()
        && state.rating_shown_at > 0.0
        && now_ms - state.rating_shown_at < RATING_HOLD_MS + RATING_OUT_MS
}

/// The rating card, in screen pixels times `unit`: "RATING" over the content descriptors, right-aligned
/// beside the rating in a white-bordered box, 60 px from the right edge and 48 px from the top.
fn rating_card_ass(label: &str, detail: &str, opacity: f64, w: f64, unit: f64) -> String {
    if opacity <= 0.002 || label.is_empty() {
        return String::new();
    }
    let box_h = 72.0 * unit;
    let font = 36.0 * unit;
    let box_w = (label.chars().count() as f64 * font * 0.62 + 24.0 * unit).max(box_h);
    let x0 = w - 60.0 * unit - box_w;
    let y0 = 48.0 * unit;
    let mid = y0 + box_h / 2.0;
    let mut lines = Vec::new();
    push(
        &mut lines,
        round_rect_ring(x0, y0, box_w, box_h, 9.0 * unit, 3.0 * unit, "FFFFFF", &alpha_hex(0.8 * opacity)),
    );
    push(&mut lines, player_title_text(x0 + box_w / 2.0, mid, font, label, opacity, 5, 900));
    let text_x = x0 - 18.0 * unit;
    let line = 21.0 * unit;
    if detail.is_empty() {
        push(&mut lines, player_title_text(text_x, mid, line, "RATING", 0.9 * opacity, 6, 600));
    } else {
        push(&mut lines, player_title_text(text_x, mid - line * 0.72, line, "RATING", 0.9 * opacity, 6, 600));
        push(&mut lines, player_title_text(text_x, mid + line * 0.72, line, detail, 0.7 * opacity, 6, 400));
    }
    lines.join("\n")
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
    let seconds = if seconds.is_finite() {
        seconds.max(0.0)
    } else {
        0.0
    };
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

fn rect(x: f64, y: f64, w: f64, h: f64, color: &str, alpha: &str) -> String {
    if w <= 0.0 || h <= 0.0 {
        return String::new();
    }

    let x0 = dr(x);
    let y0 = dr(y);
    let x1 = dr(x + w);
    let y1 = dr(y + h);
    if x1 <= x0 || y1 <= y0 {
        return String::new();
    }

    format!(
        "{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H{}&\\1a&H{}&\\p4}}m {} {} l {} {} l {} {} l {} {}{{\\p0}}",
        color, alpha, x0, y0, x1, y0, x1, y1, x0, y1
    )
}

/// A subpixel ASS rectangle whose edge is blended by libass. Used only for adjacent gradient
/// bands: the blur overlaps their boundaries, eliminating visible stripes without adding another
/// seekbar-specific shadow surface.
fn soft_rect(x: f64, y: f64, w: f64, h: f64, color: &str, alpha: &str, blur: f64) -> String {
    if w <= 0.0 || h <= 0.0 || blur <= 0.0 {
        return rect(x, y, w, h, color, alpha);
    }
    let x0 = dr(x);
    let y0 = dr(y);
    let x1 = dr(x + w);
    let y1 = dr(y + h);
    if x1 <= x0 || y1 <= y0 {
        return String::new();
    }
    format!(
        "{{\\an7\\pos(0,0)\\bord0\\shad0\\blur{}\\1c&H{}&\\1a&H{}&\\p4}}m {} {} l {} {} l {} {} l {} {}{{\\p0}}",
        ir(blur).max(1),
        color,
        alpha,
        x0,
        y0,
        x1,
        y0,
        x1,
        y1,
        x0,
        y1
    )
}

fn circle(cx: f64, cy: f64, r: f64, color: &str, alpha: &str) -> String {
    if r <= 0.0 {
        return String::new();
    }

    let k = r * 0.552_284_749_8;
    let cx = dr(cx);
    let cy = dr(cy);
    let r = dr(r);
    let k = dr(k);

    format!(
        "{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H{}&\\1a&H{}&\\p4}}m {} {} b {} {} {} {} {} {} b {} {} {} {} {} {} b {} {} {} {} {} {} b {} {} {} {} {} {}{{\\p0}}",
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

fn ass_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
}

fn ir(v: f64) -> i64 {
    v.round() as i64
}

/// ASS `\p4` drawing coordinates have 1/8px units. Keeping the subpixel geometry through to
/// libass avoids the jagged, uneven 20px icon strokes produced by the old `\p1` integer paths.
fn dr(v: f64) -> i64 {
    (v * 8.0).round() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn button(label: &str) -> GmControlItem {
        GmControlItem {
            x: 0.0,
            y: 0.0,
            w: 48.0,
            h: 48.0,
            label: label.into(),
            focused: false,
            primary: true,
            ..Default::default()
        }
    }

    #[test]
    fn play_pause_glyphs_crossfade() {
        let shapes = |play| {
            let mut lines = Vec::new();
            control_item_ass(
                &button("Play"),
                1.0,
                0.0,
                play,
                "FFFFFF",
                "FFFFFF",
                &mut lines,
            );
            lines.len()
        };
        // Mid-fade draws the triangle and both bars; at either end only one glyph remains.
        assert_eq!(shapes(0.5), shapes(1.0) + 2);
        assert_eq!(shapes(0.0), shapes(1.0) + 1);
    }

    #[test]
    fn play_fade_snaps_on_first_sight_and_tweens_toggles() {
        let t0 = Instant::now();
        let ms = |n| t0 + Duration::from_millis(n);
        let mut fade = PlayFade::new(t0);
        assert_eq!(fade.step(&[button("Pause")], true, t0), (0.0, false));
        assert_eq!(fade.step(&[button("Play")], true, ms(10)), (0.0, true));
        let (mid, animating) = fade.step(&[button("Play")], true, ms(85));
        assert!(mid > 0.0 && mid < 1.0 && animating);
        // Hidden controls keep the last glyph while the fade finishes.
        assert_eq!(fade.step(&[], true, ms(170)), (1.0, false));
        // Animations off: a toggle swaps instantly.
        assert_eq!(fade.step(&[button("Pause")], false, ms(300)), (0.0, false));
    }

    #[test]
    fn theme_colors_must_be_bgr_hex() {
        let state = sanitize_state(GmDynamicOverlay {
            theme_accent: "2175f4".into(),
            theme_focus: "FF}\\p0".into(),
            ..Default::default()
        });
        assert_eq!(state.theme_accent, "2175F4");
        assert_eq!(state.theme_focus, "");
        for junk in ["FFF", "GG0000", "2175F4AA", "&H2175F4&"] {
            let state = sanitize_state(GmDynamicOverlay {
                theme_accent: junk.into(),
                ..Default::default()
            });
            assert_eq!(state.theme_accent, "", "{junk}");
        }
    }

    #[test]
    fn theme_accent_colours_the_bar_spinner_and_focus() {
        let themed = GmDynamicOverlay {
            pos: 5.0,
            dur: 10.0,
            loading: true,
            theme_accent: "2175F4".into(),
            ..Default::default()
        };
        assert!(progress_dynamic_ass(&themed, 0.0, 10.0, 100.0, 6.0, 1.0).contains("\\1c&H2175F4&"));
        assert!(loading_ass(&themed, 0.0, 1280.0, 800.0, 1.0).contains("\\1c&H2175F4&"));
        // No theme: today's white.
        let plain = GmDynamicOverlay {
            theme_accent: String::new(),
            ..themed
        };
        let plain_bar = progress_dynamic_ass(&plain, 0.0, 10.0, 100.0, 6.0, 1.0);
        assert!(
            !plain_bar.contains("2175F4")
                && plain_bar.starts_with("{\\an7\\pos(0,0)\\bord0\\shad0\\1c&HFFFFFF&")
        );

        let mut focused = button("Play");
        focused.focused = true;
        let mut lines = Vec::new();
        control_item_ass(&focused, 1.0, 0.0, 1.0, "2175F4", "00FF00", &mut lines);
        let ass = lines.join("\n");
        assert!(ass.contains("\\1c&H2175F4&"), "accent fill");
        assert!(ass.contains("\\1c&H00FF00&"), "focus ring");
        assert!(
            ass.contains("\\1c&H000000&"),
            "dark glyph on a light accent"
        );
    }

    #[test]
    fn glyph_ink_contrasts_with_the_fill() {
        assert_eq!(ink_on("FFFFFF"), "000000");
        assert_eq!(ink_on("2175F4"), "000000");
        assert_eq!(ink_on("000000"), "FFFFFF");
        assert_eq!(ink_on("8B0000"), "FFFFFF"); // dark blue
    }

    #[test]
    fn rating_card_fades_in_holds_and_fades_out() {
        assert_eq!(rating_opacity(-10.0), 0.0);
        assert!(rating_opacity(350.0) > 0.5 && rating_opacity(350.0) < 1.0);
        assert_eq!(rating_opacity(2000.0), 1.0);
        assert!(rating_opacity(3950.0) > 0.0 && rating_opacity(3950.0) < 0.5);
        assert!(rating_opacity(4300.0) <= 0.0001);
        let mut state = GmDynamicOverlay { rating_label: "14".into(), rating_shown_at: 1000.0, ..Default::default() };
        assert!(rating_active(&state, 2000.0));
        assert!(!rating_active(&state, 1000.0 + 4300.0));
        state.rating_label.clear();
        assert!(!rating_active(&state, 2000.0));
        let card = rating_card_ass("14", "Violence", 1.0, 1280.0, 1.0);
        assert!(card.contains("}14") && card.contains("}RATING") && card.contains("}Violence"));
    }

    #[test]
    fn a_control_named_in_words_draws_its_word() {
        let mut item = GmControlItem { x: 900.0, y: 700.0, w: 90.0, h: 40.0, label: "Audio".into(), text: "Audio".into(), text_size: 21.0, text_weight: 600, ..Default::default() };
        let mut lines = Vec::new();
        control_item_ass(&item, 1.0, 0.0, 1.0, "FFFFFF", "FFFFFF", &mut lines);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("\\fnNunito\\b600") && lines[0].ends_with("Audio"));
        item.focused = true;
        lines.clear();
        control_item_ass(&item, 1.0, 0.0, 1.0, "FFFFFF", "FFFFFF", &mut lines);
        assert_eq!(lines.len(), 2, "a focused word sits on a faint pill");
    }

    #[test]
    fn the_loading_ring_is_a_track_with_a_quarter_arc() {
        let mut lines = Vec::new();
        loading_overlay(0.25, 1280.0, 800.0, 1.0, "2175F4", &mut lines);
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("\\1c&HFFFFFF&") && lines[0].contains(&format!("\\1a&H{}&", alpha_hex(0.15))));
        assert!(lines[1].contains("\\1c&H2175F4&\\1a&H00&"));
    }

    #[test]
    fn the_options_gear_is_one_smooth_solid_shape_with_a_hole() {
        let mut lines = Vec::new();
        control_icon_ass("playback options", 100.0, 100.0, 24.0, "FFFFFF", 1.0, &mut lines);
        assert_eq!(lines.len(), 1, "one shape, not joined strokes");
        let path = &lines[0][lines[0].find("\\p4}").unwrap() + 4..lines[0].rfind("{\\p0}").unwrap()];
        assert_eq!(path.matches('m').count(), 2, "the gear and its hole");
        let points: Vec<(f64, f64)> = path
            .split(['m', 'l'])
            .filter_map(|part| {
                let mut xy = part.split_whitespace().map(|v| v.parse::<f64>().unwrap() / 8.0);
                Some((xy.next()? - 100.0, xy.next()? - 100.0))
            })
            .collect();
        assert_eq!(points.len(), 8 * 24 + 32);
        let radii: Vec<f64> = points.iter().map(|(x, y)| x.hypot(*y)).collect();
        let (gear, hole) = radii.split_at(8 * 24);
        assert!(gear.iter().all(|r| (7.8..=11.2).contains(r)));
        assert!(gear.iter().filter(|r| **r > 10.8).count() >= 8 * 6, "eight flat-topped teeth");
        assert!(hole.iter().all(|r| (3.4..=3.6).contains(r)));
        assert!(points[12].1 < -10.8 && points[12].0.abs() < 0.2, "a tooth at the top");
    }
}
