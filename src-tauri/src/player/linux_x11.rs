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
//! All X calls run on the GTK main thread. The container calls below share GTK's Xlib connection
//! (fetched per-call from the window handle); the STEAM_TOUCH_CLICK_MODE writes use their OWN
//! dedicated worker + connection (see `TOUCH_WORKER`) so they survive GTK stalls and teardown.

#![cfg(target_os = "linux")]

use std::ffi::c_void;
use std::os::raw::{c_char, c_int, c_uchar, c_ulong};
use std::sync::{
    atomic::{AtomicBool, AtomicPtr, AtomicU64, Ordering},
    mpsc::{self, SyncSender, TrySendError},
    Mutex, OnceLock,
};
use std::time::Duration;

use raw_window_handle::{HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle};

// Explicit #[link] so libX11/libXext are pulled in for OUR symbols — gtk links them
// transitively but `-Wl,--as-needed` drops them, so the Flatpak link fails without this.
#[allow(non_snake_case)]
#[link(name = "X11")]
extern "C" {
    fn XCreateSimpleWindow(
        dpy: *mut c_void,
        parent: u64,
        x: i32,
        y: i32,
        w: u32,
        h: u32,
        bw: u32,
        border: u64,
        background: u64,
    ) -> u64;
    fn XDestroyWindow(dpy: *mut c_void, w: u64) -> i32;
    fn XMapWindow(dpy: *mut c_void, w: u64) -> i32;
    fn XMoveResizeWindow(dpy: *mut c_void, w: u64, x: i32, y: i32, width: u32, height: u32) -> i32;
    fn XRaiseWindow(dpy: *mut c_void, w: u64) -> i32;
    fn XFlush(dpy: *mut c_void) -> i32;
    fn XSync(dpy: *mut c_void, discard: i32) -> i32;
    fn XOpenDisplay(name: *const c_char) -> *mut c_void;
    fn XDefaultRootWindow(dpy: *mut c_void) -> u64;
    fn XInternAtom(dpy: *mut c_void, name: *const c_char, only_if_exists: c_int) -> c_ulong;
    fn XChangeProperty(
        dpy: *mut c_void,
        w: u64,
        property: c_ulong,
        property_type: c_ulong,
        format: c_int,
        mode: c_int,
        data: *const c_uchar,
        nelements: c_int,
    ) -> c_int;
    fn XSetIOErrorHandler(handler: Option<XIOErrorHandler>) -> Option<XIOErrorHandler>;
    fn XCloseDisplay(dpy: *mut c_void) -> c_int;
}

// libXtst (XTEST extension). Gamescope delivers Deck touch to this XWayland client as synthesized
// core-pointer button events; a release swallowed by the compositor (Steam overlay appearing under
// a held finger — wlserver_touchup skips the whole release when mouse_focus_surface is NULL) leaves
// the X core pointer with the button logically HELD, and WebKitGTK's pointer state stuck with it —
// unreachable from JS. A faked ButtonRelease is the one lever that clears both: the server routes
// it through the implicit grab like a real release, WebKit sees a normal button-up, and its
// synthesized pointer sequence ends. Releasing a button that is not pressed is discarded by the
// server's device state check, so firing this blind is safe.
#[allow(non_snake_case)]
#[link(name = "Xtst")]
extern "C" {
    fn XTestFakeButtonEvent(dpy: *mut c_void, button: u32, is_press: c_int, delay: c_ulong) -> c_int;
}

// Xlib IO-error plumbing (see install_io_guard). The classic handler is PROCESS-GLOBAL; the
// per-display exit handler is the libX11 >= 1.7 addition that makes surviving a dead private
// connection possible at all.
type XIOErrorHandler = unsafe extern "C" fn(*mut c_void) -> c_int;
type XIOErrorExitHandler = unsafe extern "C" fn(*mut c_void, *mut c_void);
type XSetIOErrorExitHandlerFn =
    unsafe extern "C" fn(*mut c_void, Option<XIOErrorExitHandler>, *mut c_void);

// X11's predefined XA_CARDINAL atom and PropModeReplace value.
const XA_CARDINAL: c_ulong = 6;
const PROP_MODE_REPLACE: c_int = 0;

// libXext (shape extension). ShapeInput = 2, ShapeSet = 0.
#[allow(non_snake_case)]
#[link(name = "Xext")]
extern "C" {
    fn XShapeCombineRectangles(
        dpy: *mut c_void,
        w: u64,
        kind: i32,
        x: i32,
        y: i32,
        rects: *const c_void,
        n_rects: i32,
        op: i32,
        ordering: i32,
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

// Gamescope exposes one global touch mode, but accepts updates from every XWayland root. Steam can
// replace our passthrough request at any time. Keep the X connection and all its calls on one
// dedicated thread so GTK/WebKit work cannot stall the keepalive and no Display crosses threads.
//
// A bounded wake channel gives focus/navigation/controller edges an immediate reassertion. The
// worker also writes every 50ms so a later Steam write cannot leave touch dead until another UI
// event. One tiny XChangeProperty + XFlush at 20Hz is negligible.
//
// The sender lives in a Mutex<Option<..>>, NOT a OnceLock: a worker that wedges or whose Display
// dies must be REPLACEABLE, or Steam's next mode write sticks for the rest of the session with no
// symptom other than "touch stopped working". touch_worker() judges liveness by the heartbeat.
static TOUCH_WORKER: Mutex<Option<SyncSender<()>>> = Mutex::new(None);
const TOUCH_KEEPALIVE: Duration = Duration::from_millis(50);
/// Worker heartbeat (epoch ms), stored every loop tick — including held/skipped ones, so a
/// legitimate write-hold is never mistaken for a dead worker.
static TOUCH_ALIVE_MS: AtomicU64 = AtomicU64::new(0);
const TOUCH_STALE_MS: u64 = 2_000;
/// Keepalive writes are HELD while a finger is physically down (reported by the webview): a mode
/// write landing mid-gesture makes gamescope reroute that gesture's remaining MOTION (the release
/// itself is safe — gamescope pairs it with how the down was delivered), so the drag freezes or
/// warps. Deadline-based so a lost pointerup can never silence the keepalive for good.
static TOUCH_HOLD_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
const TOUCH_HOLD_MAX_MS: u64 = 10_000;
/// Set by the IO handlers when the worker's private Display dies (XWayland restart). The worker
/// exits on seeing it; the next enable_native_touch respawns with a fresh connection.
static TOUCH_DPY_DEAD: AtomicBool = AtomicBool::new(false);
/// The worker's current Display*, so the process-global IO handler can filter to OUR connection.
static TOUCH_DPY_PTR: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
static PREV_IO_HANDLER: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
static IO_HANDLER_INSTALLED: OnceLock<()> = OnceLock::new();
static LAST_CLIENT_RESTORE_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Force-release core-pointer buttons 1-3 at the X server (see the XTest extern's comment for
/// why). Runs on a throwaway thread with its own short-lived Display: XOpenDisplay can block on a
/// stalled server, and this is called from watchdog/focus paths that must never wedge. Fire and
/// forget by design — there is nothing actionable to await.
pub fn unstick_pointer() {
    std::thread::spawn(|| unsafe {
        let dpy = XOpenDisplay(std::ptr::null());
        if dpy.is_null() {
            crate::player::linux_embed::elog("x11: unstick: XOpenDisplay failed");
            return;
        }
        for button in 1..=3u32 {
            XTestFakeButtonEvent(dpy, button, 0, 0);
        }
        XFlush(dpy);
        XCloseDisplay(dpy);
    });
}

/// Webview-reported "a finger is physically on the screen" edge (see native_touch_hold).
pub fn set_touch_hold(held: bool) {
    let deadline = if held {
        now_ms() + TOUCH_HOLD_MAX_MS
    } else {
        0
    };
    TOUCH_HOLD_UNTIL_MS.store(deadline, Ordering::Relaxed);
}

unsafe extern "C" fn touch_io_exit(_dpy: *mut c_void, _data: *mut c_void) {
    TOUCH_DPY_DEAD.store(true, Ordering::Relaxed);
}

unsafe extern "C" fn touch_io_error(dpy: *mut c_void) -> c_int {
    if dpy == TOUCH_DPY_PTR.load(Ordering::Relaxed) {
        TOUCH_DPY_DEAD.store(true, Ordering::Relaxed);
        // Returning is only survivable because touch_io_exit is registered for this display —
        // without it libX11 falls through to its per-display default, which exit(1)s.
        return 0;
    }
    let prev = PREV_IO_HANDLER.load(Ordering::Relaxed);
    if !prev.is_null() {
        let prev: XIOErrorHandler = std::mem::transmute(prev);
        return prev(dpy);
    }
    0
}

/// Survive OUR private touch connection dying instead of taking the app with it.
///
/// GTK3 installs a process-global XSetIOErrorHandler (`gdk_x_io_error`) that `_exit(1)`s for an IO
/// error on ANY display — including this private one, so an XWayland hiccup used to be fatal.
/// Survival needs BOTH pieces (libX11 semantics): a filtering global handler that returns for our
/// display (forwarding every other display to GTK's), AND the per-display
/// `XSetIOErrorExitHandler` (libX11 >= 1.7) so libX11's own exit(1) default is bypassed too.
/// The symbol is resolved at runtime; where it doesn't exist we install NOTHING and keep the old
/// behavior rather than half of it.
fn install_io_guard(dpy: *mut c_void) {
    unsafe {
        let sym = libc::dlsym(
            libc::RTLD_DEFAULT,
            b"XSetIOErrorExitHandler\0".as_ptr().cast(),
        );
        if sym.is_null() {
            return;
        }
        let set_exit: XSetIOErrorExitHandlerFn = std::mem::transmute(sym);
        set_exit(dpy, Some(touch_io_exit), std::ptr::null_mut());
        IO_HANDLER_INSTALLED.get_or_init(|| {
            if let Some(prev) = XSetIOErrorHandler(Some(touch_io_error)) {
                PREV_IO_HANDLER.store(prev as *mut c_void, Ordering::Relaxed);
            }
        });
    }
}

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

/// Ask Gamescope to deliver the Deck touchscreen as real touch input instead of converting it
/// into a left mouse button. Gamescope watches `STEAM_TOUCH_CLICK_MODE` on every XWayland root;
/// value 4 is its native passthrough mode. The app writes its own XWayland root (`DISPLAY=:1` in
/// the Steam session), which is the only X socket exposed inside the Flatpak.
///
/// Gamescope then emits wl_touch, XWayland exposes XI2 touch sequences, and WebKitGTK's built-in
/// touch-only drag/swipe controllers provide native kinetic scrolling.
///
/// The mode is ONE global in gamescope, last-writer-wins across every XWayland root — and Steam
/// keeps rewriting it (to Left, mode 1) from its own root on a server this Flatpak cannot even
/// see, at unpredictable moments (launch transition end, overlay/keyboard toggles, per-app input
/// profile loads). Every call here wakes the independent keepalive worker so the reassertion is not
/// delayed behind GTK/WebKit work.
pub fn enable_native_touch(window: &tauri::WebviewWindow) -> Result<(), String> {
    let _ = window; // touch mode is a root property, independent of the window handle
    if std::env::var_os("GAMESCOPE_WAYLAND_DISPLAY").is_none() {
        return Ok(());
    }
    let now = now_ms();
    let last = LAST_CLIENT_RESTORE_MS.load(Ordering::Relaxed);
    if !crate::gm_perf::should_restore_touch(last, now) {
        return Ok(());
    }
    LAST_CLIENT_RESTORE_MS.store(now, Ordering::Relaxed);
    // Two attempts: a Disconnected sender means the worker died (its Display died, or it wedged
    // and was replaced) — drop it and spawn a fresh one instead of reporting a dead end.
    for attempt in 0..2 {
        let sender = touch_worker()?;
        match sender.try_send(()) {
            Ok(()) | Err(TrySendError::Full(())) => {
                crate::player::linux_embed::elog(
                    "x11: requested Gamescope native touch passthrough (mode 4)",
                );
                return Ok(());
            }
            Err(TrySendError::Disconnected(())) => {
                let mut guard = TOUCH_WORKER.lock().unwrap_or_else(|p| p.into_inner());
                *guard = None;
                if attempt == 1 {
                    return Err("native-touch keepalive stopped and could not be restarted".into());
                }
            }
        }
    }
    Ok(())
}

fn touch_worker() -> Result<SyncSender<()>, String> {
    // unwrap_or_else(into_inner): a panic on this path once poisoned the mutex and every later
    // retry errored forever — un-poisoning is safe here, the Option is always coherent.
    let mut guard = TOUCH_WORKER.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(sender) = guard.as_ref() {
        // Liveness, not mere existence: a wedged or dead worker holding the slot forever is
        // exactly how a Steam mode rewrite becomes permanent. The heartbeat updates every 50ms
        // tick (held ones included), so 2s of silence means the worker is genuinely gone.
        let age = now_ms().saturating_sub(TOUCH_ALIVE_MS.load(Ordering::Relaxed));
        if age <= TOUCH_STALE_MS {
            return Ok(sender.clone());
        }
        crate::player::linux_embed::elog(&format!(
            "x11: native-touch keepalive silent for {age}ms — respawning worker"
        ));
        *guard = None;
    }
    // Do not cache a transient XOpenDisplay/startup failure for the entire session. A later focus,
    // navigation, or controller edge can retry once Gamescope's XWayland socket is ready.
    let sender = start_touch_worker()?;
    *guard = Some(sender.clone());
    Ok(sender)
}

fn start_touch_worker() -> Result<SyncSender<()>, String> {
    let (wake_tx, wake_rx) = mpsc::sync_channel(1);
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("izumi-native-touch".into())
        .spawn(move || {
            // This thread creates, uses, and owns the Display for its entire lifetime. It never
            // touches GTK's connection and therefore needs no cross-thread Xlib assumptions.
            let dpy = unsafe { XOpenDisplay(std::ptr::null()) };
            if dpy.is_null() {
                let _ = ready_tx.send(Err("XOpenDisplay(NULL) for touch mode failed".into()));
                return;
            }
            let root = unsafe { XDefaultRootWindow(dpy) };
            if root == 0 {
                let _ = ready_tx.send(Err("XDefaultRootWindow returned 0".into()));
                return;
            }
            let name = b"STEAM_TOUCH_CLICK_MODE\0";
            let atom = unsafe { XInternAtom(dpy, name.as_ptr().cast(), 0) };
            if atom == 0 {
                let _ = ready_tx.send(Err("XInternAtom(STEAM_TOUCH_CLICK_MODE) failed".into()));
                return;
            }

            // Fresh connection: publish it for the IO filter, clear any stale death flag from a
            // previous incarnation, and register the per-display survival handlers.
            TOUCH_DPY_PTR.store(dpy, Ordering::Relaxed);
            TOUCH_DPY_DEAD.store(false, Ordering::Relaxed);
            install_io_guard(dpy);

            TOUCH_ALIVE_MS.store(now_ms(), Ordering::Relaxed);
            write_native_touch(dpy, root, atom);
            if ready_tx.send(Ok(())).is_err() {
                return;
            }
            loop {
                match wake_rx.recv_timeout(TOUCH_KEEPALIVE) {
                    Ok(()) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
                TOUCH_ALIVE_MS.store(now_ms(), Ordering::Relaxed);
                if TOUCH_DPY_DEAD.load(Ordering::Relaxed) {
                    crate::player::linux_embed::elog(
                        "x11: native-touch display connection died — exiting for respawn",
                    );
                    // Deliberately NOT XCloseDisplay: the connection is flagged dead inside
                    // libX11 and further calls no-op; closing a dead display double-frees on
                    // some libX11 versions. One leaked Display per XWayland death is fine.
                    return;
                }
                // A finger is on the screen: stay quiet so OUR write is never the mid-gesture
                // mode transition. Steam's own writes may still land; the fallout is bounded by
                // gamescope pairing every release with its down. Deadline expires on its own.
                if now_ms() < TOUCH_HOLD_UNTIL_MS.load(Ordering::Relaxed) {
                    continue;
                }
                write_native_touch(dpy, root, atom);
            }
        })
        .map_err(|error| format!("could not start native-touch keepalive: {error}"))?;

    match ready_rx.recv_timeout(Duration::from_secs(2)) {
        Ok(Ok(())) => Ok(wake_tx),
        Ok(Err(error)) => Err(error),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err("native-touch keepalive did not start within 2 seconds".into())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("native-touch keepalive stopped during startup".into())
        }
    }
}

// XFlush only, never XSync: XChangeProperty is reply-less, so a flushed write reaches the server
// whenever it reads — while XSync blocks in _XReply with NO timeout, so an alive-but-unresponsive
// server (gamescope stall) could wedge this worker forever. The heartbeat/respawn design assumes
// nothing here can block indefinitely.
fn write_native_touch(dpy: *mut c_void, root: u64, atom: c_ulong) {
    let value: c_ulong = 4; // TouchClickModes::Passthrough
    unsafe {
        XChangeProperty(
            dpy,
            root,
            atom,
            XA_CARDINAL,
            32,
            PROP_MODE_REPLACE,
            (&value as *const c_ulong).cast(),
            1,
        );
        XFlush(dpy);
    }
}

/// Create (once) the mpv container: a raw X11 child of the app's toplevel, fullscreen-sized,
/// input-transparent (touch falls through to the webview). Returns its X11 window id for
/// mpv `--wid`. Idempotent — returns the existing container's id if already created.
pub fn ensure_container(window: &tauri::WebviewWindow, w: u32, h: u32) -> Result<i64, String> {
    // Bound BEFORE the if-let: an if-let scrutinee's guard temporary lives for the whole block,
    // and the closure below re-locks STATE from the glib main thread — holding it here deadlocks.
    let existing = STATE
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|st| st.container);
    if let Some(container) = existing {
        // Re-assert the empty INPUT shape on every reuse. It used to be applied exactly once at
        // creation; if that async request failed (or anything reset the shape), the fullscreen
        // raised container silently swallowed every touch over the video for the whole session.
        // Idempotent and nearly free.
        crate::player::linux_embed::run_on_glib_main(move || {
            if let Ok(guard) = STATE.lock() {
                if let Some(st) = guard.as_ref() {
                    unsafe {
                        XShapeCombineRectangles(
                            st.dpy,
                            st.container,
                            SHAPE_INPUT,
                            0,
                            0,
                            std::ptr::null(),
                            0,
                            SHAPE_SET,
                            0,
                        );
                        XFlush(st.dpy);
                    }
                }
            }
        });
        return Ok(container as i64);
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
            XShapeCombineRectangles(
                dpy,
                container,
                SHAPE_INPUT,
                0,
                0,
                std::ptr::null(),
                0,
                SHAPE_SET,
                0,
            );
            XMapWindow(dpy, container);
            XRaiseWindow(dpy, container);
            XSync(dpy, 0);
        }
        *STATE.lock().map_err(|e| e.to_string())? = Some(X11 {
            dpy,
            container,
            w,
            h,
            frac: 0.0,
        });
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
