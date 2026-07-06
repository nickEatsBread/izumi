//! Game mode (gamescope / XWayland X11) controls-over-video compositor.
//!
//! gamescope will NOT blend a transparent app surface over the video — measured on-device:
//! the app toplevel is a 24-bit (no-alpha) window, gamescope ignores `_NET_WM_WINDOW_OPACITY`
//! on it, and it only alpha-composites its OWN flagged overlay slots (mangoapp/Steam), never
//! an arbitrary client surface. So the Desktop approach (float a transparent webview over the
//! mpv `--wid` child) is impossible here, and the video child is structurally ABOVE the webview
//! content anyway.
//!
//! Instead mpv bakes the controls INTO its own opaque video surface: we snapshot the webview's
//! (transparent-background) HTML controls with `webkit_web_view_get_snapshot` and push each
//! frame to mpv as a premultiplied-BGRA `overlay-add`. mpv composites controls over the video
//! in the one surface gamescope presents. This keeps the wry webview (and every `invoke()` IPC
//! path) — the webview is only a pixel source; the `--wid` container stays input-transparent so
//! taps fall through to the real HTML controls behind the video, keeping visual + hit-target
//! aligned.
//!
//! Cost is the webview snapshot; we run it only while controls are visible, throttled to
//! [`FPS`], driven from the frontend toggling [`start`]/[`stop`].

#![cfg(target_os = "linux")]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use gtk::cairo;
use gtk::glib;
use tauri::{AppHandle, Manager};
use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

use crate::player::PlayerHandle;

/// mpv OSD overlay slot for the controls.
const OVERLAY_ID: i64 = 1;
/// Snapshot cadence while controls are visible. A control bar is low-frequency; this is not a
/// full-screen video readback, so 15 fps is smooth for fades/seekbar ticks without thrashing
/// the Deck iGPU.
const FPS: u64 = 15;

/// Generation guard: each [`start`] bumps this and binds its timer to the new value; a timer
/// stops as soon as it sees a newer generation (superseded by another `start`, or invalidated
/// by [`stop`]). Cleanly handles rapid show/hide toggles without stacking timers.
static GEN: AtomicU64 = AtomicU64::new(0);

/// Persistent premultiplied-BGRA buffer that mpv references each frame (it does NOT copy — see
/// `overlay-add`). Allocated once at the video size and never reallocated, so the pointer handed
/// to mpv stays valid. Only written on the GTK main thread; a torn read by mpv's renderer is at
/// worst one frame of a control bar (imperceptible).
static BUF: Mutex<Vec<u8>> = Mutex::new(Vec::new());

/// Begin snapshotting the webview's controls into an mpv overlay at [`FPS`]. Safe to call again
/// while running (it just supersedes the previous loop).
pub fn start(app: AppHandle, window: tauri::WebviewWindow) {
    let my_gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    // with_webview runs on the GTK main thread — the only place the WebKit view + a glib timer
    // may be touched.
    let _ = window.with_webview(move |pw| {
        let wv = pw.inner(); // webkit2gtk::WebView (owned handle), stays on this thread
        snapshot_once(&wv, &app);
        let app = app.clone();
        glib::timeout_add_local(Duration::from_millis(1000 / FPS), move || {
            if GEN.load(Ordering::SeqCst) != my_gen {
                return glib::ControlFlow::Break;
            }
            snapshot_once(&wv, &app);
            glib::ControlFlow::Continue
        });
    });
}

/// Stop the overlay loop and remove the controls from the video.
pub fn stop(app: AppHandle) {
    GEN.fetch_add(1, Ordering::SeqCst); // invalidate any running timer
    if let Some(ph) = app.try_state::<PlayerHandle>() {
        let _ = ph.overlay_remove(OVERLAY_ID);
    }
}

/// Take one snapshot of the webview and push it to mpv as the controls overlay. Async — the
/// snapshot completes on the GTK main thread, where we convert cairo ARGB32 (native-endian =
/// premultiplied BGRA) directly into mpv's overlay format.
fn snapshot_once(wv: &webkit2gtk::WebView, app: &AppHandle) {
    let app = app.clone();
    wv.snapshot(
        SnapshotRegion::Visible,
        SnapshotOptions::TRANSPARENT_BACKGROUND,
        None::<&gtk::gio::Cancellable>,
        move |res| {
            let Ok(surface) = res else { return };
            let Ok(mut img) = cairo::ImageSurface::try_from(surface) else { return };
            let (w, h, stride) = (img.width() as i64, img.height() as i64, img.stride() as i64);
            if w <= 0 || h <= 0 || stride <= 0 {
                return;
            }
            let need = (stride * h) as usize;
            let addr = {
                let Ok(data) = img.data() else { return };
                let Ok(mut buf) = BUF.lock() else { return };
                if buf.len() != need {
                    buf.clear();
                    buf.resize(need, 0);
                }
                buf.copy_from_slice(&data[..need]);
                buf.as_ptr() as usize
            };
            if let Some(ph) = app.try_state::<PlayerHandle>() {
                let _ = ph.overlay_add(OVERLAY_ID, 0, 0, addr, w, h, stride);
            }
        },
    );
}
