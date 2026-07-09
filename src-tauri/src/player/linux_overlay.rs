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
//! Snapshotting runs only while controls are visible. The cadence is low while the controls are
//! idle and faster only while the seekbar is actively being scrubbed. Completed snapshots are
//! cropped to the non-transparent bounds before being handed to mpv, which avoids uploading a
//! full viewport of transparent pixels for a bottom control bar.

#![cfg(target_os = "linux")]

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use gtk::cairo;
use gtk::glib;
use tauri::{AppHandle, Manager};
use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

use crate::player::PlayerHandle;

const OVERLAY_ID: i64 = 1;
const IDLE_FPS: u64 = 12;
// "Fast" cadence used while a menu is open / controls are interactive. A snapshot costs only
// ~9ms (raster ~5ms + crop/diff ~4ms) on the Deck, so 60fps fits the 16ms budget — 30fps made
// controller menu navigation feel laggy (~33ms per d-pad step).
const SCRUB_FPS: u64 = 60;

static GEN: AtomicU64 = AtomicU64::new(0);
static BUSY: AtomicBool = AtomicBool::new(false);
static FAST: AtomicBool = AtomicBool::new(false);
static FORCE: AtomicBool = AtomicBool::new(false);

static PROF_N: AtomicU64 = AtomicU64::new(0);
static PROF_LAST: Mutex<Option<Instant>> = Mutex::new(None);

/// Persistent premultiplied-BGRA crop buffer. mpv reads this memory by address.
static BUF: Mutex<Vec<u8>> = Mutex::new(Vec::new());
/// Last uploaded crop geometry: x, y, width, height, stride.
static GEOM: Mutex<Option<(i64, i64, i64, i64, i64)>> = Mutex::new(None);

/// Begin snapshotting the webview controls into an mpv overlay. Safe to call again while
/// running; each call supersedes the previous timer loop.
pub fn start(app: AppHandle, window: tauri::WebviewWindow, fast: bool) {
    let my_gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    FAST.store(fast, Ordering::SeqCst);
    FORCE.store(true, Ordering::SeqCst);

    let _ = window.with_webview(move |pw| {
        let wv = pw.inner();
        BUSY.store(true, Ordering::SeqCst);
        snapshot_once(&wv, &app);

        let app = app.clone();
        let mut last_tick = Instant::now();
        glib::timeout_add_local(Duration::from_millis(1000 / SCRUB_FPS), move || {
            if GEN.load(Ordering::SeqCst) != my_gen {
                return glib::ControlFlow::Break;
            }

            let fps = if FAST.load(Ordering::Relaxed) { SCRUB_FPS } else { IDLE_FPS };
            let interval = Duration::from_millis(1000 / fps);
            let now = Instant::now();
            if now.duration_since(last_tick) < interval {
                return glib::ControlFlow::Continue;
            }

            // Never queue a second WebKit snapshot behind a slow one; the loop self-paces to
            // what the Deck can actually raster.
            if !BUSY.swap(true, Ordering::SeqCst) {
                last_tick = now;
                snapshot_once(&wv, &app);
            }
            glib::ControlFlow::Continue
        });
    });
}

/// Stop the overlay loop and remove the controls from the video.
pub fn stop(app: AppHandle) {
    GEN.fetch_add(1, Ordering::SeqCst);
    FAST.store(false, Ordering::SeqCst);
    if let Ok(mut geom) = GEOM.lock() {
        *geom = None;
    }
    if let Some(ph) = app.try_state::<PlayerHandle>() {
        let _ = ph.overlay_remove(OVERLAY_ID);
    }
}

fn alpha_bounds(data: &[u8], w: usize, h: usize, stride: usize) -> Option<(usize, usize, usize, usize)> {
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
fn snapshot_once(wv: &webkit2gtk::WebView, app: &AppHandle) {
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
                let surface = res.ok()?;
                let mut img = cairo::ImageSurface::try_from(surface).ok()?;
                let (w, h, stride) = (img.width() as i64, img.height() as i64, img.stride() as i64);
                if w <= 0 || h <= 0 || stride <= 0 {
                    return None;
                }

                let need = (stride * h) as usize;
                let data = img.data().ok()?;
                let Some((x, y, cw, ch)) =
                    alpha_bounds(&data[..need], w as usize, h as usize, stride as usize)
                else {
                    let force = FORCE.swap(false, Ordering::SeqCst);
                    let had_overlay = GEOM.lock().ok().and_then(|mut geom| geom.take()).is_some();
                    if force || had_overlay {
                        let ph = app.try_state::<PlayerHandle>()?;
                        let _ = ph.overlay_remove(OVERLAY_ID);
                    }
                    return Some(());
                };

                let row_bytes = cw * 4;
                let need_crop = row_bytes * ch;
                let geom = (x as i64, y as i64, cw as i64, ch as i64, row_bytes as i64);
                let geom_changed = GEOM.lock().ok().map(|g| *g != Some(geom)).unwrap_or(true);

                let (addr, changed) = {
                    let mut buf = BUF.lock().ok()?;
                    let mut changed = buf.len() != need_crop || geom_changed;
                    if buf.len() != need_crop {
                        buf.clear();
                        buf.resize(need_crop, 0);
                    }

                    for row in 0..ch {
                        let src_start = (y + row) * stride as usize + x * 4;
                        let src_end = src_start + row_bytes;
                        let dst_start = row * row_bytes;
                        let dst_end = dst_start + row_bytes;

                        if !changed && buf[dst_start..dst_end] != data[src_start..src_end] {
                            changed = true;
                        }
                        if changed {
                            buf[dst_start..dst_end].copy_from_slice(&data[src_start..src_end]);
                        }
                    }
                    (buf.as_ptr() as usize, changed)
                };

                if geom_changed {
                    if let Ok(mut g) = GEOM.lock() {
                        *g = Some(geom);
                    }
                }

                let force = FORCE.swap(false, Ordering::SeqCst);
                if changed || geom_changed || force {
                    let ph = app.try_state::<PlayerHandle>()?;
                    let _ = ph.overlay_add(OVERLAY_ID, geom.0, geom.1, addr, geom.2, geom.3, geom.4);
                }
                Some(())
            };

            let _ = push(res);
            BUSY.store(false, Ordering::SeqCst);

            let n = PROF_N.fetch_add(1, Ordering::Relaxed) + 1;
            if n % 20 == 0 {
                if let Ok(mut last) = PROF_LAST.lock() {
                    let now = Instant::now();
                    let fps = last.map(|t| 20_000.0 / now.duration_since(t).as_millis().max(1) as f64);
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
