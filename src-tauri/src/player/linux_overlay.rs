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
//! (not a 60fps WebKit loop). Show/hide animates by scaling the already-uploaded BGRA buffer
//! on the CPU — mpv rereads that memory every frame, so the fade costs no extra raster.

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
    scale_premult_bgra, OVERLAY_FADE_FULL, OVERLAY_FADE_MS, OVERLAY_SCRUB_FPS,
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
static LITE: AtomicBool = AtomicBool::new(false);

/// Begin snapshotting the webview controls into an mpv overlay. Safe to call again while
/// running; each call supersedes the previous timer loop. Idle (`fast=false`) takes one
/// snapshot and stops — the control strip does not need 12fps rasters while it is still.
/// The first snapshot after hide fades in on the CPU; later snapshots replace pixels instantly.
pub fn start(
    app: AppHandle,
    window: tauri::WebviewWindow,
    fast: bool,
    crop: Option<(i64, i64, i64, i64)>,
) {
    let fade_in = !SHOWN.swap(true, Ordering::SeqCst);
    let my_gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    FAST.store(fast, Ordering::SeqCst);
    FORCE.store(true, Ordering::SeqCst);
    if let Ok(mut strip) = STRIP.lock() {
        *strip = if fast { None } else { crop };
    }
    hold_lite(&app, true);
    if fade_in {
        FADE_GEN.fetch_add(1, Ordering::SeqCst);
    } else {
        ALPHA.store(OVERLAY_FADE_FULL, Ordering::SeqCst);
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
pub fn stop(app: AppHandle) {
    GEN.fetch_add(1, Ordering::SeqCst);
    FAST.store(false, Ordering::SeqCst);
    SHOWN.store(false, Ordering::SeqCst);
    if let Ok(mut strip) = STRIP.lock() {
        *strip = None;
    }
    let has_pixels = GEOM.lock().ok().and_then(|g| *g).is_some()
        && ALPHA.load(Ordering::SeqCst) > 0;
    if !has_pixels {
        hide_now(&app);
        return;
    }
    kick_fade(app, false);
}

fn hold_lite(app: &AppHandle, on: bool) {
    if LITE.swap(on, Ordering::SeqCst) == on {
        return;
    }
    if let Some(ph) = app.try_state::<PlayerHandle>() {
        ph.set_ui_render_lite(on);
    }
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
    hold_lite(app, false);
    if let Some(ph) = app.try_state::<PlayerHandle>() {
        let _ = ph.overlay_remove(OVERLAY_ID);
    }
}

fn kick_fade(app: AppHandle, fade_in: bool) {
    let gen = FADE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let mut last = Instant::now();
    glib::timeout_add_local(Duration::from_millis(16), move || {
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
        present(&app, false);
        if fade_in && next >= OVERLAY_FADE_FULL {
            return glib::ControlFlow::Break;
        }
        if !fade_in && next == 0 {
            if !SHOWN.load(Ordering::SeqCst) {
                hide_now(&app);
            }
            return glib::ControlFlow::Break;
        }
        glib::ControlFlow::Continue
    });
}

fn present(app: &AppHandle, add: bool) {
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
        // Never realloc here: mpv is already reading BUF. Size changes go through snapshot_once.
        if buf.len() != base.len() {
            return;
        }
        scale_premult_bgra(&base, &mut buf, alpha);
        buf.as_ptr() as usize
    };
    if !add {
        return;
    }
    if let Some(ph) = app.try_state::<PlayerHandle>() {
        let _ = ph.overlay_add(OVERLAY_ID, geom.0, geom.1, addr, geom.2, geom.3, geom.4);
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
                let Some((x, y, cw, ch)) = alpha_bounds(
                    &data[..need],
                    w as usize,
                    h as usize,
                    stride as usize,
                )
                .and_then(|bounds| {
                    let strip = STRIP.lock().ok().and_then(|g| *g);
                    clip_to_strip(bounds, strip)
                }) else {
                    let force = FORCE.swap(false, Ordering::SeqCst);
                    let had_overlay = GEOM.lock().ok().and_then(|mut geom| geom.take()).is_some();
                    if (force || had_overlay) && !fade_in {
                        hide_now(&app);
                    }
                    return Some(());
                };

                let row_bytes = cw * 4;
                let need_crop = row_bytes * ch;
                let geom = (x as i64, y as i64, cw as i64, ch as i64, row_bytes as i64);
                let geom_changed = GEOM.lock().ok().map(|g| *g != Some(geom)).unwrap_or(true);

                // mpv's render thread reads BUF by address until the next overlay-add. Resizing
                // in place could realloc mid-read, so size changes install a fresh allocation
                // and keep the old one alive in `retired` until after overlay_add.
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
                    if fade_in && ALPHA.load(Ordering::Relaxed) == 0 {
                        // First pixel of a show: keep BUF empty until the fade tick writes it,
                        // but register the address with mpv now.
                    } else if !fade_in {
                        ALPHA.store(OVERLAY_FADE_FULL, Ordering::Relaxed);
                    }
                    scale_premult_bgra(&base, &mut buf, ALPHA.load(Ordering::Relaxed));
                    buf.as_ptr() as usize
                };

                if let Ok(mut g) = GEOM.lock() {
                    *g = Some(geom);
                }

                let force = FORCE.swap(false, Ordering::SeqCst);
                if geom_changed || force || fade_in {
                    let ph = app.try_state::<PlayerHandle>()?;
                    let _ =
                        ph.overlay_add(OVERLAY_ID, geom.0, geom.1, addr, geom.2, geom.3, geom.4);
                }
                if fade_in {
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
