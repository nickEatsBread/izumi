//! Playback wakelock — keep the OS from dimming / blanking / sleeping the screen while a
//! video is actively playing, and release so normal battery-saver resumes when paused,
//! stopped, or on any other screen.
//!
//! Driven entirely from the JS side: the player overlay calls the `set_idle_inhibit`
//! command with `on = !paused && !eof`, gated by the user's "Keep screen awake while
//! playing" setting — so all play/pause/close logic already lives there and this module
//! is just the per-OS mechanism.
//!
//! Why it exists: the embedded libmpv paths cannot reliably reset SteamOS's own idle timer.
//! We inhibit per-OS instead:
//!
//!   * **Linux Wayland** — a `zwp_idle_inhibit_manager_v1` inhibitor on the app's toplevel
//!     surface. Bound/toggled on GTK's main thread, where its Wayland connection lives.
//!   * **Linux X11 / Steam Deck Game mode** — first request the sandbox-safe XDG Inhibit
//!     portal, then periodically reset the X11 screensaver timer while playback is active.
//!     SteamOS's gamescope portal currently lacks Inhibit, so the heartbeat is the important
//!     Game-mode path. A held `systemd-inhibit` child is retained as a final best-effort
//!     system-suspend fallback outside the Flatpak sandbox.
//!   * **Windows** — `SetThreadExecutionState(DISPLAY|SYSTEM)` on a dedicated long-lived
//!     thread (the continuous request is cleared when the *setting* thread exits, so one
//!     owner thread must both set and clear it — not Tauri's rotating command-thread pool).
//!   * **macOS** — a held `caffeinate -d -i` child (Apple's own idle-assertion tool).
//!
//! Every backend is idempotent: engaging while already engaged, or releasing while already
//! released, is a no-op — so the overlay's reactive on/off firehose is cheap and can't stack
//! inhibitors.

use tauri::AppHandle;

/// Engage (`on = true`, playing) or release (`on = false`, paused / stopped / closed).
pub fn set(app: &AppHandle, on: bool) {
    #[cfg(target_os = "linux")]
    linux::set(app, on);
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        win::set(on);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        mac::set(on);
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        let _ = (app, on);
    }
}

// ================================ Windows ================================
#[cfg(target_os = "windows")]
mod win {
    use std::sync::mpsc::{channel, Sender};
    use std::sync::OnceLock;
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };

    /// One dedicated thread owns the execution state and serializes on/off, because
    /// `SetThreadExecutionState`'s continuous request is bound to the calling thread and is
    /// cleared when that thread exits — so set and clear must run on the same long-lived thread.
    fn tx() -> &'static Sender<bool> {
        static TX: OnceLock<Sender<bool>> = OnceLock::new();
        TX.get_or_init(|| {
            let (tx, rx) = channel::<bool>();
            std::thread::spawn(move || {
                while let Ok(on) = rx.recv() {
                    let flags = if on {
                        ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
                    } else {
                        ES_CONTINUOUS
                    };
                    // SAFETY: plain FFI with valid EXECUTION_STATE flags.
                    unsafe { SetThreadExecutionState(flags) };
                }
            });
            tx
        })
    }

    pub fn set(on: bool) {
        let _ = tx().send(on);
    }
}

// ======================== macOS: held child process ========================
#[cfg(target_os = "macos")]
fn child_slot() -> &'static std::sync::Mutex<Option<std::process::Child>> {
    static SLOT: std::sync::OnceLock<std::sync::Mutex<Option<std::process::Child>>> =
        std::sync::OnceLock::new();
    SLOT.get_or_init(|| std::sync::Mutex::new(None))
}

/// Spawn (once) or kill the held inhibitor child. Idempotent.
#[cfg(target_os = "macos")]
fn child_set(on: bool, build: impl FnOnce() -> std::process::Command) {
    let mut slot = child_slot().lock().unwrap();
    if on {
        if slot.is_none() {
            if let Ok(child) = build().spawn() {
                *slot = Some(child);
            }
        }
    } else if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

// ================================ macOS ================================
#[cfg(target_os = "macos")]
mod mac {
    pub fn set(on: bool) {
        super::child_set(on, || {
            let mut c = std::process::Command::new("caffeinate");
            // -d: no display sleep, -i: no idle system sleep. Runs until we kill it.
            c.arg("-d").arg("-i");
            c
        });
    }
}

// ================================ Linux ================================
#[cfg(target_os = "linux")]
mod linux {
    use tauri::{AppHandle, Manager};

    pub fn set(app: &AppHandle, on: bool) {
        // GTK's Wayland connection lives on the main thread — touch Wayland objects there,
        // exactly like the embed does.
        let app_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(win) = app_main.get_webview_window("main") {
                if wayland::try_set(&win, on) {
                    // Defensive release in case a session changed from the X11 fallback to a
                    // native-Wayland window without restarting the process.
                    fallback::set(false);
                    return; // handled by the compositor-honored Wayland path
                }
            }
            // Steam Deck Game mode is deliberately XWayland, so the wl_surface path above
            // cannot apply. The worker owns all fallback resources and serializes rapid
            // play/pause transitions.
            fallback::set(on);
        });
    }

    mod fallback {
        use ashpd::desktop::{
            inhibit::{InhibitFlags, InhibitOptions, InhibitProxy},
            Request,
        };
        use std::{
            ffi::c_void,
            os::raw::{c_char, c_int},
            process::{Child, Command, Stdio},
            sync::{mpsc, OnceLock},
            time::Duration,
        };

        // Shorter than SteamOS's first dim threshold while avoiding needless wakeups.
        const HEARTBEAT: Duration = Duration::from_secs(20);

        #[allow(non_snake_case)]
        #[link(name = "X11")]
        extern "C" {
            fn XOpenDisplay(name: *const c_char) -> *mut c_void;
            fn XCloseDisplay(display: *mut c_void) -> c_int;
            fn XResetScreenSaver(display: *mut c_void) -> c_int;
            fn XFlush(display: *mut c_void) -> c_int;
        }

        fn sender() -> &'static mpsc::Sender<bool> {
            static TX: OnceLock<mpsc::Sender<bool>> = OnceLock::new();
            TX.get_or_init(|| {
                let (tx, rx) = mpsc::channel();
                std::thread::Builder::new()
                    .name("izumi-idle-inhibit".into())
                    .spawn(move || worker(rx))
                    .expect("spawn Linux idle-inhibit worker");
                tx
            })
        }

        pub fn set(on: bool) {
            if sender().send(on).is_err() {
                eprintln!("[wakelock] Linux idle-inhibit worker stopped unexpectedly");
            }
        }

        fn worker(rx: mpsc::Receiver<bool>) {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    eprintln!("[wakelock] could not create portal runtime: {error}");
                    return;
                }
            };

            // Open lazily on the first active frame. Native-Wayland sessions send a defensive
            // `false` to this worker and should not create an otherwise unused X11 connection.
            let mut display = std::ptr::null_mut();
            let mut active = false;
            let mut portal: Option<Request<()>> = None;
            let mut logind: Option<Child> = None;

            loop {
                let message = if active {
                    rx.recv_timeout(HEARTBEAT)
                } else {
                    match rx.recv() {
                        Ok(value) => Ok(value),
                        Err(_) => break,
                    }
                };

                match message {
                    Ok(on) if on == active => {
                        // Idempotent repeated state from Svelte's reactive effect.
                    }
                    Ok(true) => {
                        active = true;
                        ensure_x11(&mut display);
                        reset_x11(display);

                        match runtime.block_on(acquire_portal()) {
                            Ok(request) => {
                                eprintln!(
                                    "[wakelock] active via XDG Inhibit portal + X11 heartbeat"
                                );
                                portal = Some(request);
                            }
                            Err(error) => {
                                eprintln!(
                                    "[wakelock] XDG Inhibit unavailable ({error}); using X11 heartbeat"
                                );
                                logind = spawn_logind();
                            }
                        }
                    }
                    Ok(false) => {
                        active = false;
                        if let Some(request) = portal.take() {
                            if let Err(error) = runtime.block_on(request.close()) {
                                eprintln!("[wakelock] failed to close XDG inhibitor: {error}");
                            }
                        }
                        stop_logind(&mut logind);
                        eprintln!("[wakelock] released (playback paused/stopped)");
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        ensure_x11(&mut display);
                        reset_x11(display);
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }

            if let Some(request) = portal.take() {
                let _ = runtime.block_on(request.close());
            }
            stop_logind(&mut logind);
            if !display.is_null() {
                unsafe { XCloseDisplay(display) };
            }
        }

        async fn acquire_portal() -> Result<Request<()>, String> {
            // A broken/missing portal must never delay a pause/close transition indefinitely.
            tokio::time::timeout(Duration::from_secs(2), async {
                let proxy = InhibitProxy::new().await?;
                proxy
                    .inhibit(
                        None,
                        InhibitFlags::Idle | InhibitFlags::Suspend,
                        InhibitOptions::default().set_reason("Playing video"),
                    )
                    .await
            })
            .await
            .map_err(|_| "request timed out".to_string())?
            .map_err(|error| error.to_string())
        }

        fn ensure_x11(display: &mut *mut c_void) {
            if !(*display).is_null() {
                return;
            }
            // This connection belongs exclusively to this worker thread. XOpenDisplay uses the
            // Flatpak's DISPLAY, which is gamescope's XWayland server in Steam Deck Game mode.
            *display = unsafe { XOpenDisplay(std::ptr::null()) };
            if (*display).is_null() {
                eprintln!("[wakelock] X11 heartbeat unavailable: XOpenDisplay failed");
            }
        }

        fn reset_x11(display: *mut c_void) {
            if display.is_null() {
                return;
            }
            unsafe {
                XResetScreenSaver(display);
                XFlush(display);
            }
        }

        fn spawn_logind() -> Option<Child> {
            let mut command = Command::new("systemd-inhibit");
            command
                .args([
                    "--what=idle:sleep",
                    "--who=izumi",
                    "--why=Playing video",
                    "--mode=block",
                    "sleep",
                    "infinity",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            match command.spawn() {
                Ok(child) => {
                    eprintln!("[wakelock] logind fallback started");
                    Some(child)
                }
                Err(error) => {
                    eprintln!("[wakelock] logind fallback unavailable: {error}");
                    None
                }
            }
        }

        fn stop_logind(child: &mut Option<Child>) {
            if let Some(mut process) = child.take() {
                let _ = process.kill();
                let _ = process.wait();
            }
        }
    }

    /// Wayland `zwp_idle_inhibit_manager_v1` on GTK's toplevel surface. Only ever called on
    /// the GTK main thread (via `run_on_main_thread`).
    mod wayland {
        use raw_window_handle::{
            HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle,
        };
        use std::sync::{Mutex, OnceLock};
        use tauri::WebviewWindow;
        use wayland_client::{
            backend::{Backend, ObjectId},
            globals::{registry_queue_init, GlobalListContents},
            protocol::{wl_registry::WlRegistry, wl_surface::WlSurface},
            Connection, Dispatch, EventQueue, Proxy, QueueHandle,
        };
        use wayland_protocols::wp::idle_inhibit::zv1::client::{
            zwp_idle_inhibit_manager_v1::ZwpIdleInhibitManagerV1,
            zwp_idle_inhibitor_v1::ZwpIdleInhibitorV1,
        };

        // Private registry queue; idle-inhibit carries no events, so every dispatch is a noop.
        struct D;
        impl Dispatch<WlRegistry, GlobalListContents> for D {
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
        wayland_client::delegate_noop!(D: ignore ZwpIdleInhibitManagerV1);
        wayland_client::delegate_noop!(D: ignore ZwpIdleInhibitorV1);
        wayland_client::delegate_noop!(D: ignore WlSurface);

        struct Idle {
            conn: Connection,
            qh: QueueHandle<D>,
            mgr: ZwpIdleInhibitManagerV1,
            surface: WlSurface,
            inhibitor: Option<ZwpIdleInhibitorV1>,
            _queue: EventQueue<D>,
        }

        enum State {
            Uninit,
            Unavailable,
            Active(Idle),
        }

        fn state() -> &'static Mutex<State> {
            static S: OnceLock<Mutex<State>> = OnceLock::new();
            S.get_or_init(|| Mutex::new(State::Uninit))
        }

        /// Returns true if the Wayland idle-inhibit path handled this call (so the caller skips
        /// the `systemd-inhibit` fallback); false when this isn't a Wayland session or the
        /// compositor lacks `zwp_idle_inhibit_manager_v1`.
        pub fn try_set(window: &WebviewWindow, on: bool) -> bool {
            let mut st = state().lock().unwrap();
            if matches!(*st, State::Uninit) {
                *st = match Idle::new(window) {
                    Some(idle) => State::Active(idle),
                    None => State::Unavailable,
                };
            }
            if let State::Active(idle) = &mut *st {
                idle.set(on);
                true
            } else {
                false
            }
        }

        impl Idle {
            fn new(window: &WebviewWindow) -> Option<Self> {
                // Toplevel wl_surface + wl_display straight off the Tauri window — the same GTK
                // connection the embed uses. Non-Wayland → None so the caller falls back.
                let RawWindowHandle::Wayland(w) = window.window_handle().ok()?.as_raw() else {
                    return None;
                };
                let RawDisplayHandle::Wayland(d) = window.display_handle().ok()?.as_raw() else {
                    return None;
                };
                let surface_ptr = w.surface.as_ptr();
                let display_ptr = d.display.as_ptr();

                // SAFETY: GTK's live wl_display; from_foreign_display only bumps a refcount.
                let backend = unsafe { Backend::from_foreign_display(display_ptr as *mut _) };
                let conn = Connection::from_backend(backend);
                let (globals, queue) = registry_queue_init::<D>(&conn).ok()?;
                let qh = queue.handle();
                // v1 only; absent on X11 / ancient compositors → None → systemd-inhibit fallback.
                let mgr: ZwpIdleInhibitManagerV1 = globals.bind(&qh, 1..=1, ()).ok()?;

                // Proxy GTK's toplevel surface onto our connection (shared fd + object namespace).
                // SAFETY: valid wl_surface* on the same connection.
                let id =
                    unsafe { ObjectId::from_ptr(WlSurface::interface(), surface_ptr as *mut _) }
                        .ok()?;
                let surface = WlSurface::from_id(&conn, id).ok()?;

                Some(Idle {
                    conn,
                    qh,
                    mgr,
                    surface,
                    inhibitor: None,
                    _queue: queue,
                })
            }

            fn set(&mut self, on: bool) {
                if on {
                    if self.inhibitor.is_none() {
                        self.inhibitor =
                            Some(self.mgr.create_inhibitor(&self.surface, &self.qh, ()));
                        let _ = self.conn.flush();
                    }
                } else if let Some(inhibitor) = self.inhibitor.take() {
                    inhibitor.destroy();
                    let _ = self.conn.flush();
                }
            }
        }
    }
}
