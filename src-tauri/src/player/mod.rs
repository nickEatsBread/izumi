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

mod headless;
// Linux embedded player: a wl_subsurface placed below the (transparent) webview,
// rendered by mpv's OpenGL render API. Never touches the webview's GTK tree.
#[cfg(target_os = "linux")]
pub mod linux_embed;
// Linux playback: a SEPARATE mpv process driven over JSON IPC. Dormant fallback,
// not wired into the UX — kept for headless/X11 situations the embed can't cover.
#[cfg(target_os = "linux")]
pub mod linux_proc;
// Game mode (gamescope / XWayland X11): raw X11 container window for mpv `--wid` — no
// wl_subsurface there, so the video is a fullscreen child window we show/hide for the swap.
#[cfg(target_os = "linux")]
pub mod linux_x11;
// Game mode controls-over-video: gamescope won't blend a transparent app surface, so we
// snapshot the webview's HTML controls and push them to mpv as a `overlay-add` layer that
// mpv bakes over the video in its own opaque surface. See linux_overlay.rs.
#[cfg(target_os = "linux")]
pub mod linux_overlay;
// Steam Deck L2/R2 seek: read the (Steam-virtual) gamepad via evdev in the backend and forward
// the trigger state to the webview — webkit2gtk's own Gamepad API doesn't see it. See gamepad_linux.rs.
#[cfg(target_os = "linux")]
pub mod gamepad_linux;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use libmpv2::{
    events::{Event, PropertyData},
    Format, Mpv,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use headless::HeadlessMpv;

/// The mpv/libmpv version string, for the About page.
pub fn libmpv_version() -> String {
    headless::version()
}

/// Scrub-preview thumbnail state for one stream. Tiles are produced ON DEMAND — when
/// the seekbar asks for the tile under the cursor, the warm headless libmpv decoder
/// ([`HeadlessMpv`]) seeks + software-renders THAT position and we cache it as
/// `t_<i>.jpg`. Position-uniform: hovering the end of the bar is as fast as the start.
/// `interval`/`frames` give the time↔index grid.
struct TileJob {
    dir: PathBuf,
    interval: u32,
    frames: u32,
    url: String, // debrid stream url or local path (SECRET — never logged)
}

/// Reply to `player_thumb_tile`. `status` = `ready|pending|failed|none`; when `ready`,
/// `data_url` is that ONE small tile (few KB) and `index` its grid position.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbTile {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_url: Option<String>,
    index: u32,
}

/// Reply to `player_thumb_info` — the geometry + coverage the seekbar needs to map a
/// hover time to a tile index and know when generation has finished.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbInfo {
    status: String, // running | done | failed | none
    interval: u32,
    frames: u32,
}

/// Holds the live mpv instance behind a mutex so it is kept alive for the
/// lifetime of the app. Dropping the `Mpv` destroys the mpv core and closes
/// its window, so we must retain it in state.
pub struct PlayerHandle {
    mpv: Mutex<Option<Mpv>>,
    /// URL of what's currently playing.
    current_url: Mutex<Option<String>>,
    /// Scrub-preview thumbnail jobs, keyed by stream cache key (infoHash or
    /// media-episode). Holds the url + geometry so tiles can be produced on demand.
    sprite_jobs: Arc<Mutex<HashMap<String, TileJob>>>,
    /// On-demand thumbnail grabs in flight — capped at 1 so a scrub can't spawn a
    /// storm of renders / range requests that starve mpv playback. `Arc` so the
    /// detached grab thread can reset it when it finishes.
    thumb_inflight: Arc<std::sync::atomic::AtomicUsize>,
    /// Warm scrub-thumbnail decoder — a second, headless libmpv core (software render).
    /// The sole thumbnail engine (no ffmpeg). Lazily started on the first hover.
    headless: Arc<HeadlessMpv>,
}

impl PlayerHandle {
    /// Create an empty handle. No mpv core exists until the first playback.
    pub fn new() -> Self {
        PlayerHandle {
            mpv: Mutex::new(None),
            current_url: Mutex::new(None),
            sprite_jobs: Arc::new(Mutex::new(HashMap::new())),
            thumb_inflight: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            headless: Arc::new(HeadlessMpv::new()),
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
        // Remember the URL — the next hover renders fresh frames against the new file.
        *self.current_url.lock().map_err(|e| e.to_string())? = Some(url.to_string());

        let mut guard = self.mpv.lock().map_err(|e| e.to_string())?;

        // If we already have an mpv core, just queue the new file into its
        // existing (embedded) window.
        if let Some(mpv) = guard.as_ref() {
            set_langs(mpv, &alang, &slang);
            load_file(mpv, url, start_seconds)?;
            return Ok(());
        }

        // First launch: build a fresh mpv core. A real window handle (Windows HWND /
        // container, always > 0) embeds into it; wid <= 0 (non-Windows, no embed yet)
        // means "no host window" → create_mpv(None) so mpv opens its OWN fullscreen
        // window. Passing Some(0) here told mpv to embed into X-window 0 (the root),
        // which aborts libmpv init on Wayland → the command panicked → invoke rejected
        // with null.
        let mpv = create_mpv(if wid > 0 { Some(wid) } else { None }).map_err(|e| e.to_string())?;

        // Spawn the event loop ONCE, on first mpv creation, before loading.
        spawn_event_loop(&mpv, app).map_err(|e| e.to_string())?;

        set_langs(&mpv, &alang, &slang);
        load_file(&mpv, url, start_seconds)?;

        *guard = Some(mpv);
        Ok(())
    }

    /// Linux embedded playback: create (or reuse) an mpv core with `vo=libmpv`
    /// and render it into a `wl_subsurface` placed below the transparent webview
    /// (see [`linux_embed`]). The core lives here — so `command`/`get_property`/
    /// `tracks`/… and the progress event loop all work exactly as on Windows.
    ///
    /// First call: build the core, spawn the event loop, [`attach`](linux_embed::attach)
    /// the subsurface/render context bound to it, then `loadfile`. Later calls
    /// (next-episode auto-advance) reuse the core and just `loadfile`.
    #[cfg(target_os = "linux")]
    pub fn play_embedded_render(
        &self,
        url: &str,
        app: AppHandle,
        start_seconds: Option<f64>,
        alang: Option<String>,
        slang: Option<String>,
        window: &tauri::WebviewWindow,
    ) -> Result<(), String> {
        *self.current_url.lock().map_err(|e| e.to_string())? = Some(url.to_string());

        let mut guard = self.mpv.lock().map_err(|e| e.to_string())?;
        if let Some(mpv) = guard.as_ref() {
            set_langs(mpv, &alang, &slang);
            load_file(mpv, url, start_seconds)?;
            return Ok(());
        }

        let mpv = new_mpv_libmpv().map_err(|e| e.to_string())?;
        spawn_event_loop(&mpv, app).map_err(|e| e.to_string())?;
        set_langs(&mpv, &alang, &slang);
        // Bind the render context to this core BEFORE it moves into the mutex.
        // `attach` borrows `&mpv` only for the (blocking) duration of the call.
        linux_embed::attach(&mpv, window)?;
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
        // Free the render context (which references the core) BEFORE the core is
        // quit/dropped — required for the `'static` lifetime extension in
        // `linux_embed::attach` to stay sound. No-op if nothing is embedded.
        #[cfg(target_os = "linux")]
        linux_embed::detach();

        let mut guard = self.mpv.lock().map_err(|e| e.to_string())?;
        if let Some(mpv) = guard.as_ref() {
            let _ = mpv.command("quit", &[]);
        }
        *guard = None;
        // Drop the current url and tear down the headless thumbnail decoder.
        *self.current_url.lock().map_err(|e| e.to_string())? = None;
        self.headless.stop();
        Ok(())
    }

    /// Register a scrub-preview thumbnail job for the current stream, keyed by `key`
    /// (infoHash or media-episode). `duration` (seconds) comes from mpv so we don't
    /// re-probe. Tiles are produced ON DEMAND in [`thumb_tile`] by the headless decoder;
    /// this just records the url + the time↔index grid. `cache_root` is `<app-cache>/thumbs`.
    pub fn start_sprite(&self, key: String, duration: f64, cache_root: PathBuf) {
        if key.is_empty() || duration <= 1.0 {
            return;
        }
        let url = match self.current_url.lock().ok().and_then(|g| g.clone()) {
            Some(u) => u,
            None => return,
        };
        // One tile every `interval`s, bounded to <=144 grid positions (>=10s spacing).
        let interval = ((duration / 144.0).ceil() as u32).max(10);
        let frames = (((duration / interval as f64).ceil()) as u32).clamp(1, 144);
        let dir = cache_root.join(sanitize_key(&key));
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut jobs) = self.sprite_jobs.lock() {
            if jobs.len() > 64 {
                jobs.clear();
            }
            jobs.insert(key, TileJob { dir, interval, frames, url });
        }
    }

    /// The tile for hover time `time` (seconds). Returns INSTANTLY — never blocks the
    /// command/IPC thread. Disk-cache hit → `ready`; otherwise it kicks off ONE detached
    /// grab via the warm headless libmpv decoder (software render — no ffmpeg, no window)
    /// and returns `pending`; the seekbar keeps its shimmer + re-polls until the tile
    /// lands on disk. Concurrency 1 so a scrub can't storm the decoder.
    pub fn thumb_tile(&self, key: &str, time: f64) -> Result<ThumbTile, String> {
        use std::sync::atomic::Ordering;
        let (dir, interval, frames, url) = {
            let jobs = self.sprite_jobs.lock().map_err(|e| e.to_string())?;
            match jobs.get(key) {
                Some(j) => (j.dir.clone(), j.interval, j.frames, j.url.clone()),
                None => return Ok(ThumbTile { status: "none".into(), data_url: None, index: 0 }),
            }
        };
        let i = ((time / interval as f64).round() as i64).clamp(0, frames as i64 - 1) as u32;
        let path = dir.join(format!("t_{i}.jpg"));

        // Disk-cache hit (EOI-verified so a half-written file reads as not-ready).
        if let Ok(bytes) = std::fs::read(&path) {
            if bytes.len() > 2 && bytes[bytes.len() - 2] == 0xFF && bytes[bytes.len() - 1] == 0xD9 {
                return Ok(ThumbTile { status: "ready".into(), data_url: Some(format!("data:image/jpeg;base64,{}", b64(&bytes))), index: i });
            }
        }

        // Miss → spawn ONE detached grab if none is running (concurrency 1). The warm
        // headless decoder seeks + software-renders THIS position; we write the tile
        // atomically and the seekbar re-polls until it lands. Returns immediately so
        // hover/skim never stalls the UI or other Tauri commands.
        if self.thumb_inflight.compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
            let inflight = self.thumb_inflight.clone();
            let headless = self.headless.clone();
            let time_at = i as f64 * interval as f64;
            std::thread::spawn(move || {
                if let Ok(bytes) = headless.screenshot(&url, time_at) {
                    if !bytes.is_empty() {
                        write_tile_atomic(&path, &bytes);
                    }
                }
                inflight.store(0, Ordering::SeqCst);
            });
        }
        Ok(ThumbTile { status: "pending".into(), data_url: None, index: i })
    }

    /// Geometry for `key` so the seekbar can map hover-time → tile index. `running`
    /// once a job is registered (tiles produced on demand); `none` otherwise.
    pub fn thumb_info(&self, key: &str) -> Result<ThumbInfo, String> {
        let jobs = self.sprite_jobs.lock().map_err(|e| e.to_string())?;
        Ok(match jobs.get(key) {
            Some(j) => ThumbInfo { status: "running".into(), interval: j.interval, frames: j.frames },
            None => ThumbInfo { status: "none".into(), interval: 0, frames: 0 },
        })
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

    /// Add/replace a raw-memory OSD overlay on the video (Game-mode controls). `addr` is the
    /// address of a premultiplied-BGRA buffer of `w`×`h` (bytes = `stride`×`h`) that MUST stay
    /// valid + at a stable address until [`overlay_remove`] or the next `overlay_add` for `id`
    /// (mpv reads it each frame, it does not copy). See `overlay-add` in the mpv manual.
    #[cfg(target_os = "linux")]
    pub fn overlay_add(&self, id: i64, x: i64, y: i64, addr: usize, w: i64, h: i64, stride: i64) -> Result<(), String> {
        let guard = self.mpv.lock().map_err(|e| e.to_string())?;
        let mpv = guard.as_ref().ok_or("no player")?;
        let (ids, xs, ys) = (id.to_string(), x.to_string(), y.to_string());
        let file = format!("&{addr}");
        let (ws, hs, ss) = (w.to_string(), h.to_string(), stride.to_string());
        // overlay-add <id> <x> <y> <file> <offset> <fmt> <w> <h> <stride>
        mpv.command("overlay-add", &[&ids, &xs, &ys, &file, "0", "bgra", &ws, &hs, &ss])
            .map_err(|e| e.to_string())
    }

    /// Remove the OSD overlay with the given `id` (Game-mode controls hidden).
    #[cfg(target_os = "linux")]
    pub fn overlay_remove(&self, id: i64) -> Result<(), String> {
        let guard = self.mpv.lock().map_err(|e| e.to_string())?;
        let mpv = guard.as_ref().ok_or("no player")?;
        mpv.command("overlay-remove", &[&id.to_string()])
            .map_err(|e| e.to_string())
    }

    /// Save a screenshot of the current frame (with subtitles) into `dir`. The
    /// caller resolves + creates `dir` (the app Pictures folder). Used by
    /// `player_screenshot`.
    pub fn screenshot(&self, dir: &str) -> Result<(), String> {
        let guard = self.mpv.lock().map_err(|e| e.to_string())?;
        let mpv = guard.as_ref().ok_or("no player")?;
        let _ = mpv.set_property("screenshot-directory", dir);
        // "subtitles" = the rendered frame including subs (mpv's default screenshot
        // mode), which is what a viewer expects to capture.
        mpv.command("screenshot", &["subtitles"]).map_err(|e| e.to_string())
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
            // Extra fields so the UI can DISAMBIGUATE tracks that share a title/lang
            // (e.g. two "English" audio tracks that differ by codec/channels — the
            // "Your Name" case). Absent fields swallow to defaults.
            let codec: String = mpv
                .get_property(&format!("track-list/{i}/codec"))
                .unwrap_or_default();
            let channels: i64 = mpv
                .get_property(&format!("track-list/{i}/audio-channels"))
                .unwrap_or(0);
            let default: bool = mpv
                .get_property(&format!("track-list/{i}/default"))
                .unwrap_or(false);
            let forced: bool = mpv
                .get_property(&format!("track-list/{i}/forced"))
                .unwrap_or(false);
            arr.push(serde_json::json!({
                "id": id, "type": ty, "title": title, "lang": lang, "selected": selected,
                "codec": codec, "channels": channels, "default": default, "forced": forced,
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
pub(crate) fn spawn_event_loop(mpv: &Mpv, app: AppHandle) -> Result<(), libmpv2::Error> {
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
    // Loading/stall signals the overlay composes into one spinner state:
    // `core-idle` = no frame is being shown (pre-first-frame OR a stall);
    // `seeking` = mid-seek, frame not ready (buffering between segments);
    // `eof-reached` = at true end, so the loader clears instead of sticking.
    client.observe_property("core-idle", Format::Flag, 0)?;
    client.observe_property("seeking", Format::Flag, 0)?;
    client.observe_property("eof-reached", Format::Flag, 0)?;

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
                    ("core-idle", PropertyData::Flag(v)) => {
                        let _ = app.emit("player-core-idle", v);
                    }
                    ("seeking", PropertyData::Flag(v)) => {
                        let _ = app.emit("player-seeking", v);
                    }
                    ("eof-reached", PropertyData::Flag(v)) => {
                        let _ = app.emit("player-eof", v);
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
    // Linux own-window (wid=None): webkit's renderer already holds a GL/EGL context in
    // THIS process; a second GL context from mpv's gpu vo crashes the renderer on the
    // Deck's Mesa. Use a non-GL output (wayland shared-memory, X11 fallback) — software
    // presentation, no GL context to clash. (Windows embeds via wid and keeps gpu.)
    #[cfg(all(unix, not(target_os = "macos")))]
    if wid.is_none() {
        return new_mpv_with_vo("wlshm", wid).or_else(|_| new_mpv_with_vo("x11", wid));
    }
    match new_mpv_with_vo("gpu-next", wid) {
        Ok(mpv) => Ok(mpv),
        Err(_) => new_mpv_with_vo("gpu", wid),
    }
}

/// Build an mpv core for the Linux embedded player: `vo=libmpv` (required by the
/// OpenGL render API — [`linux_embed`] renders it into a `wl_subsurface`) with no
/// window of its own. mpv handles NO input (the HTML overlay owns the controls);
/// streaming/quality options mirror the embedded Windows path.
#[cfg(target_os = "linux")]
fn new_mpv_libmpv() -> Result<Mpv, libmpv2::Error> {
    // mpv_create() returns NULL unless LC_NUMERIC == "C"; GTK sets the process
    // locale from the environment, so force it back before creating the core.
    unsafe {
        extern "C" {
            fn setlocale(
                category: std::os::raw::c_int,
                locale: *const std::os::raw::c_char,
            ) -> *mut std::os::raw::c_char;
        }
        // glibc: LC_NUMERIC == 1.
        setlocale(1, c"C".as_ptr());
    }
    Mpv::with_initializer(|init| {
        // vo=libmpv is the ONLY MANDATORY option — the render API can't work without
        // it. Every other option is BEST-EFFORT (`let _ =`): mpv option availability
        // drifts across versions/builds (e.g. `demuxer-seekable-cache` was deprecated
        // in 0.32 and removed by 0.40), and set_option returns OPTION_NOT_FOUND (-5) for
        // an unknown name — which, if propagated, aborts core creation and kills playback
        // for a mere tuning knob. So we never let a non-essential option fail the core.
        init.set_option("vo", "libmpv")?;
        // Decode on the GPU but copy frames to system memory for GL upload (auto-copy) —
        // avoids VAAPI GL interop that color-corrupts on some drivers.
        let _ = init.set_option("hwdec", "auto-copy");
        // Pure render surface — never handle input; the overlay drives mpv.
        let _ = init.set_option("input-cursor", "no");
        let _ = init.set_option("input-vo-keyboard", "no");
        let _ = init.set_option("input-default-bindings", "no");
        let _ = init.set_option("osc", "no");
        let _ = init.set_option("cursor-autohide", "no");
        // Contain (letterbox), never zoom/crop by default.
        let _ = init.set_option("keepaspect", "yes");
        let _ = init.set_option("video-zoom", "0");
        let _ = init.set_option("panscan", "0");
        // HDR / tone-mapping (SDR panels) — same as the Windows path.
        let _ = init.set_option("target-colorspace-hint", "auto");
        let _ = init.set_option("tone-mapping", "bt.2390");
        // Picture quality (libplacebo).
        let _ = init.set_option("scale", "ewa_lanczossharp");
        let _ = init.set_option("scale-antiring", "0.6");
        let _ = init.set_option("dscale", "mitchell");
        let _ = init.set_option("cscale", "ewa_lanczossharp");
        let _ = init.set_option("deband", "yes");
        let _ = init.set_option("dither-depth", "auto");
        let _ = init.set_option("screenshot-format", "png");
        // Network streaming (seekable debrid HTTP URLs): force seekability + a large
        // demuxer cache so scrubbing fetches new ranges instead of looping the buffered
        // window, with a small fast-start probe.
        let _ = init.set_option("cache", "yes");
        let _ = init.set_option("force-seekable", "yes");
        // Rolling stream buffer (a few minutes of anime) — NOT the whole file. mpv's own
        // default is ~150 MiB; VLC/HTML5 keep a modest buffer too. The old 512 MiB could hold
        // an entire episode in RAM on a handheld, which is the memory bloat we're avoiding.
        let _ = init.set_option("demuxer-max-bytes", "134217728");
        let _ = init.set_option("demuxer-max-back-bytes", "33554432");
        let _ = init.set_option("demuxer-lavf-probesize", "2097152");
        let _ = init.set_option("demuxer-lavf-analyzeduration", "1");
        let _ = init.set_option("stream-buffer-size", "262144");
        let _ = init.set_option("network-timeout", "30");
        let _ = init.set_option(
            "stream-lavf-o",
            "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=5",
        );
        Ok(())
    })
}

/// Keep a cache key safe as a single directory name (infoHash is hex; a
/// media-episode key like `12345-3` is also safe — this just hardens it).
fn sanitize_key(key: &str) -> String {
    key.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(80)
        .collect()
}

/// Write JPEG `bytes` to `out` atomically (temp file + rename) so a reader never sees
/// a half-written tile. Returns true on success. Used for headless-decoder tiles.
fn write_tile_atomic(out: &Path, bytes: &[u8]) -> bool {
    let tmp = out.with_extension("part.jpg");
    if std::fs::write(&tmp, bytes).is_ok() && std::fs::rename(&tmp, out).is_ok() {
        return true;
    }
    let _ = std::fs::remove_file(&tmp);
    false
}

/// Minimal standard-alphabet base64 (avoids a crate) for the thumbnail data URL.
fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity((data.len() + 2) / 3 * 4);
    for c in data.chunks(3) {
        let n = ((c[0] as u32) << 16)
            | ((*c.get(1).unwrap_or(&0) as u32) << 8)
            | (*c.get(2).unwrap_or(&0) as u32);
        s.push(T[(n >> 18 & 63) as usize] as char);
        s.push(T[(n >> 12 & 63) as usize] as char);
        s.push(if c.len() > 1 { T[(n >> 6 & 63) as usize] as char } else { '=' });
        s.push(if c.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    s
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
                let _ = init.set_option("input-cursor", "no");
                let _ = init.set_option("input-vo-keyboard", "no");
                let _ = init.set_option("input-default-bindings", "no");
                let _ = init.set_option("window-dragging", "no");
                let _ = init.set_option("osc", "no");
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
        // GL-interop hwdec (`auto`) needs mpv's own GL context; a non-GL vo (wlshm/x11)
        // must copy frames back to system memory so it never creates a GL/EGL context
        // (which would clash with webkit's renderer on Linux). `auto-copy` still HW-decodes.
        let hwdec = if vo.starts_with("gpu") { "auto" } else { "auto-copy" };
        let _ = init.set_option("hwdec", hwdec);
        // Linux X11 embed (gamescope Game mode / XWayland): force EGL-on-X11. mpv's default
        // gpu-context auto-selection tries GLX first, which fails to create a context on an
        // embedded window under XWayland → audio plays but NO video. x11egl is the reliable
        // path. (Windows sets gpu-context=d3d11 below; the Wayland subsurface path uses
        // new_mpv_libmpv, not this builder.)
        #[cfg(target_os = "linux")]
        if wid.is_some() {
            let _ = init.set_option("gpu-context", "x11egl");
            // TEMP diagnostic: surface mpv's vo init to stderr (izumi run.log).
            let _ = init.set_option("terminal", "yes");
            let _ = init.set_option("msg-level", "all=v");
        }
        // Render the video to EXACTLY the embedded child surface — never DPI-scale it.
        // On a Windows display at 125%/150% scaling, mpv otherwise renders the video
        // larger than the window and crops it (the "zoomed in" bug). We hand mpv real
        // pixel-sized child windows, so it must not re-apply the OS scale factor.
        let _ = init.set_option("hidpi-window-scale", "no");
        // Contain (letterbox), never zoom/crop by default — 'fill' fit sets panscan=1.
        let _ = init.set_option("keepaspect", "yes");
        let _ = init.set_option("video-zoom", "0");
        let _ = init.set_option("panscan", "0");
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
        let _ = init.set_option("target-colorspace-hint", "auto");
        let _ = init.set_option("tone-mapping", "bt.2390");

        // --- Picture quality (gpu-next / libplacebo) ---
        // Best-effort (`let _`) so an older libmpv that lacks one of these just keeps
        // its default instead of failing init. Cheap + safe on an iGPU / Steam Deck
        // (the heavy GLSL upscalers like ArtCNN/FSRCNNX are intentionally NOT set).
        // Video is never stretched: we don't touch `keepaspect` (defaults to yes), so
        // mpv preserves aspect (letterbox) and high-quality-scales to the window.
        // ewa_lanczossharp = sharp upscale (1080p→4K) with anti-ringing; mitchell =
        // clean 4K→1080p downscale (no ringing); sharp chroma; deband kills banding in
        // dark anime gradients; dither at the true panel depth.
        let _ = init.set_option("scale", "ewa_lanczossharp");
        let _ = init.set_option("scale-antiring", "0.6");
        let _ = init.set_option("dscale", "mitchell");
        let _ = init.set_option("cscale", "ewa_lanczossharp");
        let _ = init.set_option("deband", "yes");
        let _ = init.set_option("dither-depth", "auto");
        // Never let mpv hide the OS cursor. When embedded, the WebView2 overlay
        // sits above mpv and grabs mouse-move events, so mpv's autohide timer
        // expires and the cursor vanishes even while the user is moving it. `no`
        // keeps the cursor visible; the webview drives its own idle-hide.
        let _ = init.set_option("cursor-autohide", "no");
        // Screenshots (player screenshot button) as PNG; the directory is set per-shot
        // from Rust (app Pictures dir) since mpv init can't resolve the app path here.
        let _ = init.set_option("screenshot-format", "png");

        // --- Network streaming (debrid HTTP URLs with range-request support) ---
        // Real-Debrid links are seekable via HTTP ranges, but mpv sometimes marks
        // remote streams unseekable and then a forward seek past the cache just
        // jumps back to the cached window. Force seekability + a large demuxer
        // cache so seeking into not-yet-loaded regions actually fetches the new
        // range instead of looping over the buffered one, and so the seekbar has
        // a real "loaded" extent to show.
        let _ = init.set_option("cache", "yes");
        let _ = init.set_option("force-seekable", "yes");
        // Best-effort: removed from mpv by 0.40 (deprecated 0.32) → OPTION_NOT_FOUND on
        // newer libmpv would otherwise abort init.
        let _ = init.set_option("demuxer-seekable-cache", "yes");
        // Large forward + back BACKGROUND cache (a CEILING, not a pre-fill gate — it
        // does NOT delay the first frame). 512 MiB ahead for scrubbing; 128 MiB back
        // for instant short backward seeks.
        // Rolling stream buffer (a few minutes of anime) — NOT the whole file. mpv's own
        // default is ~150 MiB; VLC/HTML5 keep a modest buffer too. The old 512 MiB could hold
        // an entire episode in RAM on a handheld, which is the memory bloat we're avoiding.
        let _ = init.set_option("demuxer-max-bytes", "134217728");
        let _ = init.set_option("demuxer-max-back-bytes", "33554432");

        // FAST START: the first frame is gated by libavformat PROBING, not the cache.
        // mpv leaves probesize/analyzeduration at 0 → FFmpeg's own defaults apply
        // (~5 MB probe + up to ~5 s analysis) which mpv downloads/waits on BEFORE the
        // first frame — that's the "buffers too much before starting" delay. Cap them
        // so playback starts after a small probe, but keep them GENEROUS enough to
        // still detect anime's secondary subtitle/audio tracks (2 MiB / 1 s — do NOT
        // go lower, and never use probe-info=nostreams, which drops sub/audio tracks).
        let _ = init.set_option("demuxer-lavf-probesize", "2097152");
        let _ = init.set_option("demuxer-lavf-analyzeduration", "1");
        // Fewer tiny HTTP round-trips when reading the MKV Cues / MP4 moov (which live
        // at the file tail) on open.
        let _ = init.set_option("stream-buffer-size", "262144");
        // NOTE: demuxer-readahead-secs is intentionally NOT set — with cache=yes it's
        // overridden by cache-secs (max of both), so a big value did nothing but
        // mislead; the real ceiling is demuxer-max-bytes above.

        // Fail a dead CDN socket sooner than the 60s default, and auto-reconnect on
        // mid-stream drops (protocol AVOptions go through stream-lavf-o, not demuxer).
        let _ = init.set_option("network-timeout", "30");
        let _ = init.set_option(
            "stream-lavf-o",
            "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=5",
        );
        Ok(())
    })
}
