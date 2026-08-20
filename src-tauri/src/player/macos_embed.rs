//! macOS mpv embed: an NSView behind the transparent WKWebView, passed as `--wid`.
//!
//! Windows uses a child HWND; Linux uses a wl_subsurface. macOS `player_embed` used to
//! return Ok without creating a core, so `player_command` immediately failed with
//! "no player" and the overlay spun at 0:00/0:00.

use super::macos_geometry::player_area_points;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{msg_send, ClassType, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSView, NSWindow, NSWindowOrderingMode};
use objc2_foundation::{NSNumber, NSPoint, NSRect, NSSize, NSString};
use std::sync::atomic::{AtomicI32, AtomicIsize, Ordering};
use tauri::{Manager, WebviewWindow};

static MPV_VIEW: AtomicIsize = AtomicIsize::new(0);
static INSET_LEFT: AtomicI32 = AtomicI32::new(0);
static INSET_TOP: AtomicI32 = AtomicI32::new(0);

pub fn wid() -> Result<i64, String> {
    let ptr = MPV_VIEW.load(Ordering::Relaxed);
    if ptr == 0 {
        Err("macOS mpv view is not ready".into())
    } else {
        Ok(ptr as i64)
    }
}

/// Create the host view if needed. Safe on the main thread; from a worker it
/// hops to the main thread and waits (must not be called while already hopping).
pub fn ensure_ready(window: &WebviewWindow) -> Result<i64, String> {
    if let Ok(wid) = wid() {
        return Ok(wid);
    }
    if MainThreadMarker::new().is_some() {
        prepare(window)?;
        return wid();
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let win = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(prepare(&win).and_then(|_| wid()));
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

pub fn set_inset(left: i32, top: i32) {
    INSET_LEFT.store(left.max(0), Ordering::Relaxed);
    INSET_TOP.store(top.max(0), Ordering::Relaxed);
}

pub fn prepare(window: &WebviewWindow) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("AppKit must run on the main thread")?;
    make_webview_transparent(window);
    if MPV_VIEW.load(Ordering::Relaxed) != 0 {
        resize(window);
        return Ok(());
    }
    let ns_window = retain_window(window)?;
    let content = ns_window
        .contentView()
        .ok_or("NSWindow has no contentView")?;
    let bounds = content.bounds();
    let frame = view_frame(window, bounds.size.width, bounds.size.height);
    let view = NSView::initWithFrame(NSView::alloc(mtm), frame);
    view.setWantsLayer(true);
    content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
    MPV_VIEW.store(Retained::as_ptr(&view) as isize, Ordering::Relaxed);
    Ok(())
}

pub fn resize(window: &WebviewWindow) {
    if MainThreadMarker::new().is_none() {
        let w = window.clone();
        let _ = window.run_on_main_thread(move || resize(&w));
        return;
    }
    let ptr = MPV_VIEW.load(Ordering::Relaxed);
    if ptr == 0 {
        return;
    }
    let Ok(ns_window) = retain_window(window) else {
        return;
    };
    let Some(content) = ns_window.contentView() else {
        return;
    };
    let bounds = content.bounds();
    let frame = view_frame(window, bounds.size.width, bounds.size.height);
    let view = ptr as *mut NSView;
    if !view.is_null() {
        unsafe {
            (*view).setFrame(frame);
        }
    }
}

pub fn make_webview_transparent(window: &WebviewWindow) {
    if MainThreadMarker::new().is_none() {
        let w = window.clone();
        let _ = window.run_on_main_thread(move || make_webview_transparent(&w));
        return;
    }
    let _ = window.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));
    let Ok(ns_view) = window.ns_view() else {
        return;
    };
    if ns_view.is_null() {
        return;
    }
    let key = NSString::from_str("drawsBackground");
    let no = NSNumber::new_bool(false);
    let view = ns_view as *mut AnyObject;
    unsafe {
        let _: () = msg_send![&*view, setValue: &*no, forKey: &*key];
    }
}

fn retain_window(window: &WebviewWindow) -> Result<Retained<NSWindow>, String> {
    let raw = window.ns_window().map_err(|e| e.to_string())? as *mut NSWindow;
    unsafe { Retained::retain(raw) }.ok_or_else(|| "NSWindow handle is null".into())
}

fn view_frame(window: &WebviewWindow, content_w: f64, content_h: f64) -> NSRect {
    let scale = window.scale_factor().unwrap_or(1.0);
    let (x, y, w, h) = player_area_points(
        content_w,
        content_h,
        INSET_LEFT.load(Ordering::Relaxed),
        INSET_TOP.load(Ordering::Relaxed),
        scale,
    );
    NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
}

pub fn resize_from_app(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        resize(&window);
    }
}
