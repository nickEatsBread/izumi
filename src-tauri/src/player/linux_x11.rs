//! Game mode (gamescope / XWayland X11) mpv container.
//!
//! Under gamescope the app is an X11 client and there is NO wl_subsurface + NO transparent
//! compositing, so the Desktop transparent-overlay design can't work (a transparent webview
//! over the video renders black). Instead mpv `--wid`-embeds into a raw X11 CHILD window (the
//! "container") that WE own, RAISED above the webview and INPUT-TRANSPARENT (empty X shape
//! input region) so touch/pointer events fall through to the webview beneath it.
//!
//! Controls-and-video-at-once is achieved by DOCKING, not swapping: [`dock_video`] SHRINKS
//! the container to leave a strip at the bottom of the screen uncovered, so the webview's
//! (opaque) HTML control bar shows in that strip while the video keeps playing in the region
//! above. `frac`=0 restores the container to fullscreen (controls hidden → edge-to-edge video).
//! No map/unmap, no black swap — both are visible simultaneously.
//!
//! All X calls run on the GTK main thread (Xlib is used by GTK on the same connection).

#![cfg(target_os = "linux")]

use std::ffi::c_void;
use std::sync::Mutex;

use raw_window_handle::{HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle};

// Explicit #[link] so libX11/libXext are pulled in for OUR symbols — gtk links them
// transitively but `-Wl,--as-needed` drops them, so the Flatpak link fails without this.
#[allow(non_snake_case)]
#[link(name = "X11")]
extern "C" {
    fn XCreateSimpleWindow(
        dpy: *mut c_void, parent: u64, x: i32, y: i32, w: u32, h: u32, bw: u32,
        border: u64, background: u64,
    ) -> u64;
    fn XDestroyWindow(dpy: *mut c_void, w: u64) -> i32;
    fn XMapWindow(dpy: *mut c_void, w: u64) -> i32;
    fn XMoveResizeWindow(dpy: *mut c_void, w: u64, x: i32, y: i32, width: u32, height: u32) -> i32;
    fn XRaiseWindow(dpy: *mut c_void, w: u64) -> i32;
    fn XFlush(dpy: *mut c_void) -> i32;
    fn XSync(dpy: *mut c_void, discard: i32) -> i32;
}

// libXext (shape extension). ShapeInput = 2, ShapeSet = 0.
#[allow(non_snake_case)]
#[link(name = "Xext")]
extern "C" {
    fn XShapeCombineRectangles(
        dpy: *mut c_void, w: u64, kind: i32, x: i32, y: i32, rects: *const c_void,
        n_rects: i32, op: i32, ordering: i32,
    );
}
const SHAPE_INPUT: i32 = 2;
const SHAPE_SET: i32 = 0;

struct X11 {
    dpy: *mut c_void,
    container: u64,
    // Full window size (physical px) and the current dock fraction (0 = fullscreen video,
    // >0 = leave the bottom `frac` of the height uncovered for the HTML control bar).
    w: u32,
    h: u32,
    frac: f64,
}
// SAFETY: the display pointer is GTK's X connection; all uses are dispatched to the GTK
// main thread (GTK calls XInitThreads, and we serialize via run_on_glib_main).
unsafe impl Send for X11 {}

impl X11 {
    /// Container height for the current dock fraction (>=1).
    fn video_h(&self) -> u32 {
        let bar = (self.h as f64 * self.frac).round() as u32;
        self.h.saturating_sub(bar).max(1)
    }
}

static STATE: Mutex<Option<X11>> = Mutex::new(None);

fn raw_x11(win: &tauri::WebviewWindow) -> Result<(*mut c_void, u64), String> {
    let rw = win
        .window_handle()
        .map_err(|e| format!("window handle: {e:?}"))?
        .as_raw();
    let rd = win
        .display_handle()
        .map_err(|e| format!("display handle: {e:?}"))?
        .as_raw();
    let parent = match rw {
        RawWindowHandle::Xlib(h) => h.window,
        RawWindowHandle::Xcb(h) => h.window.get() as u64,
        _ => return Err("not an X11 window".into()),
    };
    let dpy = match rd {
        RawDisplayHandle::Xlib(h) => h.display.ok_or("no X display")?.as_ptr(),
        _ => return Err("not an Xlib display (need Xlib for --wid container)".into()),
    };
    Ok((dpy, parent))
}

/// Create (once) the mpv container: a raw X11 child of the app's toplevel, fullscreen-sized,
/// input-transparent (touch falls through to the webview). Returns its X11 window id for
/// mpv `--wid`. Idempotent — returns the existing container's id if already created.
pub fn ensure_container(window: &tauri::WebviewWindow, w: u32, h: u32) -> Result<i64, String> {
    if let Some(st) = STATE.lock().map_err(|e| e.to_string())?.as_ref() {
        return Ok(st.container as i64);
    }
    let win = window.clone();
    crate::player::linux_embed::run_on_glib_main(move || -> Result<i64, String> {
        let (dpy, parent) = raw_x11(&win)?;
        let (w, h) = (w.max(1), h.max(1));
        // SAFETY: valid X display + parent window (GTK's). Border/bg = 0 (black).
        let container = unsafe { XCreateSimpleWindow(dpy, parent, 0, 0, w, h, 0, 0, 0) };
        if container == 0 {
            return Err("XCreateSimpleWindow failed".into());
        }
        unsafe {
            // Empty INPUT shape → pointer/touch pass through to the webview below.
            XShapeCombineRectangles(dpy, container, SHAPE_INPUT, 0, 0, std::ptr::null(), 0, SHAPE_SET, 0);
            XMapWindow(dpy, container);
            XRaiseWindow(dpy, container);
            XSync(dpy, 0);
        }
        *STATE.lock().map_err(|e| e.to_string())? = Some(X11 { dpy, container, w, h, frac: 0.0 });
        crate::player::linux_embed::elog(&format!("x11: container {container} created {w}x{h}"));
        Ok(container as i64)
    })
}

/// Dock the video: shrink the container to leave the bottom `frac` of the screen height
/// uncovered so the webview's HTML control bar shows there, with video still playing above.
/// `frac`=0 restores fullscreen video (controls hidden). Superseded by the layer-shell overlay
/// (linux_embed); kept only for the degraded XWayland fallback path.
#[allow(dead_code)]
pub fn dock_video(frac: f64) {
    let frac = frac.clamp(0.0, 0.9);
    crate::player::linux_embed::run_on_glib_main(move || {
        if let Ok(mut g) = STATE.lock() {
            if let Some(st) = g.as_mut() {
                st.frac = frac;
                let vh = st.video_h();
                unsafe {
                    XMoveResizeWindow(st.dpy, st.container, 0, 0, st.w.max(1), vh);
                    XRaiseWindow(st.dpy, st.container);
                    XFlush(st.dpy);
                }
            }
        }
    });
}

/// Resize the container to a new full-window size (call on window-size changes), preserving
/// the current dock fraction. Kept for a resize hook; gamescope windows are fixed-fullscreen.
#[allow(dead_code)]
pub fn resize_container(w: u32, h: u32) {
    crate::player::linux_embed::run_on_glib_main(move || {
        if let Ok(mut g) = STATE.lock() {
            if let Some(st) = g.as_mut() {
                st.w = w.max(1);
                st.h = h.max(1);
                let vh = st.video_h();
                unsafe {
                    XMoveResizeWindow(st.dpy, st.container, 0, 0, st.w, vh);
                    XRaiseWindow(st.dpy, st.container);
                    XFlush(st.dpy);
                }
            }
        }
    });
}

/// Destroy the container on player close.
pub fn destroy_container() {
    let taken = STATE.lock().ok().and_then(|mut g| g.take());
    if let Some(st) = taken {
        crate::player::linux_embed::run_on_glib_main(move || {
            // Bind the whole `st` so the closure captures the Send `X11`, not the !Send
            // `st.dpy` raw pointer (RFC 2229 disjoint capture would otherwise pick the field).
            let st = st;
            unsafe {
                XDestroyWindow(st.dpy, st.container);
                XFlush(st.dpy);
            }
        });
    }
}
