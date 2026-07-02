//! Player bridge over libmpv2.
//!
//! This is the first real slice of the player: it can open libmpv's own
//! (mpv-managed) window and play a URL with audio. Later tasks will replace
//! the "own window" path with the render API + GL overlay embedded in the
//! Tauri webview, but the `PlayerHandle` / owned-`Mpv` lifetime model here is
//! meant to be reused.
//!
//! ## Send/Sync approach
//! `libmpv2::Mpv` declares `unsafe impl Send for Mpv {}` and
//! `unsafe impl Sync for Mpv {}` (see libmpv2 6.0.0 `src/mpv.rs`), so a plain
//! `Mutex<Option<Mpv>>` is `Send + Sync` and satisfies Tauri's `State`
//! requirements directly.
//!
//! ## Event loop
//! To observe playback (`time-pos`/`duration`, end-of-file) we spawn one
//! background thread the first time an mpv core is created. Because libmpv2 6.0
//! has no separate movable event context — `wait_event`/`observe_property` are
//! methods on `Mpv`, and the returned `Event` borrows the handle — we can't move
//! the pooled `Mpv` (which the `Mutex` must keep for `loadfile`). Instead the
//! thread owns a second *client* handle (`Mpv::create_client`) onto the same
//! core, with its own event queue. It emits Tauri events `player-progress`
//! (`(pos, duration)`) and `player-ended` (on natural EOF only). See
//! [`spawn_event_loop`].

use std::sync::Mutex;

use libmpv2::{
    events::{Event, PropertyData},
    Format, Mpv,
};
use tauri::{AppHandle, Emitter};

/// Holds the live mpv instance behind a mutex so it is kept alive for the
/// lifetime of the app. Dropping the `Mpv` destroys the mpv core and closes
/// its window, so we must retain it in state.
pub struct PlayerHandle {
    mpv: Mutex<Option<Mpv>>,
}

impl PlayerHandle {
    /// Create an empty handle. No mpv core exists until the first playback.
    pub fn new() -> Self {
        PlayerHandle {
            mpv: Mutex::new(None),
        }
    }

    /// Open (or reuse) an mpv instance that manages its own window and start
    /// playing `url`.
    ///
    /// Video-output options (`vo`, `hwdec`) are set *before* initialization via
    /// `with_initializer`, because mpv only applies these at init time. We try
    /// `vo=gpu-next` first and transparently fall back to `vo=gpu` if creating
    /// the context with `gpu-next` fails.
    ///
    /// `app` is used to emit `player-progress`/`player-ended` events from the
    /// event loop (spawned once, on first launch). `start_seconds`, when set,
    /// resumes playback that many seconds into the file (mpv's `start` option).
    pub fn play_own_window(
        &self,
        url: &str,
        app: AppHandle,
        start_seconds: Option<f64>,
    ) -> Result<(), String> {
        let mut guard = self.mpv.lock().map_err(|e| e.to_string())?;

        // If we already have an mpv core, just queue the new file into its
        // existing window.
        if let Some(mpv) = guard.as_ref() {
            load_file(mpv, url, start_seconds)?;
            return Ok(());
        }

        // First launch: build a fresh mpv core with good defaults.
        let mpv = create_mpv(None).map_err(|e| e.to_string())?;

        // Spawn the event loop ONCE, on first mpv creation, before loading.
        spawn_event_loop(&mpv, app).map_err(|e| e.to_string())?;

        load_file(&mpv, url, start_seconds)?;

        *guard = Some(mpv);
        Ok(())
    }

    /// Open (or reuse) an mpv instance that renders *into* an existing native
    /// window (identified by `wid`, the Win32 `HWND` as an `i64`) and start
    /// playing `url`.
    ///
    /// `wid` — like `vo`/`hwdec` — is an init-time option, so it must be set in
    /// `with_initializer` *before* `mpv_initialize` runs. When `wid` is set we do
    /// NOT set `force-window`: the supplied window *is* mpv's output surface.
    ///
    /// The `gpu-next` → `gpu` video-output fallback is preserved.
    ///
    /// See [`play_own_window`](Self::play_own_window) for `app`/`start_seconds`.
    pub fn play_embedded(
        &self,
        url: &str,
        wid: i64,
        app: AppHandle,
        start_seconds: Option<f64>,
    ) -> Result<(), String> {
        let mut guard = self.mpv.lock().map_err(|e| e.to_string())?;

        // If we already have an mpv core, just queue the new file into its
        // existing (embedded) window.
        if let Some(mpv) = guard.as_ref() {
            load_file(mpv, url, start_seconds)?;
            return Ok(());
        }

        // First launch: build a fresh mpv core bound to the given window.
        let mpv = create_mpv(Some(wid)).map_err(|e| e.to_string())?;

        // Spawn the event loop ONCE, on first mpv creation, before loading.
        spawn_event_loop(&mpv, app).map_err(|e| e.to_string())?;

        load_file(&mpv, url, start_seconds)?;

        *guard = Some(mpv);
        Ok(())
    }
}

/// Load `url` into an existing mpv core, optionally resuming at `start_seconds`.
///
/// mpv's `start` option is read at file-load time, so we set it as a property
/// just before `loadfile`. Setting it to `"none"` (or, on the first play, never
/// having set it) means "play from the beginning".
fn load_file(mpv: &Mpv, url: &str, start_seconds: Option<f64>) -> Result<(), String> {
    // Always set `start` explicitly so a resumed file doesn't leak its start
    // position onto the next (fresh) file loaded into the same core.
    let start = match start_seconds {
        Some(s) if s > 0.0 => format!("{s}"),
        _ => "none".to_string(),
    };
    mpv.set_property("start", start.as_str())
        .map_err(|e| e.to_string())?;
    mpv.command("loadfile", &[url]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Spawn the mpv event-loop thread. Called exactly once, on first mpv creation.
///
/// ## Why a client handle, not the main `Mpv`
/// libmpv2 6.0 exposes no separate movable `EventContext`: `observe_property`
/// and `wait_event` are methods on `Mpv` itself, and the returned `Event`
/// borrows the handle's internal event buffer. The main `Mpv` must stay in the
/// `Mutex` (it's needed for every `loadfile`), so we can't move it into the
/// thread. Instead we make a *client* handle (`create_client`) — a second
/// handle onto the same mpv core with its own independent event queue — observe
/// the properties on it, and move that client into the thread. `Mpv` is `Send`,
/// so this compiles cleanly, and the client keeps the core alive alongside the
/// main handle.
fn spawn_event_loop(mpv: &Mpv, app: AppHandle) -> Result<(), libmpv2::Error> {
    let client = mpv.create_client(Some("event-loop"))?;
    client.observe_property("time-pos", Format::Double, 0)?;
    client.observe_property("duration", Format::Double, 0)?;

    std::thread::spawn(move || {
        let mut duration = 0f64;
        loop {
            // Block up to 1s waiting for the next event on this client's queue.
            match client.wait_event(1.0) {
                Some(Ok(Event::PropertyChange { name, change, .. })) => match (name, change) {
                    ("duration", PropertyData::Double(d)) => duration = d,
                    ("time-pos", PropertyData::Double(pos)) => {
                        let _ = app.emit("player-progress", (pos, duration));
                    }
                    _ => {}
                },
                // Only auto-advance on a natural end-of-file (Eof). Quit/Stop/
                // Error/Redirect must NOT trigger the next episode.
                Some(Ok(Event::EndFile(reason))) => {
                    if reason == libmpv2::mpv_end_file_reason::Eof {
                        let _ = app.emit("player-ended", ());
                    }
                }
                // Core is going away — stop pumping so the thread can exit.
                Some(Ok(Event::Shutdown)) => break,
                _ => {}
            }
        }
    });

    Ok(())
}

impl Default for PlayerHandle {
    fn default() -> Self {
        Self::new()
    }
}

/// Build an initialized `Mpv` with good defaults, preferring `vo=gpu-next` and
/// falling back to `vo=gpu`.
///
/// When `wid` is `Some`, mpv renders into that existing native window (embedded
/// mode); when `None`, mpv creates and manages its own window.
fn create_mpv(wid: Option<i64>) -> Result<Mpv, libmpv2::Error> {
    match new_mpv_with_vo("gpu-next", wid) {
        Ok(mpv) => Ok(mpv),
        Err(_) => new_mpv_with_vo("gpu", wid),
    }
}

/// Create an mpv instance using the given video output driver. All the
/// window/vo/hwdec options are set before `mpv_initialize` runs (mpv only
/// applies these at init time).
///
/// If `wid` is `Some`, we bind mpv to that window handle and do *not* request
/// `force-window` (the handle already is the output surface). If `wid` is
/// `None`, we ask mpv to create its own window via `force-window`.
fn new_mpv_with_vo(vo: &str, wid: Option<i64>) -> Result<Mpv, libmpv2::Error> {
    Mpv::with_initializer(|init| {
        match wid {
            // Embedded: render into the host window. `wid` is an init-time
            // option, exactly like `vo`.
            Some(wid) => {
                // `SetData` is implemented for `i64`, so pass the handle
                // directly (no string round-trip needed).
                init.set_option("wid", wid)?;
            }
            // Own window: make an actual window appear even before/without video
            // geometry info, and open it fullscreen so streams play edge-to-edge
            // with mpv's native on-screen controller (pause/seek). Fullscreen is
            // an init-time option, like `force-window`/`vo`.
            None => {
                init.set_option("force-window", "yes")?;
                init.set_option("fullscreen", "yes")?;
            }
        }
        // Preferred GPU video output.
        init.set_option("vo", vo)?;
        // Safe hardware decoding (won't engage decoders known to be flaky).
        init.set_option("hwdec", "auto-safe")?;
        Ok(())
    })
}
