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
        alang: Option<String>,
        slang: Option<String>,
    ) -> Result<(), String> {
        let mut guard = self.mpv.lock().map_err(|e| e.to_string())?;

        // If we already have an mpv core, just queue the new file into its
        // existing (embedded) window.
        if let Some(mpv) = guard.as_ref() {
            set_langs(mpv, &alang, &slang);
            load_file(mpv, url, start_seconds)?;
            return Ok(());
        }

        // First launch: build a fresh mpv core bound to the given window.
        let mpv = create_mpv(Some(wid)).map_err(|e| e.to_string())?;

        // Spawn the event loop ONCE, on first mpv creation, before loading.
        spawn_event_loop(&mpv, app).map_err(|e| e.to_string())?;

        set_langs(&mpv, &alang, &slang);
        load_file(&mpv, url, start_seconds)?;

        *guard = Some(mpv);
        Ok(())
    }

    /// Stop playback and tear down the mpv core.
    ///
    /// We must send mpv `quit` BEFORE dropping the main handle: the event-loop
    /// thread holds a second *client* handle onto the same core, and mpv keeps the
    /// core (and audio!) alive as long as ANY handle exists — so just dropping the
    /// main handle leaves audio playing in the background. `quit` shuts the core
    /// down → the event thread observes `Shutdown`, exits, and drops its client →
    /// the core is fully destroyed. Then we drop the main handle. Used by
    /// `close_player`.
    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.mpv.lock().map_err(|e| e.to_string())?;
        if let Some(mpv) = guard.as_ref() {
            let _ = mpv.command("quit", &[]);
        }
        *guard = None;
        Ok(())
    }

    /// Read a string mpv property (e.g. `pause`, `track-list`) from the live
    /// core. Errors if no player is running. Used by `player_get_property`.
    pub fn get_property(&self, name: &str) -> Result<String, String> {
        let guard = self.mpv.lock().map_err(|e| e.to_string())?;
        let mpv = guard.as_ref().ok_or("no player")?;
        mpv.get_property::<String>(name).map_err(|e| e.to_string())
    }

    /// Run an arbitrary mpv command (e.g. `cycle pause`, `seek 10`) against the
    /// live core. Errors if no player is running. Used by `player_command`, which
    /// backs the custom on-screen controls.
    pub fn command(&self, name: &str, args: &[&str]) -> Result<(), String> {
        let guard = self.mpv.lock().map_err(|e| e.to_string())?;
        let mpv = guard.as_ref().ok_or("no player")?;
        mpv.command(name, args).map_err(|e| e.to_string())
    }

    /// Return the current track list as a JSON array (`[{id,type,title,lang,
    /// selected}, ...]`) for the audio/subtitle pickers.
    ///
    /// mpv's `track-list` is a *node* property that `get_property::<String>`
    /// refuses to stringify, so we read the scalar sub-properties
    /// (`track-list/N/type`, `.../id`, `.../title`, `.../lang`, `.../selected`)
    /// one at a time. Absent fields (e.g. a track with no language tag) simply
    /// come back as an error we swallow into a default, so the whole list never
    /// fails just because one field is missing.
    pub fn tracks(&self) -> Result<String, String> {
        let guard = self.mpv.lock().map_err(|e| e.to_string())?;
        let mpv = guard.as_ref().ok_or("no player")?;
        let count: i64 = mpv
            .get_property("track-list/count")
            .map_err(|e| e.to_string())?;
        let mut arr = Vec::with_capacity(count.max(0) as usize);
        for i in 0..count {
            let ty: String = mpv
                .get_property(&format!("track-list/{i}/type"))
                .unwrap_or_default();
            let id: i64 = mpv
                .get_property(&format!("track-list/{i}/id"))
                .unwrap_or(0);
            let title: String = mpv
                .get_property(&format!("track-list/{i}/title"))
                .unwrap_or_default();
            let lang: String = mpv
                .get_property(&format!("track-list/{i}/lang"))
                .unwrap_or_default();
            let selected: bool = mpv
                .get_property(&format!("track-list/{i}/selected"))
                .unwrap_or(false);
            arr.push(serde_json::json!({
                "id": id, "type": ty, "title": title, "lang": lang, "selected": selected,
            }));
        }
        serde_json::to_string(&arr).map_err(|e| e.to_string())
    }

    /// Return the embedded chapter list as a JSON array (`[{time,title}, ...]`,
    /// `time` in seconds). Empty `[]` when the file has no chapters (most anime
    /// releases don't — the UI falls back to AniSkip OP/ED segments then). Read
    /// field-by-field from `chapter-list/N/*` for the same reason as `tracks`.
    pub fn chapters(&self) -> Result<String, String> {
        let guard = self.mpv.lock().map_err(|e| e.to_string())?;
        let mpv = guard.as_ref().ok_or("no player")?;
        let count: i64 = mpv
            .get_property("chapter-list/count")
            .map_err(|e| e.to_string())?;
        let mut arr = Vec::with_capacity(count.max(0) as usize);
        for i in 0..count {
            let time: f64 = mpv
                .get_property(&format!("chapter-list/{i}/time"))
                .unwrap_or(0.0);
            let title: String = mpv
                .get_property(&format!("chapter-list/{i}/title"))
                .unwrap_or_default();
            arr.push(serde_json::json!({ "time": time, "title": title }));
        }
        serde_json::to_string(&arr).map_err(|e| e.to_string())
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

/// Set mpv's preferred audio/subtitle languages BEFORE `loadfile`, so mpv
/// auto-selects the matching tracks (e.g. Japanese audio + English subs). `alang`
/// = audio language, `slang` = subtitle language (ISO 639-2; `slang="no"` disables
/// subs). Best-effort; ignored if unset.
fn set_langs(mpv: &Mpv, alang: &Option<String>, slang: &Option<String>) {
    if let Some(a) = alang {
        let _ = mpv.set_property("alang", a.as_str());
    }
    if let Some(s) = slang {
        // "none" from the UI means "no subtitles": mpv wants sid=no.
        if s == "none" {
            let _ = mpv.set_property("sid", "no");
        } else {
            let _ = mpv.set_property("slang", s.as_str());
        }
    }
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
    // Pass `None`, NOT `Some("event-loop")`. libmpv2 6.0.0's `create_client`
    // has a use-after-free: `CString::new(name)?.as_ptr()` drops the CString
    // before `mpv_create_client` reads the name, so a *named* client passes a
    // dangling pointer → mpv returns null → the crate's `NonNull::new_unchecked`
    // panics (STATUS_STACK_BUFFER_OVERRUN, mpv.rs:385). `None` takes the
    // `ptr::null()` branch (no CString) and mpv auto-assigns a name — no crash.
    let client = mpv.create_client(None)?;
    client.observe_property("time-pos", Format::Double, 0)?;
    client.observe_property("duration", Format::Double, 0)?;
    // `demuxer-cache-time` = last buffered timestamp (secs) → drives the seekbar's
    // "loaded" extent. `pause`/`paused-for-cache` (bool) keep the play glyph in
    // sync and drive the buffering spinner without the webview polling.
    client.observe_property("demuxer-cache-time", Format::Double, 0)?;
    client.observe_property("pause", Format::Flag, 0)?;
    client.observe_property("paused-for-cache", Format::Flag, 0)?;

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
                    ("demuxer-cache-time", PropertyData::Double(end)) => {
                        let _ = app.emit("player-buffer", end);
                    }
                    ("pause", PropertyData::Flag(paused)) => {
                        let _ = app.emit("player-paused", paused);
                    }
                    ("paused-for-cache", PropertyData::Flag(buffering)) => {
                        let _ = app.emit("player-buffering", buffering);
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
                // Create + clear the video window to black IMMEDIATELY, before the
                // first frame decodes. Our host window is transparent, so without
                // this mpv paints nothing while buffering and you see straight
                // through it ("invisible player"). With `wid`, force-window uses the
                // embedded surface — it doesn't spawn a separate window.
                init.set_option("force-window", "yes")?;
                // Make mpv a PURE RENDER SURFACE — it must not handle any input, or
                // its child window steals mouse/keyboard from the WebView2 controls
                // on top (the "lack of control" / windowed feel). All input is owned
                // by the HTML overlay; we drive mpv via commands only.
                init.set_option("input-cursor", "no")?;
                init.set_option("input-vo-keyboard", "no")?;
                init.set_option("input-default-bindings", "no")?;
                init.set_option("window-dragging", "no")?;
                init.set_option("osc", "no")?;
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
        // Full hardware decoding — `auto` (not `auto-safe`) so HEVC/H.265, 10-bit,
        // and Dolby-Vision profiles use the GPU decoder like Stremio does. mpv (via
        // FFmpeg) natively demuxes MKV and decodes HEVC/AV1/H.264, so "arbitrary
        // debrid MKV/HEVC" already works — these options just make it optimal.
        init.set_option("hwdec", "auto")?;
        // --- HDR / Dolby Vision (match stremio-shell-ng's mpv config) ---
        // d3d11 output pipeline (Windows-only) drives HDR passthrough/tone-mapping;
        // tone-mapping maps HDR/DV to SDR displays so premium 4K encodes don't look
        // blown out. `target-colorspace-hint` lets mpv signal the display's csp.
        #[cfg(windows)]
        {
            init.set_option("gpu-context", "d3d11")?;
            init.set_option("d3d11-output-format", "auto")?;
            init.set_option("d3d11-output-csp", "auto")?;
        }
        init.set_option("target-colorspace-hint", "auto")?;
        init.set_option("tone-mapping", "bt.2390")?;
        // Never let mpv hide the OS cursor. When embedded, the WebView2 overlay
        // sits above mpv and grabs mouse-move events, so mpv's autohide timer
        // expires and the cursor vanishes even while the user is moving it. `no`
        // keeps the cursor visible; the webview drives its own idle-hide.
        init.set_option("cursor-autohide", "no")?;

        // --- Network streaming (debrid HTTP URLs with range-request support) ---
        // Real-Debrid links are seekable via HTTP ranges, but mpv sometimes marks
        // remote streams unseekable and then a forward seek past the cache just
        // jumps back to the cached window. Force seekability + a large demuxer
        // cache so seeking into not-yet-loaded regions actually fetches the new
        // range instead of looping over the buffered one, and so the seekbar has
        // a real "loaded" extent to show.
        init.set_option("cache", "yes")?;
        init.set_option("force-seekable", "yes")?;
        init.set_option("demuxer-seekable-cache", "yes")?;
        // 512 MiB forward cache; plenty for scrubbing without unbounded memory.
        init.set_option("demuxer-max-bytes", "536870912")?;
        init.set_option("demuxer-readahead-secs", "20")?;
        Ok(())
    })
}
