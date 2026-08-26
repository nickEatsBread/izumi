//! macOS mpv embed: an NSOpenGLView behind the transparent WKWebView, driven by
//! `vo=libmpv` and the OpenGL render API.
//!
//! Windows uses a child HWND + `--wid`. cocoa-cb `--wid` does **not** do that:
//! mpv creates its own NSWindow and parents it, so playback "launches MPV as a
//! window" beside Izumi. Harbor and IINA use this render-API shape instead.
//!
//! AppKit + the GL context live on the main thread. `player_embed` is an async
//! Tauri command (worker pool), so [`on_main`] / [`run_on_appkit`] hop there.
//! Do not call [`attach`] while holding `PlayerHandle`'s mpv mutex.
//!
//! NSOpenGLView is deprecated in favor of Metal; izumi's bundled libmpv has no
//! MoltenVK, so the OpenGL render API is the working embed path.

#![allow(deprecated)]

use super::macos_geometry::player_area_points;
use libmpv2::{
    render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType},
    Mpv,
};
use objc2::exception::catch as catch_objc;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Sel};
use objc2::{msg_send, AnyThread, ClassType, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSOpenGLPixelFormat, NSOpenGLView, NSView, NSWindow, NSWindowOrderingMode};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::ffi::{c_char, c_void, CString};
use std::io::Write;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Mutex;
use tauri::{Manager, WebviewWindow};

const NSOPENGLPFA_OPENGL_PROFILE: u32 = 99;
const NSOPENGLPFA_DOUBLEBUFFER: u32 = 5;
const NSOPENGLPFA_COLOR_SIZE: u32 = 8;
const NSOPENGLPFA_COLOR_FLOAT: u32 = 58;
const NSOPENGLPFA_DEPTH_SIZE: u32 = 12;
const NSOPENGLPFA_ACCELERATED: u32 = 73;
const NSOPENGLPFA_NO_RECOVERY: u32 = 72;
const NSOPENGL_PROFILE_VERSION_3_2_CORE: u32 = 0x3200;
const NSOPENGL_CONTEXT_PARAM_SURFACE_OPACITY: i32 = 236;

extern "C" {
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    fn dispatch_async_f(queue: *mut c_void, ctx: *mut c_void, work: extern "C" fn(*mut c_void));
    fn dispatch_sync_f(queue: *mut c_void, ctx: *mut c_void, work: extern "C" fn(*mut c_void));
    fn dispatch_after_f(
        when: u64,
        queue: *mut c_void,
        ctx: *mut c_void,
        work: extern "C" fn(*mut c_void),
    );
    fn dispatch_time(when: u64, delta: i64) -> u64;
    static _dispatch_main_q: c_void;
}

const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;
const DISPATCH_TIME_NOW: u64 = 0;
const NS_VIEW_WIDTH_SIZABLE: usize = 2;
const NS_VIEW_HEIGHT_SIZABLE: usize = 16;

fn main_queue() -> *mut c_void {
    unsafe { (&_dispatch_main_q as *const c_void) as *mut c_void }
}

static INSET_LEFT: AtomicI32 = AtomicI32::new(0);
static INSET_TOP: AtomicI32 = AtomicI32::new(0);
static REDRAW_PENDING: AtomicBool = AtomicBool::new(false);
/// Target native-fullscreen layout. `set_fullscreen` animates, so `is_fullscreen()`
/// and the frontend inset `$effect` lag the GL view by hundreds of ms.
static FULLSCREEN_LAYOUT: AtomicBool = AtomicBool::new(false);

struct Embed {
    view: Retained<NSOpenGLView>,
    render: RenderContext<'static>,
}

// SAFETY: every path that touches AppKit or the GL context first hops to the
// main thread. The mutex serializes access to the process-global slot.
unsafe impl Send for Embed {}

static EMBED: Mutex<Option<Embed>> = Mutex::new(None);

type AppKitJob = Box<dyn FnOnce() + Send>;

fn run_on_appkit<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    if MainThreadMarker::new().is_some() {
        return Ok(f());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let job: Box<AppKitJob> = Box::new(Box::new(move || {
        let _ = tx.send(f());
    }));
    extern "C" fn trampoline(ctx: *mut c_void) {
        let job = unsafe { Box::from_raw(ctx as *mut AppKitJob) };
        (*job)();
    }
    unsafe {
        dispatch_sync_f(main_queue(), Box::into_raw(job) as *mut c_void, trampoline);
    }
    rx.recv().map_err(|e| e.to_string())
}

/// Run `f` on the AppKit main thread. No-ops the hop when already there.
/// Must not be called while holding `PlayerHandle`'s mpv mutex: a sync Tauri
/// command on main that locks the same mutex would deadlock.
pub fn on_main<T, F>(window: &WebviewWindow, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    if MainThreadMarker::new().is_some() {
        return Ok(f());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(f());
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}

pub fn set_inset(left: i32, top: i32) {
    INSET_LEFT.store(left.max(0), Ordering::Relaxed);
    INSET_TOP.store(top.max(0), Ordering::Relaxed);
}

/// Call before `NSWindow.set_fullscreen` so in-flight Resized events drop the
/// sidebar inset (enter) or restore it (exit) instead of painting a letterbox.
pub fn set_layout_fullscreen(on: bool) {
    FULLSCREEN_LAYOUT.store(on, Ordering::Relaxed);
}

/// Refit the GL view and hand key events back to WKWebView. Native fullscreen
/// finishes *after* the Tauri command returns and steals first responder at
/// the end of the animation, so we retry across that window.
pub fn sync_after_chrome_change(window: &WebviewWindow) {
    let _ = window.set_focus();
    resize(window);
    refocus_webview(window);
    for delay_ms in [16_u64, 80, 200, 450, 700] {
        let w = window.clone();
        schedule_after(delay_ms, move || {
            let _ = w.set_focus();
            resize(&w);
            refocus_webview(&w);
        });
    }
}

fn schedule_after(delay_ms: u64, f: impl FnOnce() + Send + 'static) {
    let job: Box<AppKitJob> = Box::new(Box::new(f));
    extern "C" fn trampoline(ctx: *mut c_void) {
        let job = unsafe { Box::from_raw(ctx as *mut AppKitJob) };
        (*job)();
    }
    let when = unsafe { dispatch_time(DISPATCH_TIME_NOW, (delay_ms as i64) * 1_000_000) };
    unsafe {
        dispatch_after_f(
            when,
            main_queue(),
            Box::into_raw(job) as *mut c_void,
            trampoline,
        );
    }
}

/// Bind `mpv`'s render context to an NSOpenGLView below the webview.
/// `mpv` is borrowed only for this blocking call; the caller then stores it.
pub fn attach(mpv: &Mpv, window: &WebviewWindow) -> Result<(), String> {
    if EMBED.lock().ok().is_some_and(|g| g.is_some()) {
        return Ok(());
    }
    make_webview_transparent(window);
    let mpv_usize = (mpv as *const Mpv) as usize;
    let hop = window.clone();
    let win = window.clone();
    on_main(&hop, move || attach_on_main(mpv_usize, &win))?
}

fn attach_on_main(mpv_usize: usize, window: &WebviewWindow) -> Result<(), String> {
    if EMBED.lock().ok().is_some_and(|g| g.is_some()) {
        return Ok(());
    }
    let mtm = MainThreadMarker::new().ok_or("AppKit must run on the main thread")?;
    // SAFETY: caller’s `&Mpv` outlives this blocking hop.
    let mpv: &Mpv = unsafe { &*(mpv_usize as *const Mpv) };

    let view = match catch_objc(AssertUnwindSafe(|| create_gl_view(window, mtm))) {
        Ok(inner) => inner?,
        Err(ex) => {
            return Err(format!(
                "AppKit exception while creating the video view: {ex:?}"
            ))
        }
    };

    let gl_ctx = view
        .openGLContext()
        .ok_or_else(|| "NSOpenGLView has no OpenGL context".to_string())?;
    gl_ctx.makeCurrentContext();
    let opaque_value: i32 = 1;
    let _: () = unsafe {
        msg_send![
            &*gl_ctx,
            setValues: &opaque_value,
            forParameter: NSOPENGL_CONTEXT_PARAM_SURFACE_OPACITY
        ]
    };

    let render_ctx = mpv
        .create_render_context::<*mut c_void>(vec![
            RenderParam::ApiType(RenderParamApiType::OpenGl),
            RenderParam::InitParams(OpenGLInitParams {
                get_proc_address,
                ctx: std::ptr::null_mut::<c_void>(),
            }),
        ])
        .map_err(|e| format!("mpv_render_context_create: {e}"))?;
    // SAFETY: PlayerHandle owns the core and `stop()` calls `detach` (which
    // drops this context) before quitting/dropping the core.
    let mut render_ctx: RenderContext<'static> = unsafe { std::mem::transmute(render_ctx) };
    render_ctx.set_update_callback(|| {
        schedule_redraw();
    });

    *EMBED.lock().map_err(|e| e.to_string())? = Some(Embed {
        view,
        render: render_ctx,
    });
    refocus_webview(window);
    schedule_redraw();
    Ok(())
}

fn make_pixel_format(float: bool) -> Option<Retained<NSOpenGLPixelFormat>> {
    let attrs: [u32; 16] = if float {
        [
            NSOPENGLPFA_OPENGL_PROFILE,
            NSOPENGL_PROFILE_VERSION_3_2_CORE,
            NSOPENGLPFA_DOUBLEBUFFER,
            1,
            NSOPENGLPFA_ACCELERATED,
            1,
            NSOPENGLPFA_NO_RECOVERY,
            1,
            NSOPENGLPFA_COLOR_FLOAT,
            1,
            NSOPENGLPFA_COLOR_SIZE,
            64,
            NSOPENGLPFA_DEPTH_SIZE,
            16,
            0,
            0,
        ]
    } else {
        [
            NSOPENGLPFA_OPENGL_PROFILE,
            NSOPENGL_PROFILE_VERSION_3_2_CORE,
            NSOPENGLPFA_DOUBLEBUFFER,
            1,
            NSOPENGLPFA_ACCELERATED,
            1,
            NSOPENGLPFA_NO_RECOVERY,
            1,
            NSOPENGLPFA_COLOR_SIZE,
            24,
            NSOPENGLPFA_DEPTH_SIZE,
            16,
            0,
            0,
            0,
            0,
        ]
    };
    let pf_alloc = NSOpenGLPixelFormat::alloc();
    unsafe { msg_send![pf_alloc, initWithAttributes: attrs.as_ptr()] }
}

fn create_gl_view(
    window: &WebviewWindow,
    mtm: MainThreadMarker,
) -> Result<Retained<NSOpenGLView>, String> {
    let ns_window = retain_window(window)?;
    let content = ns_window
        .contentView()
        .ok_or("NSWindow has no contentView")?;
    let bounds = content.bounds();
    let frame = view_frame(window, bounds.size.width, bounds.size.height);

    // Prefer a float/EDR pixel format so 10-bit HDR anime is not truncated to
    // 8-bit before dither. Fall back to 24-bit SDR if the GPU refuses float.
    let (pf, edr) = match make_pixel_format(true) {
        Some(pf) => (pf, true),
        None => (
            make_pixel_format(false)
                .ok_or_else(|| "NSOpenGLPixelFormat init failed".to_string())?,
            false,
        ),
    };

    let view_alloc = NSOpenGLView::alloc(mtm);
    let view: Option<Retained<NSOpenGLView>> = unsafe {
        msg_send![
            view_alloc,
            initWithFrame: frame,
            pixelFormat: &*pf
        ]
    };
    let view = view.ok_or_else(|| "NSOpenGLView init failed".to_string())?;
    let view_as_view: &NSView = view.as_super();
    let _: () = unsafe { msg_send![&*view, setWantsBestResolutionOpenGLSurface: true] };
    if edr {
        let _: () = unsafe { msg_send![&*view, setWantsExtendedDynamicRangeOpenGLSurface: true] };
    }
    // Do NOT call setWantsLayer(true) or attach an extra CALayer. A painted
    // black layer is what AppKit composites, so mpv's framebuffer never
    // appears — audio plays, the surface stays black. macOS 26 still
    // force-layers NSOpenGLView (`_NSOpenGLViewBackingLayer`); that layer
    // *is* the CGL surface and must stay opaque.
    // Width/height-sizable so the surface tracks native fullscreen animation
    // even when a Resized event is late or missing.
    let mask: usize = NS_VIEW_WIDTH_SIZABLE | NS_VIEW_HEIGHT_SIZABLE;
    let _: () = unsafe { msg_send![view_as_view, setAutoresizingMask: mask] };
    unsafe {
        let layer: *mut AnyObject = msg_send![view_as_view, layer];
        if !layer.is_null() {
            let _: () = msg_send![&*layer, setOpaque: true];
        }
    }

    let (parent, relative) = host_parent(&content);
    parent.addSubview_positioned_relativeTo(
        view_as_view,
        NSWindowOrderingMode::Below,
        relative.as_deref(),
    );
    elog(&format!(
        "attach gl={} parent={} relative={}",
        class_name(view_as_view as *const NSView as *mut AnyObject),
        class_name(Retained::as_ptr(&parent) as *mut AnyObject),
        relative
            .as_ref()
            .map(|v| class_name(Retained::as_ptr(v) as *mut AnyObject))
            .unwrap_or_else(|| "nil".into()),
    ));
    Ok(view)
}

/// Tear down the GL view + render context on the AppKit thread. MUST run
/// before the mpv core is quit/dropped.
pub fn detach() {
    FULLSCREEN_LAYOUT.store(false, Ordering::Relaxed);
    let _ = run_on_appkit(|| {
        let embed = EMBED.lock().ok().and_then(|mut g| g.take());
        if let Some(embed) = embed {
            teardown_embed(embed);
        }
    });
}

fn teardown_embed(embed: Embed) {
    let view_as_view: &NSView = embed.view.as_super();
    view_as_view.removeFromSuperview();
}

pub fn resize(window: &WebviewWindow) {
    if MainThreadMarker::new().is_none() {
        let w = window.clone();
        let _ = window.run_on_main_thread(move || resize(&w));
        return;
    }
    let Ok(guard) = EMBED.lock() else {
        return;
    };
    let Some(embed) = guard.as_ref() else {
        return;
    };
    let Ok(ns_window) = retain_window(window) else {
        return;
    };
    let Some(content) = ns_window.contentView() else {
        return;
    };
    let view_as_view: &NSView = embed.view.as_super();
    // Prefer the window that actually hosts the GL view — native fullscreen can
    // present a different NSWindow than Tauri's handle during the transition.
    let bounds = view_as_view
        .window()
        .and_then(|w| w.contentView())
        .map(|cv| cv.bounds())
        .unwrap_or(content.bounds());
    let frame = view_frame(window, bounds.size.width, bounds.size.height);
    view_as_view.setFrame(frame);
    let mask: usize = NS_VIEW_WIDTH_SIZABLE | NS_VIEW_HEIGHT_SIZABLE;
    let _: () = unsafe { msg_send![view_as_view, setAutoresizingMask: mask] };
    if let Some(gl_ctx) = embed.view.openGLContext() {
        let _: () = unsafe { msg_send![&*gl_ctx, update] };
    }
    drop(guard);
    make_webview_transparent(window);
    schedule_redraw();
}

pub fn make_webview_transparent(window: &WebviewWindow) {
    if MainThreadMarker::new().is_none() {
        let w = window.clone();
        let _ = window.run_on_main_thread(move || make_webview_transparent(&w));
        return;
    }
    let _ = window.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));
    let Ok(ns_window) = retain_window(window) else {
        return;
    };
    let _ = unsafe {
        catch_objc(AssertUnwindSafe(|| {
            if let Some(nscolor) = AnyClass::get(c"NSColor") {
                let black: *mut AnyObject = msg_send![nscolor, blackColor];
                if !black.is_null() {
                    let _: () = msg_send![&*ns_window, setBackgroundColor: &*black];
                }
            }
        }))
    };
    // Walk the content view (WryWebViewParent) so we punch WryWebView even
    // when ns_view() is the parent wrapper. apply_clear_background skips
    // NSOpenGLView so we do not make the CGL surface transparent.
    let Some(content) = ns_window.contentView() else {
        return;
    };
    let content_ptr = Retained::as_ptr(&content) as *mut AnyObject;
    let _ = unsafe {
        catch_objc(AssertUnwindSafe(|| {
            visit_nsview(content_ptr, 8, &mut apply_clear_background);
        }))
    };
}

/// Restore WKWebView as first responder so player hotkeys reach JS.
/// Native fullscreen (and the NSOpenGLView) otherwise steal the key window.
pub fn refocus_webview(window: &WebviewWindow) {
    if MainThreadMarker::new().is_none() {
        let w = window.clone();
        let _ = window.run_on_main_thread(move || refocus_webview(&w));
        return;
    }
    let Ok(ns_window) = retain_window(window) else {
        return;
    };
    let Some(content) = ns_window.contentView() else {
        return;
    };
    let content_ptr = Retained::as_ptr(&content) as *mut AnyObject;
    let mut target = content_ptr;
    visit_nsview(content_ptr, 8, &mut |view| {
        if is_wk_webview(view) {
            target = view;
        }
    });
    let _ = unsafe {
        catch_objc(AssertUnwindSafe(|| {
            let _: () = msg_send![&*ns_window, makeKeyWindow];
            let _: bool = msg_send![&*ns_window, makeFirstResponder: &*target];
        }))
    };
}

fn apply_clear_background(view: *mut AnyObject) {
    if view.is_null() || class_name_contains(view, "NSOpenGL") {
        return;
    }
    // Only the webview subtree. Clearing NSOpenGLView's forced backing layer
    // hides mpv's framebuffer (audio plays, picture stays black).
    let punch = is_wk_webview(view) || class_name_contains(view, "WK");
    if !punch {
        return;
    }
    unsafe {
        let layer: *mut AnyObject = msg_send![&*view, layer];
        if !layer.is_null() {
            let _: () = msg_send![&*layer, setOpaque: false];
            if let Some(nscolor) = AnyClass::get(c"NSColor") {
                let clear: *mut AnyObject = msg_send![nscolor, clearColor];
                if !clear.is_null() {
                    let cg: *const c_void = msg_send![&*clear, CGColor];
                    let _: () = msg_send![&*layer, setBackgroundColor: cg];
                }
            }
        }
        let sel_under = objc2::sel!(setUnderPageBackgroundColor:);
        let responds: bool = msg_send![&*view, respondsToSelector: sel_under];
        if responds {
            if let Some(nscolor) = AnyClass::get(c"NSColor") {
                let clear: *mut AnyObject = msg_send![nscolor, clearColor];
                if !clear.is_null() {
                    let _: () = msg_send![&*view, setUnderPageBackgroundColor: &*clear];
                }
            }
        }
        // macOS 26: `setDrawsBackground:` is gone and KVC of that name aborts.
        // `_setDrawsBackground:` still exists (probed on 26.5.1) and is what
        // actually makes WKWebView isOpaque=false so the NSOpenGLView shows.
        call_bool_setter(view, objc2::sel!(_setDrawsBackground:), false);
        call_bool_setter(view, objc2::sel!(setOpaque:), false);
    }
}

fn call_bool_setter(view: *mut AnyObject, sel: Sel, value: bool) {
    if view.is_null() {
        return;
    }
    unsafe {
        let responds: bool = msg_send![&*view, respondsToSelector: sel];
        if !responds {
            return;
        }
        let imp: *mut c_void = msg_send![&*view, methodForSelector: sel];
        if imp.is_null() {
            return;
        }
        let f: unsafe extern "C" fn(*mut AnyObject, Sel, bool) = std::mem::transmute(imp);
        f(view, sel, value);
    }
}

fn class_name(view: *mut AnyObject) -> String {
    if view.is_null() {
        return "null".into();
    }
    unsafe {
        let name: *mut AnyObject = msg_send![&*view, className];
        if name.is_null() {
            return "null".into();
        }
        let utf8: *const c_char = msg_send![&*name, UTF8String];
        if utf8.is_null() {
            return "null".into();
        }
        std::ffi::CStr::from_ptr(utf8)
            .to_str()
            .unwrap_or("invalid")
            .to_string()
    }
}

fn class_name_contains(view: *mut AnyObject, needle: &str) -> bool {
    class_name(view).contains(needle)
}

/// wry's WKWebView subclass is `WryWebView0.xx`, not `WKWebView`.
fn is_wk_webview(view: *mut AnyObject) -> bool {
    if class_name_contains(view, "Parent") {
        return false;
    }
    class_name_contains(view, "WKWebView") || class_name_contains(view, "WryWebView")
}

fn elog(msg: &str) {
    eprintln!("[izumi-macos] {msg}");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/izumi-embed.log")
    {
        let _ = writeln!(f, "{msg}");
    }
}

fn visit_nsview(view: *mut AnyObject, depth: u8, f: &mut impl FnMut(*mut AnyObject)) {
    if view.is_null() || depth == 0 {
        return;
    }
    f(view);
    unsafe {
        let sel = objc2::sel!(subviews);
        let responds: bool = msg_send![&*view, respondsToSelector: sel];
        if !responds {
            return;
        }
        let subviews: *mut AnyObject = msg_send![&*view, subviews];
        if subviews.is_null() {
            return;
        }
        let count: usize = msg_send![&*subviews, count];
        for i in 0..count.min(16) {
            let child: *mut AnyObject = msg_send![&*subviews, objectAtIndex: i];
            visit_nsview(child, depth - 1, f);
        }
    }
}

fn host_parent(content: &Retained<NSView>) -> (Retained<NSView>, Option<Retained<NSView>>) {
    let content_ptr = Retained::as_ptr(content) as *mut AnyObject;
    let mut found = std::ptr::null_mut::<AnyObject>();
    visit_nsview(content_ptr, 8, &mut |view| {
        if is_wk_webview(view) {
            found = view;
        }
    });
    if found.is_null() {
        return (content.clone(), None);
    }
    let Some(wv) = (unsafe { Retained::retain(found as *mut NSView) }) else {
        return (content.clone(), None);
    };
    if Retained::as_ptr(&wv) == Retained::as_ptr(content) {
        // WKWebView *is* the content view; a sibling insert isn't possible without
        // replacing Tauri's contentView.
        return (content.clone(), None);
    }
    let parent = {
        let ptr: *mut NSView = unsafe { msg_send![&*wv, superview] };
        if ptr.is_null() {
            content.clone()
        } else {
            unsafe { Retained::retain(ptr) }.unwrap_or_else(|| content.clone())
        }
    };
    (parent, Some(wv))
}

fn retain_window(window: &WebviewWindow) -> Result<Retained<NSWindow>, String> {
    let raw = window.ns_window().map_err(|e| e.to_string())? as *mut NSWindow;
    unsafe { Retained::retain(raw) }.ok_or_else(|| "NSWindow handle is null".into())
}

fn view_frame(window: &WebviewWindow, content_w: f64, content_h: f64) -> NSRect {
    let scale = window.scale_factor().unwrap_or(1.0);
    let (left, top) = if FULLSCREEN_LAYOUT.load(Ordering::Relaxed) {
        (0, 0)
    } else {
        (
            INSET_LEFT.load(Ordering::Relaxed),
            INSET_TOP.load(Ordering::Relaxed),
        )
    };
    let (x, y, w, h) = player_area_points(content_w, content_h, left, top, scale);
    NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
}

pub fn resize_from_app(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        resize(&window);
    }
}

fn get_proc_address(_ctx: &*mut c_void, name: &str) -> *mut c_void {
    let cstr = match CString::new(name) {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    unsafe { dlsym(RTLD_DEFAULT, cstr.as_ptr()) }
}

fn schedule_redraw() {
    if REDRAW_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    extern "C" fn redraw_cb(_ctx: *mut c_void) {
        REDRAW_PENDING.store(false, Ordering::Release);
        let _ = render_now();
    }
    unsafe {
        dispatch_async_f(main_queue(), std::ptr::null_mut(), redraw_cb);
    }
}

fn render_now() -> Result<(), String> {
    if MainThreadMarker::new().is_none() {
        return Ok(());
    }
    let guard = EMBED.lock().map_err(|e| e.to_string())?;
    let Some(embed) = guard.as_ref() else {
        return Ok(());
    };
    let gl_ctx = embed
        .view
        .openGLContext()
        .ok_or_else(|| "openGLContext nil".to_string())?;
    gl_ctx.makeCurrentContext();
    let view_as_view: &NSView = embed.view.as_super();
    let bounds = view_as_view.bounds();
    let backing: NSRect = unsafe { msg_send![view_as_view, convertRectToBacking: bounds] };
    let mut w = backing.size.width as i32;
    let mut h = backing.size.height as i32;
    if w <= 0 || h <= 0 {
        let scale = view_as_view
            .window()
            .map(|win| win.backingScaleFactor())
            .filter(|s| *s > 0.0)
            .unwrap_or(2.0);
        w = (bounds.size.width * scale) as i32;
        h = (bounds.size.height * scale) as i32;
    }
    if w <= 0 || h <= 0 {
        return Ok(());
    }
    embed
        .render
        .render::<*mut c_void>(0, w, h, true)
        .map_err(|e| format!("render: {e:?}"))?;
    gl_ctx.flushBuffer();
    embed.render.report_swap();
    Ok(())
}
