//! Linux mpv embed — PHASE 1 SPIKE (untested on hardware; iterate on the Steam Deck).
//!
//! Windows embeds mpv with `--wid` into the host HWND. That doesn't work under
//! gamescope/Wayland (the Deck's gaming mode), so on Linux we use mpv's **OpenGL
//! render API**: render mpv into a `GtkGLArea` that sits UNDER the (transparent)
//! webview via a `GtkOverlay`. The webview UI composites on top.
//!
//! Flow (all on the GTK main thread):
//!   1. make the webview background transparent so mpv shows through;
//!   2. reparent the webview into an Overlay whose base child is a GLArea;
//!   3. on GLArea `realize`: create the mpv core (vo=libmpv) + an OpenGL RenderContext
//!      whose `get_proc_address` resolves GL symbols through libepoxy;
//!   4. mpv's render update callback -> (glib channel) -> `glarea.queue_render()`;
//!   5. on GLArea `render`: read the bound framebuffer id (GTK renders into its OWN
//!      FBO, not 0) and call `render_ctx.render(fbo, w, h, flip)`.
//!
//! This is a proof-of-feasibility. It does NOT wire the event loop / controls yet
//! (that's phase 2) — the goal is: does video appear inside the app window on the Deck?

#![cfg(target_os = "linux")]

use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::Once;

use gtk::prelude::*;
use libmpv2::{
    render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType},
    Mpv,
};

// The GL-context type carried through libmpv's render params. We don't need per-context
// state (epoxy resolves symbols globally), so a unit type is enough.
struct GlCtx;

// mpv's get_proc_address is a BARE `fn` (can't capture) — resolve via epoxy's global
// loader. Cast *const -> *mut at the boundary (libmpv wants *mut c_void).
fn get_proc_address(_ctx: &GlCtx, name: &str) -> *mut c_void {
    epoxy::get_proc_addr(name) as *mut c_void
}

// Per-thread render state (GTK is single-threaded → thread_local + RefCell is fine).
// `mpv` is leaked to 'static so the RenderContext (which borrows it) can be 'static.
struct EmbedState {
    _mpv: &'static Mpv,
    render: RenderContext<'static>,
}

thread_local! {
    static STATE: RefCell<Option<EmbedState>> = const { RefCell::new(None) };
}

static GL_INIT: Once = Once::new();

/// Entry point from the `player_embed_linux` command. Runs the GTK/mpv setup on the
/// main thread (via `with_webview`, which dispatches there and hands us the webview).
pub fn embed_and_play(window: &tauri::WebviewWindow, url: &str) -> Result<(), String> {
    let win = window.clone();
    let url = url.to_string();
    window
        .with_webview(move |pw| {
            if let Err(e) = setup(&win, pw, &url) {
                eprintln!("[izumi] linux embed setup failed: {e}");
            }
        })
        .map_err(|e| e.to_string())
}

fn setup(
    win: &tauri::WebviewWindow,
    pw: tauri::webview::PlatformWebview,
    url: &str,
) -> Result<(), String> {
    GL_INIT.call_once(|| {
        // Load epoxy's own bindings + the `gl` crate through libepoxy.
        epoxy::load_with(|s| epoxy::get_proc_addr(s));
        gl::load_with(|s| epoxy::get_proc_addr(s) as *const c_void);
    });

    // Transparent webview so the mpv layer shows through (Tauri's API → wry → gtk RGBA).
    let _ = win.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));

    let vbox = win.default_vbox().map_err(|e| e.to_string())?; // gtk::Box (window's child)
    let webview = pw.inner(); // webkit2gtk::WebView, IsA<gtk::Widget>

    // Layer: GLArea (base) + webview (on top) inside an Overlay, replacing the webview
    // in the window's vbox.
    let overlay = gtk::Overlay::new();
    let glarea = gtk::GLArea::new();
    glarea.set_hexpand(true);
    glarea.set_vexpand(true);
    glarea.set_has_depth_buffer(false);
    glarea.set_has_stencil_buffer(false);

    vbox.remove(&webview);
    overlay.add(&glarea);
    overlay.add_overlay(&webview);
    // Keep the webview receiving input (it owns the UI + the transparent video hole).
    overlay.set_overlay_pass_through(&webview, false);
    vbox.pack_start(&overlay, true, true, 0);
    overlay.show_all();

    // Redraw signalling: mpv's update callback (render thread) -> glib channel -> main
    // thread -> queue_render. glib's channel Sender is Send+Clone; the receiver runs on
    // the main context.
    let (tx, rx) = glib::MainContext::channel::<()>(glib::Priority::DEFAULT);
    {
        let ga = glarea.clone();
        rx.attach(None, move |_| {
            ga.queue_render();
            glib::ControlFlow::Continue
        });
    }

    // Create the mpv core + render context once the GL context exists.
    let url_owned = url.to_string();
    glarea.connect_realize(move |ga| {
        ga.make_current();
        if let Some(err) = ga.error() {
            eprintln!("[izumi] GLArea realize error: {err}");
            return;
        }
        match make_mpv(&url_owned, tx.clone()) {
            Ok(state) => STATE.with(|s| *s.borrow_mut() = Some(state)),
            Err(e) => eprintln!("[izumi] mpv render init failed: {e}"),
        }
    });

    // Render each frame into the GLArea's framebuffer.
    glarea.connect_render(move |ga, _ctx| {
        STATE.with(|s| {
            if let Some(st) = &*s.borrow() {
                // GTK binds its own FBO before this signal — mpv must target THAT, not 0.
                let mut fbo: gl::types::GLint = 0;
                unsafe { gl::GetIntegerv(gl::FRAMEBUFFER_BINDING, &mut fbo) };
                let scale = ga.scale_factor();
                let w = ga.allocated_width() * scale;
                let h = ga.allocated_height() * scale;
                // flip=true: GL is Y-up, video is Y-down.
                if let Err(e) = st.render.render::<GlCtx>(fbo, w, h, true) {
                    eprintln!("[izumi] mpv render error: {e}");
                }
            }
        });
        glib::Propagation::Proceed
    });

    Ok(())
}

fn make_mpv(url: &str, tx: glib::Sender<()>) -> Result<EmbedState, String> {
    // vo=libmpv is REQUIRED for the render API.
    let mpv = Mpv::with_initializer(|init| {
        init.set_property("vo", "libmpv")?;
        init.set_property("hwdec", "auto-safe")?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    // Leak so the RenderContext borrow can be 'static (single embed for the app's life).
    let mpv: &'static Mpv = Box::leak(Box::new(mpv));

    let mut render = mpv
        .create_render_context(vec![
            RenderParam::ApiType(RenderParamApiType::OpenGl),
            RenderParam::InitParams(OpenGLInitParams {
                get_proc_address,
                ctx: GlCtx,
            }),
        ])
        .map_err(|e| e.to_string())?;

    // Wake the GLArea when a new frame is ready. MUST NOT call mpv from in here.
    render.set_update_callback(move || {
        let _ = tx.send(());
    });

    mpv.command("loadfile", &[url, "replace"]).map_err(|e| e.to_string())?;
    Ok(EmbedState { _mpv: mpv, render })
}
