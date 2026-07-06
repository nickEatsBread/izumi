//! Linux mpv embed — Wayland `wl_subsurface` + EGL + mpv OpenGL render API.
//!
//! ## Why this shape (and not a GtkGLArea)
//! The webview is a WebKitGTK widget that draws into the toplevel `wl_surface`.
//! Reparenting it into a `GtkOverlay` (to layer a GLArea underneath) forces
//! WebKit to unrealize/re-realize its render surface, and WebKit's realize
//! handler SIGSEGVs — the crash is in webkit, reached through a GTK signal
//! cascade from our reparent, and it happens on X11 *and* Wayland alike.
//!
//! The fix is to never touch the webview's GTK hierarchy. Instead we create a
//! raw `wl_subsurface` as a child of the toplevel surface and `place_below` it,
//! give it its OWN EGL context (no sharing with webkit), and render mpv into it
//! via the OpenGL render API. The compositor composites the video below the
//! webview; wherever the webview is transparent (the player's video area), the
//! video shows through. The webview is left completely alone → no crash.
//!
//! ## Threading
//! Every EGL / GL / Wayland-protocol call runs on the GLib main thread — the
//! one thread that owns the EGL context for the renderer's lifetime. Work that
//! originates on a Tauri command thread is marshalled across with
//! [`run_on_glib_main`]. mpv's render-update callback (arbitrary thread) only
//! schedules a `glib::idle_add_once`; it never touches GL directly.
//!
//! ## mpv ownership / lifetimes
//! The mpv core is owned by `PlayerHandle` (its `Mutex<Option<Mpv>>`), so all
//! the existing controls (`command`/`get_property`/`tracks`/…) and the progress
//! event loop work unchanged. [`attach`] builds a [`RenderContext`] bound to
//! that core; libmpv2 ties the context's lifetime to a `&Mpv` borrow, which we
//! extend to `'static` (the context holds an independent `*mut
//! mpv_render_context`, so moving the `Mpv` wrapper into the mutex afterwards is
//! fine). The unsafe extension is sound because [`PlayerHandle::stop`] calls
//! [`detach`] — which drops this context — BEFORE it quits/drops the core.
//!
//! X11 (Steam Deck Game mode / gamescope, which exposes no `wl_subcompositor`)
//! is a separate mechanism handled elsewhere; here we require a Wayland session.

#![cfg(target_os = "linux")]

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use gtk::prelude::*;
use khronos_egl as egl;
use libmpv2::{
    render::{mpv_render_update, OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType},
    Mpv,
};
use raw_window_handle::{
    HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle,
};
use wayland_client::{
    backend::{Backend, ObjectId},
    globals::{registry_queue_init, GlobalListContents},
    protocol::{
        wl_compositor::WlCompositor, wl_registry::WlRegistry,
        wl_subcompositor::WlSubcompositor, wl_subsurface::WlSubsurface, wl_surface::WlSurface,
    },
    Connection, Dispatch, EventQueue, Proxy, QueueHandle,
};
use wayland_egl::WlEglSurface;
use wayland_protocols_wlr::layer_shell::v1::client::{
    zwlr_layer_shell_v1::{Layer, ZwlrLayerShellV1},
    zwlr_layer_surface_v1::{self, Anchor, ZwlrLayerSurfaceV1},
};

// Trace to a file in the app config dir (host: ~/.var/app/com.nicho.izumi/config/) AND
// stderr. Flatpak's sandbox swallows stderr, so the file is the reliable channel while
// bringing this up on the Deck.
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

// =========================================================================
// libEGL loader
// =========================================================================

/// Dynamically loaded `libEGL.so.1`, cached for the process lifetime. Returns
/// `Err` (never panics) so the caller can surface a clean error.
fn egl() -> Result<&'static egl::DynamicInstance<egl::EGL1_4>, String> {
    static INSTANCE: OnceLock<Result<egl::DynamicInstance<egl::EGL1_4>, String>> = OnceLock::new();
    INSTANCE
        .get_or_init(|| {
            // SAFETY: wraps `dlopen("libEGL.so.1")`; the loaded library stays
            // valid for the lifetime of the process.
            unsafe { egl::DynamicInstance::<egl::EGL1_4>::load_required() }
                .map_err(|e| format!("failed to load libEGL: {e}"))
        })
        .as_ref()
        .map_err(|e| e.clone())
}

/// Resolve a GL function pointer via the EGL loader. Used for both `gl::load_with`
/// and libmpv's `get_proc_address`. On Wayland the context is EGL, so we MUST use
/// `eglGetProcAddress` here — epoxy's generic resolver can hand back GLX stubs that
/// crash under an EGL context.
fn gl_proc_address(name: &str) -> *mut c_void {
    match egl() {
        Ok(egl) => egl
            .get_proc_address(name)
            .map_or(std::ptr::null_mut(), |f| f as *mut c_void),
        Err(_) => std::ptr::null_mut(),
    }
}

// libmpv's get_proc_address is a bare `fn` (no captures); the ctx it carries is a
// null `*mut c_void` (we resolve globally through the EGL loader).
fn get_proc_address(_ctx: &*mut c_void, name: &str) -> *mut c_void {
    gl_proc_address(name)
}

// =========================================================================
// Wayland globals dispatcher (registry-only, silent otherwise)
// =========================================================================

struct WlGlobals;

impl Dispatch<WlRegistry, GlobalListContents> for WlGlobals {
    fn event(
        _: &mut Self,
        _: &WlRegistry,
        _: wayland_client::protocol::wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

wayland_client::delegate_noop!(WlGlobals: ignore WlCompositor);
wayland_client::delegate_noop!(WlGlobals: ignore WlSubcompositor);
wayland_client::delegate_noop!(WlGlobals: ignore WlSurface);
wayland_client::delegate_noop!(WlGlobals: ignore WlSubsurface);

// Game-mode (gamescope) layer-shell dispatcher. gamescope has no wl_subcompositor, so the
// video goes on a zwlr_layer_shell_v1 BACKGROUND surface instead of a subsurface. The layer
// surface must ack each Configure (and it carries the compositor-chosen fullscreen size)
// before the first buffer, so unlike WlGlobals this dispatcher is stateful.
struct LayerDispatch {
    configured: Option<(u32, u32)>,
}

impl Dispatch<WlRegistry, GlobalListContents> for LayerDispatch {
    fn event(
        _: &mut Self,
        _: &WlRegistry,
        _: wayland_client::protocol::wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<ZwlrLayerSurfaceV1, ()> for LayerDispatch {
    fn event(
        state: &mut Self,
        surf: &ZwlrLayerSurfaceV1,
        event: zwlr_layer_surface_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let zwlr_layer_surface_v1::Event::Configure { serial, width, height } = event {
            surf.ack_configure(serial);
            state.configured = Some((width, height));
        }
    }
}

wayland_client::delegate_noop!(LayerDispatch: ignore WlCompositor);
wayland_client::delegate_noop!(LayerDispatch: ignore WlSurface);
wayland_client::delegate_noop!(LayerDispatch: ignore ZwlrLayerShellV1);

// =========================================================================
// RAII-owned platform resources
// =========================================================================

/// Owns the EGL context. The initial surface is created here but moved into
/// `SessionState` (which owns ongoing surface lifecycle). The EGL *display* is
/// NOT terminated on drop — it is shared with GTK/WebKit.
struct OwnedEgl {
    display: egl::Display,
    surface: Option<egl::Surface>,
    context: egl::Context,
    config: egl::Config,
}

impl Drop for OwnedEgl {
    fn drop(&mut self) {
        if let Ok(egl) = egl() {
            let _ = egl.make_current(self.display, None, None, None);
            if let Some(s) = self.surface {
                let _ = egl.destroy_surface(self.display, s);
            }
            let _ = egl.destroy_context(self.display, self.context);
        }
    }
}

// SAFETY: opaque handles into libEGL's process-wide state; all EGL calls are
// restricted to the GLib main thread.
unsafe impl Send for OwnedEgl {}
unsafe impl Sync for OwnedEgl {}

/// Held only to keep the event queue (and thus the registry objects) alive for the
/// connection's lifetime; we don't pump events after setup. The dispatch-state type
/// differs per path (subsurface vs layer-shell), hence an enum. The inner queue is never
/// read again — it exists purely to own the objects — so the fields are intentionally unused.
#[allow(dead_code)]
enum QueueHolder {
    Sub(EventQueue<WlGlobals>),
    Layer(EventQueue<LayerDispatch>),
}

/// Owns the Wayland video-surface tree. The initial `WlEglSurface` is created here
/// but moved into `SessionState`.
struct WaylandSession {
    // The bootstrap 1×1 wl_egl_window; `attach` moves it into `SessionState`,
    // where `render_frame` recreates it at the real window size. Kept alive here
    // until then because the initial EGL surface is created from it.
    wl_egl_surface: Option<WlEglSurface>,
    // Exactly one positioner is set: `subsurface` (Desktop/KWin, video below the webview)
    // OR `layer_surface` (gamescope Game mode, video on a BACKGROUND layer). Both render
    // into `child_surface`.
    subsurface: Option<WlSubsurface>,
    layer_surface: Option<ZwlrLayerSurfaceV1>,
    child_surface: WlSurface,
    _queue: Mutex<QueueHolder>,
    conn: Connection,
    // Kept for documentation/debugging; the display is owned by GTK.
    #[allow(dead_code)]
    wl_display_ptr: *mut c_void,
}

impl Drop for WaylandSession {
    fn drop(&mut self) {
        drop(self.wl_egl_surface.take());
        if let Some(s) = &self.subsurface {
            s.destroy();
        }
        if let Some(l) = &self.layer_surface {
            l.destroy();
        }
        self.child_surface.destroy();
        let _ = self.conn.flush();
    }
}

// SAFETY: subsurface/surface protocol requests go through wayland-client's
// internally-locked Backend and are safe from any thread; in practice we only
// touch them on the GLib main thread.
unsafe impl Send for WaylandSession {}
unsafe impl Sync for WaylandSession {}

// =========================================================================
// Mutable per-session state (GLib main thread only, behind a Mutex)
// =========================================================================

struct SessionState {
    egl_display: egl::Display,
    egl_surface: egl::Surface,
    wl_egl_surface: Option<WlEglSurface>,
    pending_resize: Option<(i32, i32)>,
    current_size: (i32, i32),
    csd_offset: (i32, i32),
}

impl Drop for SessionState {
    fn drop(&mut self) {
        if let Ok(egl) = egl() {
            let _ = egl.destroy_surface(self.egl_display, self.egl_surface);
        }
    }
}

// SAFETY: only used on the GLib main thread via `render_frame`; the Mutex
// enforces exclusive access.
unsafe impl Send for SessionState {}

// =========================================================================
// Inner — shared between the renderer and libmpv's update callback
// =========================================================================

struct Inner {
    valid: AtomicBool,
    video_active: AtomicBool,
    // Field drop order (declaration order) matters: render_ctx (frees mpv's GL
    // resources) → state (destroys the EGL surface + WlEglSurface) → egl
    // (destroys the GL context) → wayland (destroys the subsurface tree).
    render_ctx: RenderContext<'static>,
    state: Mutex<SessionState>,
    egl: OwnedEgl,
    wayland: WaylandSession,
}

// SAFETY: `render_ctx`, `egl`, and `wayland` are only dereferenced on the GLib
// main thread (via `render_frame`). The libmpv update callback runs on an
// arbitrary thread but only schedules an idle task; it never touches these
// fields directly. Mutex/Atomic fields are inherently thread-safe.
unsafe impl Send for Inner {}
unsafe impl Sync for Inner {}

/// The single active embed session. `None` when nothing is playing embedded.
static EMBED: Mutex<Option<Arc<Inner>>> = Mutex::new(None);

/// True while an embed session is live (mpv core + subsurface attached).
pub fn is_active() -> bool {
    EMBED.lock().map(|g| g.is_some()).unwrap_or(false)
}

// =========================================================================
// attach / detach
// =========================================================================

/// Build the subsurface + EGL context + mpv render context bound to `mpv`'s core
/// and start driving frames. Runs the GL/Wayland construction on the GLib main
/// thread. `mpv` is borrowed only for the duration of this call (it is moved into
/// `PlayerHandle`'s mutex by the caller afterwards); see the module docs for why
/// the resulting `'static` render context is sound.
pub fn attach(mpv: &Mpv, window: &tauri::WebviewWindow) -> Result<(), String> {
    elog("attach: entry");
    if is_active() {
        return Ok(());
    }
    // `&Mpv` is not `Send`/`'static`, but `run_on_glib_main` blocks until the
    // closure returns, so the borrow stays valid on this stack for the whole
    // dispatch. Transport it as `usize` and reconstruct on the other side.
    let mpv_usize = (mpv as *const Mpv) as usize;
    let win = window.clone();
    run_on_glib_main(move || -> Result<(), String> {
        // SAFETY: the caller's `&Mpv` outlives this blocking call.
        let mpv: &Mpv = unsafe { &*(mpv_usize as *const Mpv) };

        let (wl_surface_ptr, wl_display_ptr) = raw_wayland_ptrs(&win)?;

        // Transparency: let the compositor blend the webview over the video
        // subsurface. The webview's own background is set transparent by the
        // caller; here we stop GTK from advertising the toplevel surface as
        // opaque (which would make the compositor skip blending).
        let gtk_win = win.gtk_window().map_err(|e| e.to_string())?;
        gtk_win.set_app_paintable(true);
        // CRITICAL companion to app_paintable: once app-paintable is set, GTK stops
        // clearing the window background, so we must clear it to fully transparent
        // ourselves on every draw. Without this, removed HTML (a closed subtitle menu,
        // the scrub tooltip) is repainted by WebKit ON TOP of its old pixels instead of
        // onto transparent → ghost rectangles that linger until a resize forces a full
        // repaint. This replicates what Tauri's `transparent: true` installs — done at
        // runtime here so we never change the Windows window. The clip is the damage
        // region, and children (the webview) draw AFTER (Propagation::Proceed), so only
        // changed areas are cleared+redrawn (no flicker for static UI).
        gtk_win.connect_draw(|_w, cr| {
            cr.set_operator(gtk::cairo::Operator::Source);
            cr.set_source_rgba(0.0, 0.0, 0.0, 0.0);
            let _ = cr.paint();
            cr.set_operator(gtk::cairo::Operator::Over);
            glib::Propagation::Proceed
        });
        if let Some(gdk_win) = gtk_win.window() {
            use glib::translate::ToGlibPtr;
            // Clear the toplevel's opaque region (region = NULL) so the compositor
            // blends the webview over the video subsurface. Called via the C API to
            // avoid depending on a specific gdk-rs trait signature.
            extern "C" {
                fn gdk_window_set_opaque_region(
                    window: *mut gdk::ffi::GdkWindow,
                    region: *mut c_void,
                );
            }
            unsafe {
                gdk_window_set_opaque_region(gdk_win.to_glib_none().0, std::ptr::null_mut());
            }
        }

        let csd = csd_offset(&win, &gtk_win);
        let alloc = gtk_win.allocation();
        let w0 = alloc.width().max(1);
        let h0 = alloc.height().max(1);

        // Desktop/KWin composites a subsurface below the webview. gamescope (Game mode) has
        // NO wl_subcompositor but HAS zwlr_layer_shell_v1 → put the video on a fullscreen
        // BACKGROUND layer surface instead; the transparent webview toplevel composites over it.
        let (has_sub, has_layer) = display_has_globals(wl_display_ptr);
        let (mut egl_res, mut wayland) = if !has_sub && has_layer {
            elog("attach: gamescope path — layer-shell background (no wl_subcompositor)");
            build_wayland_layer(wl_display_ptr, w0, h0)?
        } else {
            build_wayland(wl_surface_ptr, wl_display_ptr)?
        };
        elog("attach: video surface + EGL built");

        let egl = egl()?;
        let display = egl_res.display;
        let context = egl_res.context;
        let surface = egl_res.surface.take().ok_or("EGL surface already taken")?;
        let wl_egl = wayland
            .wl_egl_surface
            .take()
            .ok_or("bootstrap wl_egl_window already taken")?;

        egl.make_current(display, Some(surface), Some(surface), Some(context))
            .map_err(|e| format!("eglMakeCurrent (init): {e:?}"))?;
        gl::load_with(|name| gl_proc_address(name) as *const _);

        let render_ctx = mpv
            .create_render_context::<*mut c_void>(vec![
                RenderParam::ApiType(RenderParamApiType::OpenGl),
                RenderParam::InitParams(OpenGLInitParams {
                    get_proc_address,
                    ctx: std::ptr::null_mut::<c_void>(),
                }),
                // Hand mpv the compositor's display so its GL/EGL interop and
                // presentation timing work on Wayland.
                RenderParam::WaylandDisplay(wl_display_ptr as *const c_void),
            ])
            .map_err(|e| format!("mpv_render_context_create: {e}"))?;
        // SAFETY: extend the borrow to 'static. The core is owned by
        // PlayerHandle and outlives this context — stop() drops this (via
        // detach) before quitting the core. See module docs.
        let render_ctx: RenderContext<'static> = unsafe { std::mem::transmute(render_ctx) };
        elog("attach: render context created");

        // Clear the subsurface to black once so nothing shows through before the
        // first decoded frame.
        unsafe {
            gl::ClearColor(0.0, 0.0, 0.0, 1.0);
            gl::Clear(gl::COLOR_BUFFER_BIT);
        }
        let _ = egl.swap_buffers(display, surface);
        let _ = egl.make_current(display, None, None, None);

        let inner = Arc::new_cyclic(move |weak: &Weak<Inner>| {
            let weak = weak.clone();
            let mut render_ctx = render_ctx;
            // Render-thread wakeup: schedule a frame on the GLib main thread.
            // MUST NOT call any mpv render API from inside this callback.
            render_ctx.set_update_callback(move || {
                if let Some(alive) = weak.upgrade() {
                    glib::idle_add_once(move || {
                        if alive.valid.load(Ordering::Acquire) {
                            render_frame(&alive);
                        }
                    });
                }
            });
            Inner {
                valid: AtomicBool::new(true),
                video_active: AtomicBool::new(true),
                render_ctx,
                state: Mutex::new(SessionState {
                    egl_display: display,
                    egl_surface: surface,
                    // The bootstrap 1×1 surface; recreated at (w0,h0) on the first
                    // render_frame via `pending_resize`.
                    wl_egl_surface: Some(wl_egl),
                    pending_resize: Some((w0, h0)),
                    current_size: (1, 1),
                    csd_offset: csd,
                }),
                egl: egl_res,
                wayland,
            }
        });

        // Position the subsurface at the content-area origin and show it (Desktop). The
        // layer surface is anchored fullscreen by the compositor, so it needs no position.
        if let Some(sub) = &inner.wayland.subsurface {
            sub.set_position(csd.0, csd.1);
        }
        inner.wayland.child_surface.commit();
        let _ = inner.wayland.conn.flush();

        if let Ok(mut g) = EMBED.lock() {
            *g = Some(inner.clone());
        }

        // Keep the video sized to the window on resize/maximize.
        let weak_resize = Arc::downgrade(&inner);
        gtk_win.connect_size_allocate(move |_w, rect| {
            let Some(inner) = weak_resize.upgrade() else { return };
            let nw = rect.width().max(1);
            let nh = rect.height().max(1);
            if let Ok(mut st) = inner.state.lock() {
                st.pending_resize = Some((nw, nh));
                let (cx, cy) = st.csd_offset;
                if let Some(sub) = &inner.wayland.subsurface {
                    sub.set_position(cx, cy);
                }
                inner.wayland.child_surface.commit();
                let _ = inner.wayland.conn.flush();
            }
            let weak = Arc::downgrade(&inner);
            glib::idle_add_once(move || {
                if let Some(alive) = weak.upgrade() {
                    if alive.valid.load(Ordering::Acquire) {
                        render_frame(&alive);
                    }
                }
            });
        });

        // Kick the first render so the surface sizes to the window immediately.
        let weak_first = Arc::downgrade(&inner);
        glib::idle_add_once(move || {
            if let Some(alive) = weak_first.upgrade() {
                render_frame(&alive);
            }
        });

        // A wl_subsurface's set_position/place_below are SYNCHRONIZED to the PARENT surface
        // commit; GTK only commits the toplevel on redraw, so without this the subsurface
        // never maps at the right spot at play-start (black until a manual resize). A short
        // burst of toplevel redraws over the first ~0.8s applies the placement once mpv's
        // first frame is up. NOTE: queue_draw does NOT clear WebKit's web-process backing
        // store (it only marks the UI-side GTK node dirty), so it CANNOT fix HTML ghost
        // trails — that is solved on the frontend by compositing-layer promotion (moving the
        // scrub tooltip via `transform` + `will-change`). Hence this is a short burst, not a
        // continuous loop.
        let gw = gtk_win.clone();
        let mut ticks = 0u32;
        glib::timeout_add_local(std::time::Duration::from_millis(60), move || {
            gw.queue_draw();
            ticks += 1;
            if ticks < 14 {
                glib::ControlFlow::Continue
            } else {
                glib::ControlFlow::Break
            }
        });

        elog("attach: done");
        Ok(())
    })
}

/// Tear down the active embed session (drop the render context + EGL + subsurface
/// on the GLib main thread). MUST run before the mpv core is quit/dropped so the
/// render context — which references the core — is freed first.
pub fn detach() {
    let taken = EMBED.lock().ok().and_then(|mut g| g.take());
    let Some(inner) = taken else { return };
    inner.valid.store(false, Ordering::Release);
    inner.video_active.store(false, Ordering::Release);
    // Hide the subsurface before destroying it so no stale frame flashes (Desktop). The
    // layer surface is torn down on drop below; a fullscreen background can't be moved
    // offscreen the same way, so we just proceed to destroy.
    if let Some(sub) = &inner.wayland.subsurface {
        sub.set_position(-32000, -32000);
        inner.wayland.child_surface.commit();
        let _ = inner.wayland.conn.flush();
    }
    run_on_glib_main(move || {
        drop(inner);
    });
    elog("detach: torn down");
}

// =========================================================================
// Per-frame render — GLib main thread only
// =========================================================================

fn render_frame(inner: &Inner) {
    if !inner.video_active.load(Ordering::Acquire) {
        return;
    }
    let Ok(egl) = egl() else { return };
    let display = inner.egl.display;
    let context = inner.egl.context;

    let mut state = match inner.state.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };

    // Recreate the EGL surface at the new size rather than
    // wl_egl_window_resize, which corrupts mpv's textures on some VM GL drivers.
    let resized = if let Some((nw, nh)) = state.pending_resize.take() {
        let _ = egl.make_current(display, None, None, None);
        let _ = egl.destroy_surface(display, state.egl_surface);
        drop(state.wl_egl_surface.take());

        let child_id = inner.wayland.child_surface.id();
        match recreate_egl_surface(egl, display, inner.egl.config, child_id, nw, nh) {
            Some((new_wl, new_egl)) => {
                state.wl_egl_surface = Some(new_wl);
                state.egl_surface = new_egl;
                state.current_size = (nw, nh);
                true
            }
            None => {
                elog("render: EGL surface recreation failed");
                return;
            }
        }
    } else {
        false
    };

    let surface = state.egl_surface;
    let (w, h) = state.current_size;
    drop(state);

    if w < 1 || h < 1 {
        return;
    }
    if egl
        .make_current(display, Some(surface), Some(surface), Some(context))
        .is_err()
    {
        return;
    }

    if resized {
        unsafe {
            gl::Viewport(0, 0, w, h);
            gl::ClearColor(0.0, 0.0, 0.0, 1.0);
            gl::Clear(gl::COLOR_BUFFER_BIT);
        }
        let _ = egl.swap_buffers(display, surface);
        inner.wayland.child_surface.damage_buffer(0, 0, w, h);
        inner.wayland.child_surface.commit();
        let _ = inner.wayland.conn.flush();
    }

    let has_frame = match inner.render_ctx.update() {
        Ok(flags) => flags & mpv_render_update::Frame != 0,
        Err(_) => false,
    };
    if !has_frame && !resized {
        return;
    }

    // flip=true: GL is Y-up, video is Y-down. FBO 0 = the EGL back buffer.
    if inner.render_ctx.render::<*mut c_void>(0, w, h, true).is_err() {
        return;
    }
    if egl.swap_buffers(display, surface).is_err() {
        return;
    }
    inner.wayland.child_surface.damage_buffer(0, 0, w, h);
    inner.wayland.child_surface.commit();
    let _ = inner.wayland.conn.flush();
    inner.render_ctx.report_swap();
}

fn recreate_egl_surface(
    egl: &egl::DynamicInstance<egl::EGL1_4>,
    display: egl::Display,
    config: egl::Config,
    child_id: ObjectId,
    w: i32,
    h: i32,
) -> Option<(WlEglSurface, egl::Surface)> {
    let new_wl = WlEglSurface::new(child_id, w, h).ok()?;
    // SAFETY: `new_wl.ptr()` is a valid `wl_egl_window *` kept alive by the
    // returned `WlEglSurface`.
    let new_egl = unsafe {
        egl.create_window_surface(display, config, new_wl.ptr() as egl::NativeWindowType, None)
    }
    .ok()?;
    Some((new_wl, new_egl))
}

// =========================================================================
// Construction
// =========================================================================

/// Extract the toplevel `wl_surface` and `wl_display` pointers from the Tauri
/// window. Errors (rather than crashing) on a non-Wayland session — the X11 /
/// gamescope path is handled by a different mechanism.
fn raw_wayland_ptrs(win: &tauri::WebviewWindow) -> Result<(*mut c_void, *mut c_void), String> {
    let rw = win
        .window_handle()
        .map_err(|e| format!("window handle: {e:?}"))?
        .as_raw();
    let rd = win
        .display_handle()
        .map_err(|e| format!("display handle: {e:?}"))?
        .as_raw();
    match (rw, rd) {
        (RawWindowHandle::Wayland(wh), RawDisplayHandle::Wayland(dh)) => {
            Ok((wh.surface.as_ptr(), dh.display.as_ptr()))
        }
        _ => Err("embedded player requires a Wayland session".into()),
    }
}

/// True if the Tauri window is a native Wayland surface (Desktop / KWin). False on X11
/// (Steam Deck Game mode / gamescope, where the app runs as an XWayland X11 client). Used
/// to route playback: Wayland → the wl_subsurface embed; X11 → mpv `--wid` embedding.
pub fn is_wayland(window: &tauri::WebviewWindow) -> bool {
    window
        .window_handle()
        .map(|h| matches!(h.as_raw(), RawWindowHandle::Wayland(_)))
        .unwrap_or(false)
}

/// The toplevel X11 window id for mpv `--wid` embedding under gamescope (Game mode). Errors
/// on a non-X11 window. Kept as the toplevel-XID accessor; the container path uses `raw_x11`.
#[allow(dead_code)]
pub fn x11_window_id(window: &tauri::WebviewWindow) -> Result<i64, String> {
    let raw = window
        .window_handle()
        .map_err(|e| format!("window handle: {e:?}"))?
        .as_raw();
    match raw {
        RawWindowHandle::Xlib(h) => Ok(h.window as i64),
        RawWindowHandle::Xcb(h) => Ok(h.window.get() as i64),
        _ => Err("not an X11 window".into()),
    }
}

fn build_wayland(
    wl_surface_ptr: *mut c_void,
    wl_display_ptr: *mut c_void,
) -> Result<(OwnedEgl, WaylandSession), String> {
    let egl = egl()?;

    // Secondary reference to GTK's Wayland connection — shares the fd + object
    // namespace, so `ObjectId::from_ptr` recognises GTK's parent surface.
    // SAFETY: `wl_display_ptr` is GTK's live `wl_display`; `from_foreign_display`
    // only bumps a refcount and never frees it.
    let backend = unsafe { Backend::from_foreign_display(wl_display_ptr as *mut _) };
    let conn = Connection::from_backend(backend);

    let (globals, mut queue) = registry_queue_init::<WlGlobals>(&conn)
        .map_err(|e| format!("wayland registry_queue_init: {e}"))?;
    let qh = queue.handle();

    let compositor: WlCompositor = globals
        .bind(&qh, 4..=5, ())
        .map_err(|e| format!("bind wl_compositor: {e}"))?;
    let subcompositor: WlSubcompositor = globals
        .bind(&qh, 1..=1, ())
        .map_err(|e| format!("bind wl_subcompositor: {e}"))?;

    let mut dummy = WlGlobals;
    queue
        .roundtrip(&mut dummy)
        .map_err(|e| format!("wayland roundtrip: {e}"))?;

    // Wrap GTK's parent surface pointer as a proxy so we can parent to it. We
    // never receive events on it and its Drop does not destroy it — GTK owns it.
    // SAFETY: valid `wl_surface *` on the same connection (shared fd).
    let parent_id = unsafe { ObjectId::from_ptr(WlSurface::interface(), wl_surface_ptr as *mut _) }
        .map_err(|_| "invalid parent wl_surface pointer")?;
    let parent_surface =
        WlSurface::from_id(&conn, parent_id).map_err(|_| "cannot proxy parent wl_surface")?;

    let child_surface = compositor.create_surface(&qh, ());
    let subsurface = subcompositor.get_subsurface(&child_surface, &parent_surface, &qh, ());
    subsurface.place_below(&parent_surface);
    subsurface.set_desync();
    child_surface.commit();
    conn.flush().map_err(|e| format!("wayland flush: {e}"))?;

    // Prefer eglGetPlatformDisplayEXT(WAYLAND) so mpv's Wayland integration
    // recognises the display; fall back to eglGetDisplay on old drivers.
    const EGL_PLATFORM_WAYLAND_EXT: u32 = 0x31D8;
    let egl_display = wayland_egl_display(egl, wl_display_ptr, EGL_PLATFORM_WAYLAND_EXT)?;

    // eglInitialize is idempotent per spec, but some Mesa releases mishandle a
    // double-init on GTK's already-initialised display. Only init if needed.
    if egl.query_string(Some(egl_display), egl::VERSION).is_err() {
        egl.initialize(egl_display)
            .map_err(|e| format!("eglInitialize: {e:?}"))?;
    }

    let config_attribs = [
        egl::RED_SIZE, 8,
        egl::GREEN_SIZE, 8,
        egl::BLUE_SIZE, 8,
        egl::ALPHA_SIZE, 8,
        egl::DEPTH_SIZE, 0,
        egl::STENCIL_SIZE, 0,
        egl::RENDERABLE_TYPE, egl::OPENGL_BIT,
        egl::SURFACE_TYPE, egl::WINDOW_BIT,
        egl::NONE,
    ];
    let config = egl
        .choose_first_config(egl_display, &config_attribs)
        .map_err(|e| format!("eglChooseConfig: {e:?}"))?
        .ok_or("no suitable EGL config")?;
    egl.bind_api(egl::OPENGL_API)
        .map_err(|e| format!("eglBindAPI(OPENGL): {e:?}"))?;

    // Start at 1×1; `render_frame` recreates it at the real window size.
    let wl_egl_surface = WlEglSurface::new(child_surface.id(), 1, 1)
        .map_err(|e| format!("wl_egl_window_create: {e:?}"))?;
    // SAFETY: valid `wl_egl_window *`, alive for the initial-surface build.
    let egl_surface = unsafe {
        egl.create_window_surface(
            egl_display,
            config,
            wl_egl_surface.ptr() as egl::NativeWindowType,
            None,
        )
    }
    .map_err(|e| format!("eglCreateWindowSurface: {e:?}"))?;

    let context_attribs = [
        egl::CONTEXT_MAJOR_VERSION, 3,
        egl::CONTEXT_MINOR_VERSION, 2,
        egl::CONTEXT_OPENGL_PROFILE_MASK, egl::CONTEXT_OPENGL_CORE_PROFILE_BIT,
        egl::NONE,
    ];
    let egl_context = egl
        .create_context(egl_display, config, None, &context_attribs)
        .map_err(|e| format!("eglCreateContext: {e:?}"))?;

    let egl_res = OwnedEgl {
        display: egl_display,
        surface: Some(egl_surface),
        context: egl_context,
        config,
    };
    let wayland = WaylandSession {
        wl_egl_surface: Some(wl_egl_surface),
        subsurface: Some(subsurface),
        layer_surface: None,
        child_surface,
        _queue: Mutex::new(QueueHolder::Sub(queue)),
        conn,
        wl_display_ptr,
    };
    Ok((egl_res, wayland))
}

/// Which compositing globals the GTK Wayland display advertises: (has_wl_subcompositor,
/// has_zwlr_layer_shell_v1). Decides the video path — subsurface (Desktop) vs layer-shell
/// (gamescope). Defaults to (true, false) on error so Desktop behavior is unchanged.
fn display_has_globals(wl_display_ptr: *mut c_void) -> (bool, bool) {
    (|| -> Option<(bool, bool)> {
        // SAFETY: GTK's live wl_display; from_foreign_display only bumps a refcount.
        let backend = unsafe { Backend::from_foreign_display(wl_display_ptr as *mut _) };
        let conn = Connection::from_backend(backend);
        let (globals, _q) = registry_queue_init::<WlGlobals>(&conn).ok()?;
        let (mut sub, mut layer) = (false, false);
        globals.contents().with_list(|list| {
            for g in list {
                match g.interface.as_str() {
                    "wl_subcompositor" => sub = true,
                    "zwlr_layer_shell_v1" => layer = true,
                    _ => {}
                }
            }
        });
        Some((sub, layer))
    })()
    .unwrap_or((true, false))
}

/// gamescope (Game mode) variant of [`build_wayland`]: gamescope exposes NO wl_subcompositor,
/// so the video goes on a `zwlr_layer_shell_v1` BACKGROUND surface (fullscreen, anchored to all
/// edges) instead of a subsurface. The transparent webview toplevel sits above it and gamescope
/// composites the two → HTML controls over fullscreen video. `w0`/`h0` are the fallback size if
/// the compositor's first configure carries none. EGL setup mirrors `build_wayland`.
fn build_wayland_layer(
    wl_display_ptr: *mut c_void,
    w0: i32,
    h0: i32,
) -> Result<(OwnedEgl, WaylandSession), String> {
    let egl = egl()?;

    // SAFETY: GTK's live wl_display, shared fd + object namespace.
    let backend = unsafe { Backend::from_foreign_display(wl_display_ptr as *mut _) };
    let conn = Connection::from_backend(backend);

    let (globals, mut queue) = registry_queue_init::<LayerDispatch>(&conn)
        .map_err(|e| format!("wayland registry_queue_init (layer): {e}"))?;
    let qh = queue.handle();

    let compositor: WlCompositor = globals
        .bind(&qh, 4..=5, ())
        .map_err(|e| format!("bind wl_compositor: {e}"))?;
    let layer_shell: ZwlrLayerShellV1 = globals
        .bind(&qh, 1..=4, ())
        .map_err(|e| format!("bind zwlr_layer_shell_v1: {e}"))?;

    let child_surface = compositor.create_surface(&qh, ());
    // Background layer, fullscreen (anchor all edges + size 0×0 = fill), exclusive_zone -1 so
    // it ignores panels and truly fills the output.
    let layer_surface = layer_shell.get_layer_surface(
        &child_surface,
        None,
        Layer::Background,
        "izumi-video".to_string(),
        &qh,
        (),
    );
    layer_surface.set_anchor(Anchor::Top | Anchor::Bottom | Anchor::Left | Anchor::Right);
    layer_surface.set_exclusive_zone(-1);
    layer_surface.set_size(0, 0);
    child_surface.commit(); // initial commit (no buffer) → triggers the first configure
    conn.flush().map_err(|e| format!("wayland flush (layer): {e}"))?;

    // A layer surface must ack its Configure (which also carries the fullscreen size) BEFORE
    // the first buffer. LayerDispatch acks + records the size.
    let mut disp = LayerDispatch { configured: None };
    for _ in 0..20 {
        queue
            .roundtrip(&mut disp)
            .map_err(|e| format!("wayland roundtrip (layer): {e}"))?;
        if disp.configured.is_some() {
            break;
        }
    }
    let (cw, ch) = disp
        .configured
        .unwrap_or((w0.max(1) as u32, h0.max(1) as u32));
    elog(&format!("layer-shell configured {cw}x{ch}"));

    // ---- EGL (identical to build_wayland) ----
    const EGL_PLATFORM_WAYLAND_EXT: u32 = 0x31D8;
    let egl_display = wayland_egl_display(egl, wl_display_ptr, EGL_PLATFORM_WAYLAND_EXT)?;
    if egl.query_string(Some(egl_display), egl::VERSION).is_err() {
        egl.initialize(egl_display)
            .map_err(|e| format!("eglInitialize: {e:?}"))?;
    }
    let config_attribs = [
        egl::RED_SIZE, 8,
        egl::GREEN_SIZE, 8,
        egl::BLUE_SIZE, 8,
        egl::ALPHA_SIZE, 8,
        egl::DEPTH_SIZE, 0,
        egl::STENCIL_SIZE, 0,
        egl::RENDERABLE_TYPE, egl::OPENGL_BIT,
        egl::SURFACE_TYPE, egl::WINDOW_BIT,
        egl::NONE,
    ];
    let config = egl
        .choose_first_config(egl_display, &config_attribs)
        .map_err(|e| format!("eglChooseConfig: {e:?}"))?
        .ok_or("no suitable EGL config")?;
    egl.bind_api(egl::OPENGL_API)
        .map_err(|e| format!("eglBindAPI(OPENGL): {e:?}"))?;

    let wl_egl_surface = WlEglSurface::new(child_surface.id(), 1, 1)
        .map_err(|e| format!("wl_egl_window_create: {e:?}"))?;
    // SAFETY: valid wl_egl_window *, alive for the initial-surface build.
    let egl_surface = unsafe {
        egl.create_window_surface(
            egl_display,
            config,
            wl_egl_surface.ptr() as egl::NativeWindowType,
            None,
        )
    }
    .map_err(|e| format!("eglCreateWindowSurface: {e:?}"))?;

    let context_attribs = [
        egl::CONTEXT_MAJOR_VERSION, 3,
        egl::CONTEXT_MINOR_VERSION, 2,
        egl::CONTEXT_OPENGL_PROFILE_MASK, egl::CONTEXT_OPENGL_CORE_PROFILE_BIT,
        egl::NONE,
    ];
    let egl_context = egl
        .create_context(egl_display, config, None, &context_attribs)
        .map_err(|e| format!("eglCreateContext: {e:?}"))?;

    let egl_res = OwnedEgl {
        display: egl_display,
        surface: Some(egl_surface),
        context: egl_context,
        config,
    };
    let wayland = WaylandSession {
        wl_egl_surface: Some(wl_egl_surface),
        subsurface: None,
        layer_surface: Some(layer_surface),
        child_surface,
        _queue: Mutex::new(QueueHolder::Layer(queue)),
        conn,
        wl_display_ptr,
    };
    Ok((egl_res, wayland))
}

fn wayland_egl_display(
    egl: &egl::DynamicInstance<egl::EGL1_4>,
    wl_display_ptr: *mut c_void,
    platform_enum: u32,
) -> Result<egl::Display, String> {
    type GetPlatformDisplayExt =
        unsafe extern "C" fn(u32, *mut c_void, *const i32) -> *mut c_void;

    if let Some(get_fn) = egl.get_proc_address("eglGetPlatformDisplayEXT") {
        // SAFETY: documented signature EGLDisplay(EGLenum, void*, const EGLint*).
        let get_platform_display: GetPlatformDisplayExt = unsafe { std::mem::transmute(get_fn) };
        // SAFETY: valid wl_display pointer.
        let d_ptr =
            unsafe { get_platform_display(platform_enum, wl_display_ptr, std::ptr::null()) };
        if !d_ptr.is_null() {
            // SAFETY: `egl::Display` is repr(transparent) over `*mut c_void`.
            return Ok(unsafe { std::mem::transmute::<*mut c_void, egl::Display>(d_ptr) });
        }
    }
    // SAFETY: fallback; eglGetDisplay accepts any native display pointer.
    unsafe { egl.get_display(wl_display_ptr) }
        .ok_or_else(|| "eglGetDisplay returned EGL_NO_DISPLAY".to_string())
}

/// GTK CSD (shadow + titlebar/vbox) offset so subsurface coordinates — relative
/// to the toplevel `wl_surface` — line up with the webview content area.
fn csd_offset(win: &tauri::WebviewWindow, gtk_win: &gtk::ApplicationWindow) -> (i32, i32) {
    (|| -> Option<(i32, i32)> {
        let vbox = win.default_vbox().ok()?;
        let (vbox_x, vbox_y) = vbox.translate_coordinates(gtk_win, 0, 0)?;
        let gdk_win = gtk_win.window()?;
        let alloc = gtk_win.allocation();
        let shadow_x = (gdk_win.width() - alloc.width()).max(0) / 2;
        let shadow_y = (gdk_win.height() - alloc.height()).max(0) / 2;
        Some((shadow_x + vbox_x, shadow_y + vbox_y))
    })()
    .unwrap_or((0, 0))
}

// =========================================================================
// GLib main-thread dispatch
// =========================================================================

/// Run `f` on the GLib main thread, blocking until it returns. Runs inline if
/// already on the main thread (so it is safe to call from a sync Tauri command,
/// which Tauri runs on the main thread).
pub(crate) fn run_on_glib_main<F, T>(f: F) -> T
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    let main_ctx = glib::MainContext::default();
    if main_ctx.is_owner() {
        return f();
    }
    let (tx, rx) = std::sync::mpsc::channel();
    main_ctx.invoke(move || {
        let _ = tx.send(f());
    });
    match rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(value) => value,
        Err(e) => {
            elog(&format!("run_on_glib_main: dispatch failed: {e}"));
            panic!("GLib main-thread dispatch failed: {e}");
        }
    }
}

// =========================================================================
// Game-mode (gamescope) compositor capability probe
// =========================================================================

/// One-shot compositor capability probe for the Steam Deck Game-mode (gamescope) bring-up.
/// Writes findings to `izumi-embed.log` (read back over SSH after ONE boot) so we pick the
/// video-overlay architecture from MEASURED facts, not guesses. The two load-bearing unknowns:
///   - X11 per-pixel alpha: does the X screen report `composited` + an RGBA visual? Needed for
///     a transparent webview to blend over an mpv X11 surface beneath it.
///   - `wl_subcompositor`: does any reachable Wayland display (incl. gamescope's own socket)
///     advertise it? Needed for the Desktop `wl_subsurface` path to work if we route the app
///     through native Wayland under gamescope.
/// Best-effort; never panics, never touches the live video path.
pub fn probe_compositor(window: &tauri::WebviewWindow) {
    elog("==== gamescope/compositor PROBE ====");

    let kind = window
        .window_handle()
        .ok()
        .map(|h| match h.as_raw() {
            RawWindowHandle::Wayland(_) => "Wayland",
            RawWindowHandle::Xlib(_) => "Xlib",
            RawWindowHandle::Xcb(_) => "Xcb",
            _ => "other",
        })
        .unwrap_or("unknown");
    elog(&format!("window handle: {kind}"));

    for k in [
        "WAYLAND_DISPLAY", "GAMESCOPE_WAYLAND_DISPLAY", "DISPLAY", "XDG_RUNTIME_DIR",
        "XDG_SESSION_TYPE", "GDK_BACKEND", "STEAM_GAMESCOPE",
    ] {
        elog(&format!("env {k}={:?}", std::env::var(k).ok()));
    }

    if let Ok(rt) = std::env::var("XDG_RUNTIME_DIR") {
        if let Ok(rd) = std::fs::read_dir(&rt) {
            let mut socks: Vec<String> = rd
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.starts_with("wayland") || n.starts_with("gamescope"))
                .collect();
            socks.sort();
            elog(&format!("runtime sockets: {socks:?}"));
        }
    }

    // X11 transparency capability (RGBA visual + a compositing manager present).
    if let Ok(gw) = window.gtk_window() {
        if let Some(screen) = WidgetExt::screen(&gw) {
            elog(&format!(
                "gdk screen: composited={} rgba_visual={}",
                screen.is_composited(),
                screen.rgba_visual().is_some()
            ));
        }
    }

    // Enumerate Wayland globals for each candidate socket (env first, then gamescope's usual
    // names). A SECOND wayland client can connect even while the app runs on XWayland.
    let mut cands: Vec<String> = Vec::new();
    for k in ["WAYLAND_DISPLAY", "GAMESCOPE_WAYLAND_DISPLAY"] {
        if let Ok(v) = std::env::var(k) {
            if !v.is_empty() {
                cands.push(v);
            }
        }
    }
    for c in ["gamescope-0", "wayland-0", "wayland-1"] {
        cands.push(c.to_string());
    }
    cands.dedup();
    for name in cands {
        match wayland_globals_for(&name) {
            Ok(list) => {
                let has_sub = list.iter().any(|s| s == "wl_subcompositor");
                let has_comp = list.iter().any(|s| s == "wl_compositor");
                let has_vp = list.iter().any(|s| s == "wp_viewporter");
                elog(&format!(
                    "wayland '{name}': wl_subcompositor={has_sub} wl_compositor={has_comp} wp_viewporter={has_vp}"
                ));
                elog(&format!("wayland '{name}' globals: {list:?}"));
            }
            Err(e) => elog(&format!("wayland '{name}': connect failed: {e}")),
        }
    }
    elog("==== PROBE end ====");
}

/// Connect a throwaway wayland client to the named socket and return its advertised global
/// interfaces. Swaps `WAYLAND_DISPLAY` around `connect_to_env` (restored after) since
/// wayland-client 0.31 only connects via env.
fn wayland_globals_for(name: &str) -> Result<Vec<String>, String> {
    let prev = std::env::var("WAYLAND_DISPLAY").ok();
    std::env::set_var("WAYLAND_DISPLAY", name);
    let res = (|| -> Result<Vec<String>, String> {
        let conn = Connection::connect_to_env().map_err(|e| e.to_string())?;
        let (globals, _q) =
            registry_queue_init::<WlGlobals>(&conn).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        globals
            .contents()
            .with_list(|list| out.extend(list.iter().map(|g| g.interface.clone())));
        Ok(out)
    })();
    match prev {
        Some(p) => std::env::set_var("WAYLAND_DISPLAY", p),
        None => std::env::remove_var("WAYLAND_DISPLAY"),
    }
    res
}

// Keep the Weak import meaningful even if the callback path is refactored.
const _: fn() = || {
    let _: Option<Weak<Inner>> = None;
};
