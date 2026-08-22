//! Game mode (gamescope / XWayland X11) controls-over-video compositor.
//!
//! gamescope will not blend an arbitrary transparent app surface over the video. In Game mode
//! the mpv child is also structurally above the webview, so the desktop "transparent controls
//! over video" path cannot work there.
//!
//! Instead mpv bakes the controls into its own opaque video surface: we snapshot the webview's
//! transparent-background HTML controls with WebKit and push each frame to mpv as a
//! premultiplied-BGRA `overlay-add`. The real HTML controls still receive input behind the
//! video because the mpv container is input-transparent; this module is only the pixel bridge.
//!
//! Snapshotting runs only while controls or menus are visible. Idle chrome is a single cropped
//! snapshot of the bottom control strip; menus re-snapshot when the frontend bumps overlay rev
//! (not a 60fps WebKit loop). Show/hide scales that settled BGRA snapshot and reissues
//! `overlay-add` for the short motion. mpv copies raw-memory input when the command runs; it
//! does not observe later writes to the source pointer. This costs no extra WebKit raster.

#![cfg(target_os = "linux")]

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use gtk::cairo;
use gtk::glib;
use tauri::{AppHandle, Manager};
use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

use crate::gm_perf::{
    clip_to_strip, overlay_fade_step, overlay_loop_fps, overlay_should_snapshot,
    scale_premult_bgra, OVERLAY_FADE_FRAME_MS, OVERLAY_FADE_FULL, OVERLAY_FADE_MS,
    OVERLAY_MOTION_PX, OVERLAY_SCRUB_FPS,
};
use crate::player::PlayerHandle;

const OVERLAY_ID: i64 = 1;

static GEN: AtomicU64 = AtomicU64::new(0);
static FADE_GEN: AtomicU64 = AtomicU64::new(0);
static BUSY: AtomicBool = AtomicBool::new(false);
static FAST: AtomicBool = AtomicBool::new(false);
static FORCE: AtomicBool = AtomicBool::new(false);
static SHOWN: AtomicBool = AtomicBool::new(false);
static ALPHA: AtomicU32 = AtomicU32::new(0);

static PROF_N: AtomicU64 = AtomicU64::new(0);
static PROF_LAST: Mutex<Option<Instant>> = Mutex::new(None);

/// Persistent premultiplied-BGRA crop buffer. mpv reads this memory by address.
static BUF: Mutex<Vec<u8>> = Mutex::new(Vec::new());
/// Opaque snapshot that fade ticks scale into [`BUF`].
static BASE: Mutex<Vec<u8>> = Mutex::new(Vec::new());
/// Last uploaded crop geometry: x, y, width, height, stride.
static GEOM: Mutex<Option<(i64, i64, i64, i64, i64)>> = Mutex::new(None);
/// Idle snapshots clip to this CSS-pixel control strip so we do not upload a full viewport.
static STRIP: Mutex<Option<(i64, i64, i64, i64)>> = Mutex::new(None);
static EMPTY_TRIES: AtomicU64 = AtomicU64::new(0);

/// Begin snapshotting the webview controls into an mpv overlay. Safe to call again while
/// running; each call supersedes the previous timer loop. Idle (`fast=false`) takes one
/// snapshot and stops — the control strip does not need 12fps rasters while it is still.
/// The first snapshot after hide fades in on the CPU; later snapshots replace pixels instantly.
pub fn start(
    app: AppHandle,
    window: tauri::WebviewWindow,
    fast: bool,
    animate: bool,
    crop: Option<(i64, i64, i64, i64)>,
) {
    // Only treat this as a fade-in if nothing is on screen yet. Setting SHOWN before the
    // first pixels landed left tap/pause at alpha 0 forever (empty snapshot → hide).
    let fade_in = animate && !SHOWN.load(Ordering::SeqCst);
    let my_gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    FAST.store(fast, Ordering::SeqCst);
    FORCE.store(true, Ordering::SeqCst);
    EMPTY_TRIES.store(0, Ordering::SeqCst);
    if let Ok(mut strip) = STRIP.lock() {
        *strip = if fast { None } else { crop };
    }
    if !animate {
        FADE_GEN.fetch_add(1, Ordering::SeqCst);
        ALPHA.store(OVERLAY_FADE_FULL, Ordering::SeqCst);
    }
    // A second settled snapshot can arrive while the first snapshot's native fade is running.
    // Preserve that fade instead of snapping to full opacity and cancelling it.
    if !fade_in && ALPHA.load(Ordering::SeqCst) >= OVERLAY_FADE_FULL {
        FADE_GEN.fetch_add(1, Ordering::SeqCst);
    }

    let _ = window.with_webview(move |pw| {
        let wv = pw.inner();
        BUSY.store(true, Ordering::SeqCst);
        snapshot_once(&wv, &app, my_gen, fade_in);

        if overlay_loop_fps(fast) == 0 {
            return;
        }

        let app = app.clone();
        let mut last_tick = Instant::now();
        glib::timeout_add_local(Duration::from_millis(1000 / OVERLAY_SCRUB_FPS), move || {
            if GEN.load(Ordering::SeqCst) != my_gen {
                return glib::ControlFlow::Break;
            }

            let fps = overlay_loop_fps(FAST.load(Ordering::Relaxed));
            if fps == 0 {
                return glib::ControlFlow::Continue;
            }
            let interval = Duration::from_millis(1000 / fps);
            let now = Instant::now();
            if now.duration_since(last_tick) < interval {
                return glib::ControlFlow::Continue;
            }

            // Never queue a second WebKit snapshot behind a slow one; the loop self-paces to
            // what the Deck can actually raster.
            if overlay_should_snapshot(true, false, BUSY.load(Ordering::SeqCst))
                && !BUSY.swap(true, Ordering::SeqCst)
            {
                last_tick = now;
                snapshot_once(&wv, &app, my_gen, false);
            }
            glib::ControlFlow::Continue
        });
    });
}

/// Stop the overlay loop and fade the controls off the video.
pub fn stop(app: AppHandle, animate: bool) {
    GEN.fetch_add(1, Ordering::SeqCst);
    FAST.store(false, Ordering::SeqCst);
    SHOWN.store(false, Ordering::SeqCst);
    if let Ok(mut strip) = STRIP.lock() {
        *strip = None;
    }
    let has_pixels =
        GEOM.lock().ok().and_then(|g| *g).is_some() && ALPHA.load(Ordering::SeqCst) > 0;
    if !animate || !has_pixels {
        hide_now(&app);
        return;
    }
    kick_fade(app, false);
}

fn hide_now(app: &AppHandle) {
    FADE_GEN.fetch_add(1, Ordering::SeqCst);
    ALPHA.store(0, Ordering::SeqCst);
    if let Ok(mut geom) = GEOM.lock() {
        *geom = None;
    }
    if let Ok(mut base) = BASE.lock() {
        base.clear();
    }
    if let Some(ph) = app.try_state::<PlayerHandle>() {
        let _ = ph.overlay_remove(OVERLAY_ID);
    }
}

fn kick_fade(app: AppHandle, fade_in: bool) {
    let gen = FADE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let started = Instant::now();
    let mut last = Instant::now();
    let mut frames = 0u32;
    let mut max_upload = Duration::ZERO;
    glib::timeout_add_local(Duration::from_millis(OVERLAY_FADE_FRAME_MS), move || {
        if FADE_GEN.load(Ordering::SeqCst) != gen {
            return glib::ControlFlow::Break;
        }
        if fade_in && !SHOWN.load(Ordering::SeqCst) {
            return glib::ControlFlow::Break;
        }
        if !fade_in && SHOWN.load(Ordering::SeqCst) {
            return glib::ControlFlow::Break;
        }
        let now = Instant::now();
        let dt = now.duration_since(last).as_millis() as u64;
        last = now;
        let next = overlay_fade_step(
            ALPHA.load(Ordering::Relaxed),
            fade_in,
            dt.max(1),
            OVERLAY_FADE_MS,
        );
        ALPHA.store(next, Ordering::Relaxed);
        let hidden = OVERLAY_FADE_FULL.saturating_sub(next) as i64;
        let y_offset = hidden.saturating_mul(OVERLAY_MOTION_PX) / OVERLAY_FADE_FULL as i64;
        let upload_started = Instant::now();
        present(&app, y_offset);
        max_upload = max_upload.max(upload_started.elapsed());
        frames += 1;
        if fade_in && next >= OVERLAY_FADE_FULL {
            crate::player::linux_embed::elog(&format!(
                "overlay-motion: in frames={} elapsed={}ms max-upload={}ms",
                frames,
                started.elapsed().as_millis(),
                max_upload.as_millis(),
            ));
            return glib::ControlFlow::Break;
        }
        if !fade_in && next == 0 {
            crate::player::linux_embed::elog(&format!(
                "overlay-motion: out frames={} elapsed={}ms max-upload={}ms",
                frames,
                started.elapsed().as_millis(),
                max_upload.as_millis(),
            ));
            if !SHOWN.load(Ordering::SeqCst) {
                hide_now(&app);
            }
            return glib::ControlFlow::Break;
        }
        glib::ControlFlow::Continue
    });
}

/// Upload one native animation frame. mpv's raw-address form is an input convenience, not
/// shared memory: `cmd_overlay_add` copies the pixels before returning. Reissuing the command
/// here is the critical difference between a visible 60fps fade and a frozen first frame.
fn present(app: &AppHandle, y_offset: i64) {
    let Some(geom) = GEOM.lock().ok().and_then(|g| *g) else {
        return;
    };
    let alpha = ALPHA.load(Ordering::Relaxed);
    let addr = {
        let Ok(base) = BASE.lock() else {
            return;
        };
        let Ok(mut buf) = BUF.lock() else {
            return;
        };
        // Avoid reallocating while composing a frame; size changes go through snapshot_once.
        if buf.len() != base.len() {
            return;
        }
        scale_premult_bgra(&base, &mut buf, alpha);
        buf.as_ptr() as usize
    };
    if let Some(ph) = app.try_state::<PlayerHandle>() {
        let _ = ph.overlay_add(
            OVERLAY_ID,
            geom.0,
            geom.1.saturating_add(y_offset),
            addr,
            geom.2,
            geom.3,
            geom.4,
        );
    }
}

fn alpha_bounds(
    data: &[u8],
    w: usize,
    h: usize,
    stride: usize,
) -> Option<(usize, usize, usize, usize)> {
    if w == 0 || h == 0 || stride < w.checked_mul(4)? {
        return None;
    }

    let mut min_x = w;
    let mut min_y = h;
    let mut max_x = 0usize;
    let mut max_y = 0usize;
    let mut found = false;

    for y in 0..h {
        let row = y.checked_mul(stride)?;
        if row.checked_add(w * 4)? > data.len() {
            return None;
        }
        for x in 0..w {
            // cairo ARGB32 on little-endian is premultiplied BGRA in memory.
            if data[row + x * 4 + 3] != 0 {
                found = true;
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
            }
        }
    }

    found.then_some((min_x, min_y, max_x - min_x + 1, max_y - min_y + 1))
}

/// Take one WebKit snapshot and push the non-transparent crop to mpv as an overlay.
fn snapshot_once(wv: &webkit2gtk::WebView, app: &AppHandle, my_gen: u64, fade_in: bool) {
    let app = app.clone();
    let wv_retry = wv.clone();
    let t_req = Instant::now();
    wv.snapshot(
        SnapshotRegion::Visible,
        SnapshotOptions::TRANSPARENT_BACKGROUND,
        None::<&gtk::gio::Cancellable>,
        move |res| {
            let raster = t_req.elapsed();
            let t_proc = Instant::now();

            let push = |res: Result<cairo::Surface, glib::Error>| -> Option<()> {
                if GEN.load(Ordering::SeqCst) != my_gen {
                    return Some(());
                }
                let surface = res.ok()?;
                let mut img = cairo::ImageSurface::try_from(surface).ok()?;
                let (w, h, stride) = (img.width() as i64, img.height() as i64, img.stride() as i64);
                if w <= 0 || h <= 0 || stride <= 0 {
                    return None;
                }

                let need = (stride * h) as usize;
                let data = img.data().ok()?;
                let Some((x, y, cw, ch)) =
                    alpha_bounds(&data[..need], w as usize, h as usize, stride as usize).and_then(
                        |bounds| {
                            let strip = STRIP.lock().ok().and_then(|g| *g);
                            clip_to_strip(bounds, strip)
                        },
                    )
                else {
                    let tries = EMPTY_TRIES.fetch_add(1, Ordering::SeqCst);
                    if GEN.load(Ordering::SeqCst) == my_gen && tries < 4 {
                        let app_retry = app.clone();
                        glib::timeout_add_local_once(Duration::from_millis(40), move || {
                            if GEN.load(Ordering::SeqCst) == my_gen {
                                snapshot_once(&wv_retry, &app_retry, my_gen, fade_in);
                            }
                        });
                        return Some(());
                    }
                    crate::player::linux_embed::elog(&format!(
                        "overlay: empty snapshot after {} tries fade_in={}",
                        tries + 1,
                        fade_in
                    ));
                    // Never hide an already-visible overlay because a later frame was empty.
                    if !SHOWN.load(Ordering::SeqCst) {
                        hide_now(&app);
                    }
                    return Some(());
                };

                let row_bytes = cw * 4;
                let need_crop = row_bytes * ch;
                let geom = (x as i64, y as i64, cw as i64, ch as i64, row_bytes as i64);
                let geom_changed = GEOM.lock().ok().map(|g| *g != Some(geom)).unwrap_or(true);

                // Keep replacement allocations alive until the synchronous overlay-add below has
                // copied the frame. This also makes the ownership contract explicit if mpv changes
                // how it handles raw-address input in a future build.
                let mut retired_buf: Option<Vec<u8>> = None;
                let mut retired_base: Option<Vec<u8>> = None;
                let addr = {
                    let mut base = BASE.lock().ok()?;
                    let mut buf = BUF.lock().ok()?;
                    if base.len() != need_crop {
                        retired_base = Some(std::mem::replace(&mut *base, vec![0u8; need_crop]));
                    }
                    if buf.len() != need_crop {
                        retired_buf = Some(std::mem::replace(&mut *buf, vec![0u8; need_crop]));
                    }

                    for row in 0..ch {
                        let src_start = (y + row) * stride as usize + x * 4;
                        let src_end = src_start + row_bytes;
                        let dst_start = row * row_bytes;
                        let dst_end = dst_start + row_bytes;
                        base[dst_start..dst_end].copy_from_slice(&data[src_start..src_end]);
                    }
                    if fade_in && ALPHA.load(Ordering::Relaxed) == 0 && raster.as_millis() < 80 {
                        // Fresh show: register the address at alpha 0, then CPU-fade.
                    } else if fade_in {
                        // If the first WebKit raster itself was slow, show the controls at once.
                        // A late fade is worse than an immediate, responsive result.
                        ALPHA.store(OVERLAY_FADE_FULL, Ordering::Relaxed);
                    }
                    scale_premult_bgra(&base, &mut buf, ALPHA.load(Ordering::Relaxed));
                    buf.as_ptr() as usize
                };

                if let Ok(mut g) = GEOM.lock() {
                    *g = Some(geom);
                }
                SHOWN.store(true, Ordering::SeqCst);

                let force = FORCE.swap(false, Ordering::SeqCst);
                // A scrolling comments snapshot has the same alpha bounds on every frame. The old
                // geometry-only gate copied each new raster into BASE but never sent it to mpv, so
                // the visible panel stayed frozen until close/reopen forced a replacement.
                if geom_changed || force || fade_in || FAST.load(Ordering::Relaxed) {
                    let ph = app.try_state::<PlayerHandle>()?;
                    let _ =
                        ph.overlay_add(OVERLAY_ID, geom.0, geom.1, addr, geom.2, geom.3, geom.4);
                }
                if fade_in && ALPHA.load(Ordering::Relaxed) < OVERLAY_FADE_FULL {
                    kick_fade(app.clone(), true);
                }
                drop(retired_buf);
                drop(retired_base);
                Some(())
            };

            let _ = push(res);
            BUSY.store(false, Ordering::SeqCst);

            let n = PROF_N.fetch_add(1, Ordering::Relaxed) + 1;
            if n % 20 == 0 {
                if let Ok(mut last) = PROF_LAST.lock() {
                    let now = Instant::now();
                    let fps =
                        last.map(|t| 20_000.0 / now.duration_since(t).as_millis().max(1) as f64);
                    *last = Some(now);
                    crate::player::linux_embed::elog(&format!(
                        "overlay-prof: raster={}ms proc={}ms ~{:.0}fps fast={}",
                        raster.as_millis(),
                        t_proc.elapsed().as_millis(),
                        fps.unwrap_or(0.0),
                        FAST.load(Ordering::Relaxed),
                    ));
                }
            }
        },
    );
}
