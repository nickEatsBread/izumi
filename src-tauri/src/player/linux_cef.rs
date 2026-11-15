//! Linux webview and player compositor.
//!
//! The CEF runtime renders the main webview offscreen. This module draws it, with mpv's video
//! under it, into one X11 child of the Tauri window, so the page and the video are a single
//! surface in Desktop mode and in Game mode alike. Two threads, two shared EGL contexts:
//! - the main (CEF UI / GLib) thread imports each DMA-BUF CEF hands `on_accelerated_paint` (or
//!   uploads a CPU `on_paint` frame) into one of three shared UI textures and publishes it with a
//!   GPU fence;
//! - the render thread owns the window surface and mpv's render context, waits (GPU-side) on the
//!   newest UI frame's fence, draws video then UI, swaps (blocking here, never on the UI thread)
//!   and leaves a read fence on the UI texture it sampled.
//!
//! Window events reach CEF through [`on_window_event`]: pointer, touch, wheel, keys and IME.

use std::{
    cell::RefCell,
    ffi::{c_void, CString},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Condvar, Mutex, OnceLock,
    },
    time::Duration,
};

use khronos_egl as egl;
use libmpv2_sys as sys;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{AppHandle, WebviewWindowBuilder};
use tauri_runtime_cef::{
    cef::{
        self, rc::Rc as _, sys::cef_event_flags_t, wrap_render_handler, Browser, BrowserHost,
        CursorType, ImplBrowser, ImplBrowserHost, ImplRenderHandler, KeyEvent as CefKeyEvent,
        KeyEventType, MouseButtonType, MouseEvent, PaintElementType, Rect as CefRect,
        RenderHandler, ScreenInfo, WrapRenderHandler,
    },
    AsCefWebviewAttributes, Cef, Offscreen, OffscreenView,
};
use winit::{
    cursor::CursorIcon,
    event::{
        ButtonSource, ElementState, Ime, MouseButton, MouseScrollDelta, PointerSource, WindowEvent,
    },
    event_loop::ActiveEventLoop,
    keyboard::{Key, ModifiersState, NamedKey},
    window::Window,
};
use x11_dl::xlib;

/// The offscreen webview: the app's main window.
const MAIN: &str = "main";
/// The Deck panel's rate; CEF's windowless default is 30.
const FRAME_RATE: i32 = 90;

// Trace to a file in the app config dir (host: ~/.var/app/com.nicho.izumi/config/) AND
// stderr. Flatpak's sandbox swallows stderr, so the file is the reliable channel on the Deck.
pub(crate) fn elog(msg: &str) {
    eprintln!("[izumi] {msg}");
    use std::io::Write;
    let base = std::env::var("XDG_CONFIG_HOME")
        .unwrap_or_else(|_| format!("{}/.config", std::env::var("HOME").unwrap_or_default()));
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(format!("{base}/izumi-embed.log"))
    {
        let _ = writeln!(f, "{msg}");
    }
}

// ================================ Runtime ================================

/// The CEF runtime: windowless rendering, the GL path the compositor imports, and the
/// window-event hook. The profile lives in app DATA (`~/.local/share/<identifier>/cef`), not the
/// runtime's default cache directory: it holds the app's localStorage, cookies and sign-ins.
pub fn runtime(identifier: &str) -> Cef {
    // GTK must never touch GL on the main thread: the compositor owns the EGL contexts.
    if std::env::var_os("GSK_RENDERER").is_none() {
        std::env::set_var("GSK_RENDERER", "cairo");
    }
    let data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_else(std::env::temp_dir);
    Cef::default()
        .root_cache_path(data.join(identifier).join("cef"))
        .with_settings(|s| s.windowless_rendering_enabled = 1)
        // Release builds ignore the process command line, so the app sets this itself.
        .command_line_arg("use-angle", Some("gl-egl"))
        .on_window_event(on_window_event)
}

/// Makes the main webview offscreen and transparent: the page paints its own background and the
/// player route leaves it clear over the video.
pub fn configure<'a, M: tauri::Manager<tauri::DynRuntime>>(
    builder: WebviewWindowBuilder<'a, tauri::DynRuntime, M>,
) -> WebviewWindowBuilder<'a, tauri::DynRuntime, M> {
    let mut builder = builder.background_color(tauri::window::Color(0, 0, 0, 0));
    let mut offscreen = Offscreen::new(make_render_handler);
    offscreen.shared_texture_enabled = true;
    offscreen.cursor_handler = Some(Arc::new(|cursor, _| set_cursor(cursor)));
    if let Some(attrs) = builder
        .runtime_specific_attributes_mut()
        .as_cef_webview_attributes_mut()
    {
        attrs.offscreen = Some(offscreen);
    }
    builder
}

/// tauri#16189: with CEF's external message pump, Chromium's `MessagePumpGlib` still attaches its
/// work source to the default GLib context, and that source's `prepare` returns a timeout of 0
/// outside the pump's own `Run`, which never runs. Every blocking GLib iteration the runtime makes
/// then returns at once and the main thread spins a whole core. Work reaches this pump through
/// `OnScheduleMessagePumpWork` instead, so the source has nothing to do: destroy it. Call on the
/// main thread after the runtime has initialised CEF (the app's `setup`).
///
/// shortcut: walks GLib's sources by id; drop it once the runtime carries the fix.
pub fn release_idle_spin() {
    use gtk4::glib::ffi;
    fn module_base(address: *const c_void) -> Option<*mut c_void> {
        let mut info: libc::Dl_info = unsafe { std::mem::zeroed() };
        (unsafe { libc::dladdr(address, &mut info) } != 0).then_some(info.dli_fbase)
    }
    let Some(cef_base) = module_base(cef::sys::cef_initialize as *const c_void) else {
        return elog("cef: libcef not found; the main loop may spin");
    };
    let mut destroyed = 0;
    unsafe {
        let context = ffi::g_main_context_default();
        // Source ids are allocated sequentially; a fresh attach yields the next one.
        let probe = ffi::g_idle_source_new();
        let upper = ffi::g_source_attach(probe, context);
        ffi::g_source_destroy(probe);
        ffi::g_source_unref(probe);
        for id in 1..upper {
            let source = ffi::g_main_context_find_source_by_id(context, id);
            if source.is_null() || (*source).source_funcs.is_null() {
                continue;
            }
            let Some(prepare) = (*(*source).source_funcs).prepare else {
                continue;
            };
            // Chromium's work source: `prepare` in libcef, kPriorityWork, polling one pipe (its
            // wakeup pipe; Chromium's X11 event source polls the X socket).
            if module_base(prepare as *const c_void) != Some(cef_base)
                || ffi::g_source_get_priority(source) != ffi::G_PRIORITY_DEFAULT_IDLE
            {
                continue;
            }
            let poll_fds = (*source).poll_fds;
            if poll_fds.is_null() || !(*poll_fds).next.is_null() {
                continue;
            }
            let fd = (*((*poll_fds).data as *const ffi::GPollFD)).fd;
            let mut stat: libc::stat = std::mem::zeroed();
            if libc::fstat(fd, &mut stat) != 0 || (stat.st_mode & libc::S_IFMT) != libc::S_IFIFO {
                continue;
            }
            ffi::g_source_destroy(source);
            destroyed += 1;
        }
    }
    if destroyed == 0 {
        elog("cef: Chromium's GLib work source was not found; the main loop may spin");
    }
}

/// Gamescope turns the touchscreen into a left mouse button unless the XWayland root's
/// `STEAM_TOUCH_CLICK_MODE` is 4 (passthrough). Steam rewrites it, so reassert it every 50 ms on
/// our own connection, but never in the middle of a touch. Real touches then reach CEF as touch.
pub fn spawn_touch_passthrough() {
    if std::env::var_os("GAMESCOPE_WAYLAND_DISPLAY").is_none() {
        return;
    }
    std::thread::spawn(|| unsafe {
        let Ok(x) = xlib::Xlib::open() else { return };
        let dpy = (x.XOpenDisplay)(std::ptr::null());
        if dpy.is_null() {
            return elog("touch mode: XOpenDisplay failed");
        }
        let root = (x.XDefaultRootWindow)(dpy);
        let atom = (x.XInternAtom)(dpy, c"STEAM_TOUCH_CLICK_MODE".as_ptr(), 0);
        let value: std::ffi::c_ulong = 4;
        loop {
            if TOUCHES_DOWN.load(Ordering::Relaxed) == 0 {
                (x.XChangeProperty)(
                    dpy,
                    root,
                    atom,
                    xlib::XA_CARDINAL,
                    32,
                    xlib::PropModeReplace,
                    (&value as *const std::ffi::c_ulong).cast(),
                    1,
                );
                (x.XFlush)(dpy);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    });
}

/// izumi's UI scale as Chromium page zoom (1.2^level).
pub fn set_zoom(app: &AppHandle, factor: f64) -> Result<(), String> {
    app.run_on_main_thread(move || {
        if let Some(host) = host() {
            host.set_zoom_level(factor.max(0.25).ln() / 1.2f64.ln());
        }
    })
    .map_err(|e| e.to_string())
}

// ================================ Player ================================

/// The mpv core the render context is bound to, as a raw `mpv_handle` address.
static CORE: Mutex<Option<usize>> = Mutex::new(None);
/// Video insets in physical px: (left, top, right, bottom).
static INSETS: Mutex<(i32, i32, i32, i32)> = Mutex::new((0, 0, 0, 0));

/// Binds mpv's render context to the compositor. `mpv` must outlive the binding: [`detach`]
/// before the core is destroyed.
pub fn attach(mpv: &libmpv2::Mpv, _window: &tauri::WebviewWindow) -> Result<(), String> {
    let s = shared().ok_or("the compositor is not running")?;
    let handle = mpv.ctx.as_ptr() as usize;
    let (tx, rx) = mpsc::channel();
    s.requests.lock().unwrap().push(Request::Attach(handle, tx));
    schedule();
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|e| format!("compositor: {e}"))??;
    *CORE.lock().unwrap() = Some(handle);
    apply_margins();
    Ok(())
}

/// Frees the render context (on the render thread, where its GL context is current) and waits.
pub fn detach() {
    let mut core = CORE.lock().unwrap();
    if core.take().is_none() {
        return;
    }
    let Some(s) = shared() else { return };
    let (tx, rx) = mpsc::channel();
    s.requests.lock().unwrap().push(Request::Detach(tx));
    schedule();
    if rx.recv_timeout(Duration::from_secs(5)).is_err() {
        elog("compositor: render context release timed out");
    }
}

/// Stores the video insets (PHYSICAL px from the frontend) and applies them to the live core.
pub fn set_inset(_window: &tauri::WebviewWindow, left: i32, top: i32, right: i32, bottom: i32) {
    *INSETS.lock().unwrap() = (left.max(0), top.max(0), right.max(0), bottom.max(0));
    apply_margins();
}

/// mpv places the video inside its margins; the page around it stays live.
fn apply_margins() {
    let core = CORE.lock().unwrap();
    let (Some(handle), Some(s)) = (*core, shared()) else {
        return;
    };
    let (w, h) = *s.size.lock().unwrap();
    if w <= 0 || h <= 0 {
        return;
    }
    let (l, t, r, b) = *INSETS.lock().unwrap();
    let ratio = |px: i32, of: i32| (px as f64 / of as f64).clamp(0.0, 0.45);
    for (name, value) in [
        (c"video-margin-ratio-left", ratio(l, w)),
        (c"video-margin-ratio-top", ratio(t, h)),
        (c"video-margin-ratio-right", ratio(r, w)),
        (c"video-margin-ratio-bottom", ratio(b, h)),
    ] {
        let value = CString::new(format!("{value:.6}")).unwrap();
        // The core lock is held, so `detach` cannot release the handle under this call.
        unsafe { sys::mpv_set_property_string(handle as *mut sys::mpv_handle, name.as_ptr(), value.as_ptr()) };
    }
}

// ================================ Compositor ================================

type Egl = egl::DynamicInstance<egl::EGL1_5>;
type ImageTargetTex = unsafe extern "C" fn(u32, *const c_void);
const PLATFORM_X11_KHR: egl::Enum = 0x31D5;
const SLOTS: usize = 3;

/// A GLsync handle, shareable across the share group.
#[derive(Clone, Copy)]
struct Fence(usize);
impl Fence {
    unsafe fn new() -> Fence {
        Fence(gl::FenceSync(gl::SYNC_GPU_COMMANDS_COMPLETE, 0) as usize)
    }
    unsafe fn gpu_wait_and_delete(self) {
        gl::WaitSync(self.0 as gl::types::GLsync, 0, gl::TIMEOUT_IGNORED);
        gl::DeleteSync(self.0 as gl::types::GLsync);
    }
    unsafe fn delete(self) {
        gl::DeleteSync(self.0 as gl::types::GLsync)
    }
}

struct Published {
    slot: usize,
    fence: Fence,
}

/// What both threads touch, behind one mutex.
struct Ring {
    latest: Option<Published>,
    in_use: Option<usize>,
    read_fence: [Option<Fence>; SLOTS],
    tex: [u32; SLOTS],
    tex_size: [(i32, i32); SLOTS],
}

enum Request {
    Attach(usize, mpsc::Sender<Result<(), String>>),
    Detach(mpsc::Sender<()>),
}

struct Shared {
    ring: Mutex<Ring>,
    wake: Mutex<bool>,
    cv: Condvar,
    size: Mutex<(i32, i32)>,
    requests: Mutex<Vec<Request>>,
}

static SHARED: OnceLock<Arc<Shared>> = OnceLock::new();

/// Main-thread side: the shared context it imports with.
struct MainCtx {
    edpy: egl::Display,
    ctx: egl::Context,
    image_target: ImageTargetTex,
    src_tex: u32,
    src_fbo: u32,
    dst_fbo: u32,
}
thread_local! {
    static MAIN_CTX: RefCell<Option<MainCtx>> = const { RefCell::new(None) };
}

fn egl_lib() -> &'static Egl {
    static EGL: OnceLock<Egl> = OnceLock::new();
    EGL.get_or_init(|| unsafe { Egl::load_required().expect("libEGL") })
}

fn proc_address(name: &str) -> *mut c_void {
    egl_lib()
        .get_proc_address(name)
        .map_or(std::ptr::null_mut(), |f| f as *mut c_void)
}

fn shared() -> Option<&'static Arc<Shared>> {
    SHARED.get()
}

/// Wakes the render thread.
fn schedule() {
    if let Some(s) = shared() {
        *s.wake.lock().unwrap() = true;
        s.cv.notify_one();
    }
}

fn resize(w: i32, h: i32) {
    if let Some(s) = shared() {
        *s.size.lock().unwrap() = (w, h);
        schedule();
        apply_margins();
    }
}

/// Starts the render thread on the X11 toplevel `parent`; returns once both contexts exist.
fn start(parent: u64, w: i32, h: i32) -> Result<(), String> {
    if SHARED.get().is_some() {
        return Ok(());
    }
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("izumi-compositor".into())
        .spawn(move || render_thread(parent, w, h, tx))
        .map_err(|e| e.to_string())?;
    let (edpy, ctx, shared) = rx.recv().map_err(|e| e.to_string())?.0?;
    let egl = egl_lib();
    egl.make_current(edpy, None, None, Some(ctx))
        .map_err(|e| format!("main make_current: {e}"))?;
    let image_target = proc_address("glEGLImageTargetTexture2DOES");
    if image_target.is_null() {
        return Err("glEGLImageTargetTexture2DOES missing".into());
    }
    let (mut src_tex, mut src_fbo, mut dst_fbo) = (0, 0, 0);
    unsafe {
        gl::GenTextures(1, &mut src_tex);
        gl::GenFramebuffers(1, &mut src_fbo);
        gl::GenFramebuffers(1, &mut dst_fbo);
    }
    MAIN_CTX.with_borrow_mut(|m| {
        *m = Some(MainCtx {
            edpy,
            ctx,
            image_target: unsafe {
                std::mem::transmute::<*mut c_void, ImageTargetTex>(image_target)
            },
            src_tex,
            src_fbo,
            dst_fbo,
        })
    });
    let _ = SHARED.set(shared);
    schedule();
    Ok(())
}

type Init = Result<(egl::Display, egl::Context, Arc<Shared>), String>;
/// EGL handles are plain pointers; the main thread takes ownership of the shared context.
struct SendInit(Init);
unsafe impl Send for SendInit {}

fn render_thread(parent: u64, w: i32, h: i32, tx: mpsc::Sender<SendInit>) {
    let (x, dpy, child, edpy, rctx, surf, prog, vao) = match unsafe { setup_window(parent, w, h) } {
        Ok(v) => v,
        Err(e) => {
            let _ = tx.send(SendInit(Err(e)));
            return;
        }
    };
    let egl = egl_lib();
    // The main thread's context shares textures and fences with ours.
    let config = unsafe { config_of(edpy, rctx) };
    let mctx = match egl.create_context(edpy, config, Some(rctx), &[egl::NONE]) {
        Ok(c) => c,
        Err(e) => {
            let _ = tx.send(SendInit(Err(format!("shared context: {e}"))));
            return;
        }
    };
    let mut tex = [0u32; SLOTS];
    unsafe {
        gl::GenTextures(SLOTS as i32, tex.as_mut_ptr());
        for t in tex {
            gl::BindTexture(gl::TEXTURE_2D, t);
            for (p, v) in [
                (gl::TEXTURE_MIN_FILTER, gl::LINEAR),
                (gl::TEXTURE_MAG_FILTER, gl::LINEAR),
                (gl::TEXTURE_WRAP_S, gl::CLAMP_TO_EDGE),
                (gl::TEXTURE_WRAP_T, gl::CLAMP_TO_EDGE),
            ] {
                gl::TexParameteri(gl::TEXTURE_2D, p, v as i32);
            }
        }
        gl::Finish();
    }
    let shared = Arc::new(Shared {
        ring: Mutex::new(Ring {
            latest: None,
            in_use: None,
            read_fence: [None; SLOTS],
            tex,
            tex_size: [(0, 0); SLOTS],
        }),
        wake: Mutex::new(true),
        cv: Condvar::new(),
        size: Mutex::new((w, h)),
        requests: Mutex::new(Vec::new()),
    });
    let _ = tx.send(SendInit(Ok((edpy, mctx, shared.clone()))));

    let mut render: Option<(usize, MpvRender)> = None;
    let mut cur_size = (w, h);
    // Synced swaps on this thread; async present (vblank_mode=0) deadlocks once mpv plays.
    let _ = egl.swap_interval(edpy, 1);
    loop {
        {
            let mut wake = shared.wake.lock().unwrap();
            while !*wake {
                wake = shared.cv.wait_timeout(wake, Duration::from_millis(250)).unwrap().0;
            }
            *wake = false;
        }
        let requests = std::mem::take(&mut *shared.requests.lock().unwrap());
        for request in requests {
            match request {
                Request::Attach(handle, reply) => {
                    // mpv allows one render context per core.
                    if render.as_ref().map(|(h, _)| *h) == Some(handle) {
                        let _ = reply.send(Ok(()));
                        continue;
                    }
                    if let Some((_, old)) = render.take() {
                        old.free();
                    }
                    let created = unsafe { MpvRender::create(handle, dpy as *mut c_void) };
                    let _ = reply.send(created.as_ref().map(|_| ()).map_err(Clone::clone));
                    render = created.ok().map(|r| (handle, r));
                }
                Request::Detach(reply) => {
                    if let Some((_, old)) = render.take() {
                        old.free();
                    }
                    let _ = reply.send(());
                }
            }
        }
        let size = *shared.size.lock().unwrap();
        if size != cur_size && size.0 > 0 && size.1 > 0 {
            cur_size = size;
            unsafe {
                (x.XResizeWindow)(dpy, child, size.0 as u32, size.1 as u32);
                (x.XFlush)(dpy);
            }
        }
        // Take the newest UI frame; the slot drawn before it keeps its read fence.
        let ui = {
            let mut ring = shared.ring.lock().unwrap();
            if let Some(p) = ring.latest.take() {
                unsafe { p.fence.gpu_wait_and_delete() };
                ring.in_use = Some(p.slot);
            }
            ring.in_use.map(|s| ring.tex[s])
        };
        let (w, h) = cur_size;
        let mut drew_video = false;
        unsafe {
            if let Some((_, r)) = &render {
                drew_video = r.render(w, h);
            }
            gl::Viewport(0, 0, w, h);
            if !drew_video {
                gl::ClearColor(0.0, 0.0, 0.0, 1.0);
                gl::Clear(gl::COLOR_BUFFER_BIT);
            }
            if let Some(t) = ui {
                gl::Enable(gl::BLEND);
                gl::BlendFunc(gl::ONE, gl::ONE_MINUS_SRC_ALPHA);
                gl::UseProgram(prog);
                gl::BindVertexArray(vao);
                gl::ActiveTexture(gl::TEXTURE0);
                gl::BindTexture(gl::TEXTURE_2D, t);
                gl::DrawArrays(gl::TRIANGLE_STRIP, 0, 4);
                gl::Disable(gl::BLEND);
                gl::BindVertexArray(0);
                gl::UseProgram(0);
                let fence = Fence::new();
                let mut ring = shared.ring.lock().unwrap();
                if let Some(slot) = ring.in_use {
                    if let Some(old) = ring.read_fence[slot].replace(fence) {
                        old.delete();
                    }
                }
            }
        }
        let _ = egl.swap_buffers(edpy, surf);
        if drew_video {
            if let Some((_, r)) = &render {
                r.report_swap();
            }
        }
    }
}

#[allow(clippy::type_complexity)]
unsafe fn setup_window(
    parent: u64,
    w: i32,
    h: i32,
) -> Result<
    (xlib::Xlib, *mut xlib::Display, xlib::Window, egl::Display, egl::Context, egl::Surface, u32, u32),
    String,
> {
    let x = xlib::Xlib::open().map_err(|e| e.to_string())?;
    let dpy = (x.XOpenDisplay)(std::ptr::null());
    if dpy.is_null() {
        return Err("XOpenDisplay failed".into());
    }
    let mut pattr: xlib::XWindowAttributes = std::mem::zeroed();
    (x.XGetWindowAttributes)(dpy, parent, &mut pattr);
    let parent_visual = (x.XVisualIDFromVisual)(pattr.visual);
    // tauri#16474: the runtime leaves WM_CLASS empty; set it so the desktop file's
    // StartupWMClass matches.
    let hint = (x.XAllocClassHint)();
    if !hint.is_null() {
        (*hint).res_name = c"izumi".as_ptr() as *mut _;
        (*hint).res_class = c"izumi".as_ptr() as *mut _;
        (x.XSetClassHint)(dpy, parent, hint);
        (x.XFree)(hint as *mut c_void);
    }
    let egl = egl_lib();
    let edpy = egl
        .get_platform_display(PLATFORM_X11_KHR, dpy as *mut c_void, &[egl::ATTRIB_NONE])
        .map_err(|e| format!("eglGetPlatformDisplay: {e}"))?;
    egl.initialize(edpy).map_err(|e| format!("eglInitialize: {e}"))?;
    let exts = egl
        .query_string(Some(edpy), egl::EXTENSIONS)
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    for need in ["EGL_EXT_image_dma_buf_import", "EGL_EXT_image_dma_buf_import_modifiers"] {
        if !exts.contains(need) {
            elog(&format!("compositor: missing {need}"));
        }
    }
    egl.bind_api(egl::OPENGL_API).map_err(|e| e.to_string())?;
    let attrs = [
        egl::SURFACE_TYPE, egl::WINDOW_BIT, egl::RENDERABLE_TYPE, egl::OPENGL_BIT,
        egl::RED_SIZE, 8, egl::GREEN_SIZE, 8, egl::BLUE_SIZE, 8, egl::NONE,
    ];
    let mut configs = Vec::with_capacity(64);
    egl.choose_config(edpy, &attrs, &mut configs).map_err(|e| e.to_string())?;
    let config = configs
        .iter()
        .copied()
        .find(|c| egl.get_config_attrib(edpy, *c, egl::NATIVE_VISUAL_ID).ok() == Some(parent_visual as i32))
        .or_else(|| configs.first().copied())
        .ok_or("no EGL config")?;
    let vid = egl.get_config_attrib(edpy, config, egl::NATIVE_VISUAL_ID).unwrap_or(0) as u64;
    let mut tmpl: xlib::XVisualInfo = std::mem::zeroed();
    tmpl.visualid = vid;
    let mut n = 0;
    let vi = (x.XGetVisualInfo)(dpy, xlib::VisualIDMask, &mut tmpl, &mut n);
    if vi.is_null() {
        return Err(format!("no X visual {vid:#x}"));
    }
    let mut swa: xlib::XSetWindowAttributes = std::mem::zeroed();
    swa.colormap = (x.XCreateColormap)(dpy, parent, (*vi).visual, xlib::AllocNone);
    // No event mask: pointer, key and touch events fall through to the toplevel.
    swa.event_mask = 0;
    let child = (x.XCreateWindow)(
        dpy, parent, 0, 0, w.max(1) as u32, h.max(1) as u32, 0, (*vi).depth,
        xlib::InputOutput as u32, (*vi).visual,
        xlib::CWColormap | xlib::CWBackPixel | xlib::CWBorderPixel | xlib::CWEventMask, &mut swa,
    );
    (x.XFree)(vi as *mut c_void);
    (x.XMapWindow)(dpy, child);
    (x.XSync)(dpy, 0);
    let ctx = egl
        .create_context(edpy, config, None, &[egl::NONE])
        .map_err(|e| format!("eglCreateContext: {e}"))?;
    let surf = egl
        .create_window_surface(edpy, config, child as egl::NativeWindowType, None)
        .map_err(|e| format!("eglCreateWindowSurface: {e}"))?;
    egl.make_current(edpy, Some(surf), Some(surf), Some(ctx)).map_err(|e| e.to_string())?;
    gl::load_with(|n| proc_address(n) as *const _);
    elog(&format!(
        "compositor: GL {} / {}",
        std::ffi::CStr::from_ptr(gl::GetString(gl::VERSION) as *const _).to_string_lossy(),
        std::ffi::CStr::from_ptr(gl::GetString(gl::RENDERER) as *const _).to_string_lossy()
    ));
    let prog = gl::CreateProgram();
    gl::AttachShader(prog, shader(gl::VERTEX_SHADER, VS));
    gl::AttachShader(prog, shader(gl::FRAGMENT_SHADER, FS));
    gl::BindAttribLocation(prog, 0, c"pos".as_ptr());
    gl::LinkProgram(prog);
    let (mut vao, mut vbo) = (0, 0);
    gl::GenVertexArrays(1, &mut vao);
    gl::BindVertexArray(vao);
    gl::GenBuffers(1, &mut vbo);
    gl::BindBuffer(gl::ARRAY_BUFFER, vbo);
    let quad: [f32; 8] = [-1., -1., 1., -1., -1., 1., 1., 1.];
    gl::BufferData(gl::ARRAY_BUFFER, 32, quad.as_ptr() as *const _, gl::STATIC_DRAW);
    gl::VertexAttribPointer(0, 2, gl::FLOAT, gl::FALSE, 0, std::ptr::null());
    gl::EnableVertexAttribArray(0);
    gl::BindVertexArray(0);
    Ok((x, dpy, child, edpy, ctx, surf, prog, vao))
}

unsafe fn config_of(edpy: egl::Display, ctx: egl::Context) -> egl::Config {
    let egl = egl_lib();
    let id = egl.query_context(edpy, ctx, egl::CONFIG_ID).unwrap_or(0);
    let mut configs = Vec::with_capacity(1);
    let _ = egl.choose_config(edpy, &[egl::CONFIG_ID, id, egl::NONE], &mut configs);
    configs[0]
}

const VS: &str = "#version 130
in vec2 pos; out vec2 uv;
void main() { uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5); gl_Position = vec4(pos, 0.0, 1.0); }";
const FS: &str = "#version 130
in vec2 uv; out vec4 color; uniform sampler2D tex;
void main() { color = texture(tex, uv); }";

unsafe fn shader(kind: u32, src: &str) -> u32 {
    let s = gl::CreateShader(kind);
    let c = CString::new(src).unwrap();
    gl::ShaderSource(s, 1, &c.as_ptr(), std::ptr::null());
    gl::CompileShader(s);
    let mut ok = 0;
    gl::GetShaderiv(s, gl::COMPILE_STATUS, &mut ok);
    assert!(ok != 0, "shader compile failed");
    s
}

/// Main thread: picks a free slot (neither published nor being drawn), waits on the GPU for the
/// render thread's last read of it, sizes it, and runs `fill` with its FBO bound for drawing.
fn write_slot(w: i32, h: i32, fill: impl FnOnce(&MainCtx, u32)) -> bool {
    let Some(shared) = shared() else { return false };
    MAIN_CTX.with_borrow(|m| {
        let Some(m) = m else { return false };
        let _ = egl_lib().make_current(m.edpy, None, None, Some(m.ctx));
        let (slot, tex, fresh, read) = {
            let mut ring = shared.ring.lock().unwrap();
            let busy = [ring.in_use, ring.latest.as_ref().map(|p| p.slot)];
            let slot = (0..SLOTS).find(|s| !busy.contains(&Some(*s))).unwrap();
            let fresh = ring.tex_size[slot] != (w, h);
            ring.tex_size[slot] = (w, h);
            (slot, ring.tex[slot], fresh, ring.read_fence[slot].take())
        };
        unsafe {
            if let Some(f) = read {
                f.gpu_wait_and_delete();
            }
            if fresh {
                gl::BindTexture(gl::TEXTURE_2D, tex);
                gl::TexImage2D(gl::TEXTURE_2D, 0, gl::RGBA8 as i32, w, h, 0, gl::BGRA, gl::UNSIGNED_BYTE, std::ptr::null());
            }
            gl::BindFramebuffer(gl::DRAW_FRAMEBUFFER, m.dst_fbo);
            gl::FramebufferTexture2D(gl::DRAW_FRAMEBUFFER, gl::COLOR_ATTACHMENT0, gl::TEXTURE_2D, tex, 0);
            fill(m, tex);
            gl::BindFramebuffer(gl::FRAMEBUFFER, 0);
            let fence = Fence::new();
            // amdgpu fences shared BOs implicitly, so a flush orders our read before CEF's next write.
            gl::Flush();
            let mut ring = shared.ring.lock().unwrap();
            if let Some(old) = ring.latest.replace(Published { slot, fence }) {
                old.fence.delete();
            }
        }
        true
    })
}

/// Imports CEF's DMA-BUF and copies it into a UI slot before the callback returns.
fn import_dmabuf(info: &cef::AcceleratedPaintInfo) {
    if shared().is_none() {
        return;
    }
    let w = info.extra.coded_size.width;
    let h = info.extra.coded_size.height;
    // CEF names byte order; DRM fourccs name little-endian words.
    let fourcc: u32 = if info.format == cef::ColorType::RGBA_8888 {
        u32::from_le_bytes(*b"AB24")
    } else {
        u32::from_le_bytes(*b"AR24")
    };
    const MOD_INVALID: u64 = 0x00ff_ffff_ffff_ffff;
    // EGL_DMA_BUF_PLANE{0..3}_{FD,OFFSET,PITCH,MODIFIER_LO,MODIFIER_HI}_EXT.
    let keys: [[egl::Attrib; 5]; 4] = [
        [0x3272, 0x3273, 0x3274, 0x3443, 0x3444],
        [0x3275, 0x3276, 0x3277, 0x3445, 0x3446],
        [0x3278, 0x3279, 0x327A, 0x3447, 0x3448],
        [0x3440, 0x3441, 0x3442, 0x3449, 0x344A],
    ];
    let mut attrs: Vec<egl::Attrib> =
        vec![egl::WIDTH as _, w as _, egl::HEIGHT as _, h as _, 0x3271, fourcc as _];
    for (i, plane) in info.planes.iter().take(info.plane_count.clamp(0, 4) as usize).enumerate() {
        let k = keys[i];
        attrs.extend([k[0], plane.fd as _, k[1], plane.offset as _, k[2], plane.stride as _]);
        if info.modifier != MOD_INVALID {
            attrs.extend([k[3], (info.modifier & 0xffff_ffff) as _, k[4], (info.modifier >> 32) as _]);
        }
    }
    attrs.push(egl::NONE as _);
    let Some(edpy) = MAIN_CTX.with_borrow(|m| m.as_ref().map(|m| m.edpy)) else { return };
    let image = unsafe {
        egl_lib().create_image(
            edpy,
            egl::Context::from_ptr(egl::NO_CONTEXT),
            0x3270, // EGL_LINUX_DMA_BUF_EXT
            egl::ClientBuffer::from_ptr(std::ptr::null_mut()),
            &attrs,
        )
    };
    let image = match image {
        Ok(i) => i,
        Err(e) => {
            static FAILS: AtomicU64 = AtomicU64::new(0);
            if FAILS.fetch_add(1, Ordering::Relaxed) < 5 {
                elog(&format!("compositor: dmabuf import failed: {e} ({w}x{h} mod {:#x})", info.modifier));
            }
            return;
        }
    };
    let ok = write_slot(w, h, |m, _| unsafe {
        gl::BindTexture(gl::TEXTURE_2D, m.src_tex);
        (m.image_target)(gl::TEXTURE_2D, image.as_ptr());
        gl::BindFramebuffer(gl::READ_FRAMEBUFFER, m.src_fbo);
        gl::FramebufferTexture2D(gl::READ_FRAMEBUFFER, gl::COLOR_ATTACHMENT0, gl::TEXTURE_2D, m.src_tex, 0);
        gl::BlitFramebuffer(0, 0, w, h, 0, 0, w, h, gl::COLOR_BUFFER_BIT, gl::NEAREST);
    });
    let _ = egl_lib().destroy_image(edpy, image);
    if ok {
        schedule();
    }
}

/// CPU `on_paint` fallback: uploads the whole BGRA buffer (the slot may hold an older frame).
fn upload_cpu(buf: *const u8, w: i32, h: i32) {
    let ok = write_slot(w, h, |_, tex| unsafe {
        gl::BindTexture(gl::TEXTURE_2D, tex);
        gl::TexSubImage2D(gl::TEXTURE_2D, 0, 0, 0, w, h, gl::BGRA, gl::UNSIGNED_BYTE, buf as *const _);
    });
    if ok {
        schedule();
    }
}

/// mpv's render API through libmpv2-sys: libmpv2's `render()` cannot pass
/// BLOCK_FOR_TARGET_TIME=0, and with the default the render thread waits on mpv's VO thread.
struct MpvRender(*mut sys::mpv_render_context);

unsafe extern "C" fn mpv_gpa(_ctx: *mut c_void, name: *const std::ffi::c_char) -> *mut c_void {
    let name = std::ffi::CStr::from_ptr(name);
    proc_address(name.to_str().unwrap_or(""))
}

unsafe extern "C" fn mpv_update(_ctx: *mut c_void) {
    schedule();
}

fn param(type_: u32, data: *mut c_void) -> sys::mpv_render_param {
    sys::mpv_render_param { type_: type_ as _, data }
}

impl MpvRender {
    unsafe fn create(handle: usize, x11: *mut c_void) -> Result<MpvRender, String> {
        let mut init = sys::mpv_opengl_init_params {
            get_proc_address: Some(mpv_gpa),
            get_proc_address_ctx: std::ptr::null_mut(),
        };
        // API_TYPE, OPENGL_INIT_PARAMS, X11_DISPLAY (the render thread's own Xlib connection,
        // for VA-API's X11/DRI3 interop), INVALID.
        let mut params = [
            param(1, c"opengl".as_ptr() as *mut c_void),
            param(2, &mut init as *mut _ as *mut c_void),
            param(8, x11),
            param(0, std::ptr::null_mut()),
        ];
        let mut ctx = std::ptr::null_mut();
        let rc = sys::mpv_render_context_create(&mut ctx, handle as *mut sys::mpv_handle, params.as_mut_ptr());
        if rc < 0 {
            return Err(format!("mpv_render_context_create: {rc}"));
        }
        sys::mpv_render_context_set_update_callback(ctx, Some(mpv_update), std::ptr::null_mut());
        Ok(MpvRender(ctx))
    }

    fn render(&self, w: i32, h: i32) -> bool {
        unsafe {
            sys::mpv_render_context_update(self.0);
            let mut fbo = sys::mpv_opengl_fbo { fbo: 0, w, h, internal_format: 0 };
            let (mut flip, mut block): (std::ffi::c_int, std::ffi::c_int) = (1, 0);
            // OPENGL_FBO, FLIP_Y, BLOCK_FOR_TARGET_TIME, INVALID.
            let mut params = [
                param(3, &mut fbo as *mut _ as *mut c_void),
                param(4, &mut flip as *mut _ as *mut c_void),
                param(12, &mut block as *mut _ as *mut c_void),
                param(0, std::ptr::null_mut()),
            ];
            sys::mpv_render_context_render(self.0, params.as_mut_ptr()) >= 0
        }
    }

    fn report_swap(&self) {
        unsafe { sys::mpv_render_context_report_swap(self.0) }
    }

    fn free(self) {
        unsafe { sys::mpv_render_context_free(self.0) }
    }
}

// ================================ CEF view and input ================================

#[derive(Default)]
struct State {
    view: Option<OffscreenView>,
    browser: Option<Browser>,
    pointer: (i32, i32),
    modifiers: ModifiersState,
    buttons: u32,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::default();
}

/// Fingers currently down, so the touch-mode keepalive never rewrites mid-gesture.
static TOUCHES_DOWN: AtomicU64 = AtomicU64::new(0);

fn host() -> Option<BrowserHost> {
    STATE.with_borrow(|s| s.browser.as_ref().and_then(|b| b.host()))
}

/// Builds the compositor on the window's X11 surface the first time it is reachable.
fn ensure_gfx(window: &Arc<dyn Window>) {
    if shared().is_some() {
        return;
    }
    let Ok(handle) = window.window_handle() else { return };
    let xid = match handle.as_raw() {
        RawWindowHandle::Xlib(h) => h.window as u64,
        RawWindowHandle::Xcb(h) => h.window.get() as u64,
        other => return elog(&format!("compositor: not an X11 window: {other:?}")),
    };
    let size = window.surface_size();
    if let Err(e) = start(xid, size.width as i32, size.height as i32) {
        elog(&format!("compositor failed: {e}"));
    }
}

fn make_render_handler(view: OffscreenView) -> RenderHandler {
    STATE.with_borrow_mut(|s| s.view = Some(view.clone()));
    if let Some(window) = view.window() {
        ensure_gfx(&window);
    }
    IzumiRenderHandler::new(view)
}

wrap_render_handler! {
  struct IzumiRenderHandler {
    view: OffscreenView,
  }

  impl RenderHandler {
    fn view_rect(&self, browser: Option<&mut Browser>, rect: Option<&mut CefRect>) {
      remember(browser);
      let Some(rect) = rect else { return };
      let size = self.view.bounds().size.to_logical::<f64>(1.0);
      *rect = CefRect {
        x: 0,
        y: 0,
        width: (size.width.round() as i32).max(1),
        height: (size.height.round() as i32).max(1),
      };
    }

    fn screen_info(&self, _browser: Option<&mut Browser>, screen_info: Option<&mut ScreenInfo>) -> std::os::raw::c_int {
      let (Some(info), Some(window)) = (screen_info, self.view.window()) else { return 0 };
      info.device_scale_factor = window.scale_factor() as f32;
      1
    }

    fn on_paint(
      &self,
      browser: Option<&mut Browser>,
      type_: PaintElementType,
      _dirty_rects: Option<&[CefRect]>,
      buffer: *const u8,
      width: std::os::raw::c_int,
      height: std::os::raw::c_int,
    ) {
      remember(browser);
      if buffer.is_null() || type_ != PaintElementType::VIEW {
        return;
      }
      upload_cpu(buffer, width, height);
    }

    fn on_accelerated_paint(
      &self,
      browser: Option<&mut Browser>,
      type_: PaintElementType,
      _dirty_rects: Option<&[CefRect]>,
      info: Option<&cef::AcceleratedPaintInfo>,
    ) {
      remember(browser);
      let Some(info) = info else { return };
      if type_ != PaintElementType::VIEW {
        return;
      }
      import_dmabuf(info);
    }
  }
}

fn remember(browser: Option<&mut Browser>) {
    let Some(browser) = browser else { return };
    let first = STATE.with(|s| {
        let Ok(mut s) = s.try_borrow_mut() else { return false };
        if s.browser.is_some() {
            return false;
        }
        s.browser = Some(browser.clone());
        true
    });
    if !first {
        return;
    }
    if let Some(host) = browser.host() {
        host.set_windowless_frame_rate(FRAME_RATE);
        host.set_focus(1);
        // Offscreen browsers lose page focus across loads, and without it neither :focus nor
        // :focus-visible match, so the controller's focus ring never shows. Reassert it.
        // shortcut: a 1 s timer; call SetFocus on load end and window focus if this ever costs.
        gtk4::glib::timeout_add_seconds_local(1, || {
            if let Some(h) = self::host() {
                h.set_focus(1);
            }
            gtk4::glib::ControlFlow::Continue
        });
    }
}

const SHIFT_DOWN: u32 = cef_event_flags_t::EVENTFLAG_SHIFT_DOWN.0 as u32;
const CONTROL_DOWN: u32 = cef_event_flags_t::EVENTFLAG_CONTROL_DOWN.0 as u32;
const ALT_DOWN: u32 = cef_event_flags_t::EVENTFLAG_ALT_DOWN.0 as u32;
const COMMAND_DOWN: u32 = cef_event_flags_t::EVENTFLAG_COMMAND_DOWN.0 as u32;
// EVENTFLAG_{LEFT,MIDDLE,RIGHT}_MOUSE_BUTTON.
const LEFT_BUTTON_DOWN: u32 = 1 << 4;
const MIDDLE_BUTTON_DOWN: u32 = 1 << 5;
const RIGHT_BUTTON_DOWN: u32 = 1 << 6;

fn flags(s: &State) -> u32 {
    let mut f = s.buttons;
    for (held, flag) in [
        (s.modifiers.shift_key(), SHIFT_DOWN),
        (s.modifiers.control_key(), CONTROL_DOWN),
        (s.modifiers.alt_key(), ALT_DOWN),
        (s.modifiers.meta_key(), COMMAND_DOWN),
    ] {
        if held {
            f |= flag;
        }
    }
    f
}

fn mouse_at(window: &Arc<dyn Window>, x: f64, y: f64) -> MouseEvent {
    let scale = window.scale_factor();
    let p = ((x / scale).round() as i32, (y / scale).round() as i32);
    STATE.with_borrow_mut(|s| {
        s.pointer = p;
        MouseEvent { x: p.0, y: p.1, modifiers: flags(s) }
    })
}

fn touch(host: &BrowserHost, window: &Arc<dyn Window>, id: usize, x: f64, y: f64, kind: cef::TouchEventType) {
    if kind == cef::TouchEventType::PRESSED {
        TOUCHES_DOWN.fetch_add(1, Ordering::Relaxed);
    } else if kind == cef::TouchEventType::RELEASED || kind == cef::TouchEventType::CANCELLED {
        let _ = TOUCHES_DOWN.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_sub(1));
    }
    let scale = window.scale_factor();
    host.send_touch_event(Some(&cef::TouchEvent {
        id: id as i32,
        // Unrounded: touch samples go to CEF as they arrive.
        x: (x / scale) as f32,
        y: (y / scale) as f32,
        radius_x: 0.,
        radius_y: 0.,
        rotation_angle: 0.,
        pressure: 1.,
        type_: kind,
        modifiers: 0,
        pointer_type: cef::PointerType::TOUCH,
    }));
}

/// Registered with `Cef::on_window_event`; runs before the runtime's own handling. Only the main
/// window is offscreen: sign-in popups are windowed browsers that take their own input.
fn on_window_event(label: &str, _el: &dyn ActiveEventLoop, window: Arc<dyn Window>, event: &WindowEvent) {
    if label != MAIN {
        return;
    }
    match event {
        WindowEvent::Destroyed => return,
        WindowEvent::SurfaceResized(size) => {
            ensure_gfx(&window);
            resize(size.width as i32, size.height as i32);
        }
        WindowEvent::RedrawRequested => {
            ensure_gfx(&window);
            schedule();
        }
        _ => {}
    }
    let Some(host) = host() else { return };
    match event {
        // Under gamescope focus can flap; never take CEF's focus away.
        WindowEvent::Focused(true) => host.set_focus(1),
        WindowEvent::ModifiersChanged(m) => STATE.with_borrow_mut(|s| s.modifiers = m.state()),
        WindowEvent::PointerMoved { position, source, .. } => match source {
            PointerSource::Touch { finger_id, .. } => touch(
                &host,
                &window,
                finger_id.into_raw(),
                position.x,
                position.y,
                cef::TouchEventType::MOVED,
            ),
            _ => {
                let e = mouse_at(&window, position.x, position.y);
                host.send_mouse_move_event(Some(&e), 0);
            }
        },
        WindowEvent::PointerLeft { kind, .. } => {
            if matches!(kind, winit::event::PointerKind::Touch(_)) {
                return;
            }
            let e = STATE.with_borrow(|s| MouseEvent { x: s.pointer.0, y: s.pointer.1, modifiers: flags(s) });
            host.send_mouse_move_event(Some(&e), 1);
        }
        WindowEvent::PointerButton { state, position, button, .. } => {
            let pressed = *state == ElementState::Pressed;
            if let ButtonSource::Touch { finger_id, .. } = button {
                let kind = if pressed { cef::TouchEventType::PRESSED } else { cef::TouchEventType::RELEASED };
                touch(&host, &window, finger_id.into_raw(), position.x, position.y, kind);
                return;
            }
            let (kind, flag) = match button.clone().mouse_button() {
                Some(MouseButton::Left) => (MouseButtonType::LEFT, LEFT_BUTTON_DOWN),
                Some(MouseButton::Middle) => (MouseButtonType::MIDDLE, MIDDLE_BUTTON_DOWN),
                Some(MouseButton::Right) => (MouseButtonType::RIGHT, RIGHT_BUTTON_DOWN),
                _ => return,
            };
            STATE.with_borrow_mut(|s| if pressed { s.buttons |= flag } else { s.buttons &= !flag });
            let e = mouse_at(&window, position.x, position.y);
            host.send_mouse_click_event(Some(&e), kind, i32::from(!pressed), 1);
        }
        WindowEvent::MouseWheel { delta, .. } => {
            let (dx, dy) = match delta {
                MouseScrollDelta::LineDelta(x, y) => (x * 120., y * 120.),
                MouseScrollDelta::PixelDelta(d) => (d.x as f32, d.y as f32),
                _ => return,
            };
            // The GTK 4 backend passes GDK's deltas through: positive is down.
            let e = STATE.with_borrow(|s| MouseEvent { x: s.pointer.0, y: s.pointer.1, modifiers: flags(s) });
            host.send_mouse_wheel_event(Some(&e), -dx as i32, -dy as i32);
        }
        WindowEvent::KeyboardInput { event, .. } => {
            let modifiers = STATE.with_borrow(flags);
            let pressed = event.state == ElementState::Pressed;
            host.send_key_event(Some(&CefKeyEvent {
                type_: if pressed { KeyEventType::RAWKEYDOWN } else { KeyEventType::KEYUP },
                modifiers,
                windows_key_code: windows_key_code(&event.logical_key),
                ..Default::default()
            }));
            if pressed && modifiers & (CONTROL_DOWN | COMMAND_DOWN) == 0 {
                if let Some(text) = &event.text {
                    send_text(&host, text, modifiers);
                }
            }
        }
        WindowEvent::Ime(Ime::Commit(text)) => send_text(&host, text, 0),
        _ => {}
    }
}

fn send_text(host: &BrowserHost, text: &str, modifiers: u32) {
    for unit in text.encode_utf16() {
        host.send_key_event(Some(&CefKeyEvent {
            type_: KeyEventType::CHAR,
            modifiers,
            windows_key_code: i32::from(unit),
            character: unit,
            unmodified_character: unit,
            ..Default::default()
        }));
    }
}

/// Windows virtual-key codes, which is what CEF's key events carry on every platform.
fn windows_key_code(key: &Key) -> i32 {
    match key {
        Key::Named(named) => match named {
            NamedKey::Backspace => 0x08,
            NamedKey::Tab => 0x09,
            NamedKey::Enter => 0x0D,
            NamedKey::Shift => 0x10,
            NamedKey::Control => 0x11,
            NamedKey::Alt => 0x12,
            NamedKey::Escape => 0x1B,
            NamedKey::PageUp => 0x21,
            NamedKey::PageDown => 0x22,
            NamedKey::End => 0x23,
            NamedKey::Home => 0x24,
            NamedKey::ArrowLeft => 0x25,
            NamedKey::ArrowUp => 0x26,
            NamedKey::ArrowRight => 0x27,
            NamedKey::ArrowDown => 0x28,
            NamedKey::Delete => 0x2E,
            NamedKey::F11 => 0x7A,
            NamedKey::F12 => 0x7B,
            _ => 0,
        },
        Key::Character(text) => text
            .chars()
            .next()
            .filter(|c| c.is_ascii_alphanumeric() || *c == ' ')
            .map_or(0, |c| c.to_ascii_uppercase() as i32),
        _ => 0,
    }
}

fn set_cursor(cursor: CursorType) {
    let window = STATE.with_borrow(|s| s.view.as_ref().and_then(|v| v.window()));
    let Some(window) = window else { return };
    let icon = if cursor == CursorType::HAND {
        CursorIcon::Pointer
    } else if cursor == CursorType::IBEAM {
        CursorIcon::Text
    } else {
        CursorIcon::Default
    };
    window.set_cursor(icon.into());
}
