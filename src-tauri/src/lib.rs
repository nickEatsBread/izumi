// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod doh;
mod download;
mod direct_torrent;
mod direct_torrent_select;
mod sync;
mod watch_room;
// The native libmpv player is desktop-only; Android delegates playback to an external app.
#[cfg(not(target_os = "android"))]
mod player;
// Steam Deck on-screen keyboard via Steamworks (Linux/Game mode); no-op elsewhere.
#[cfg(target_os = "linux")]
mod steam_osk;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Remembers whether the main window was maximized before entering fullscreen, so
/// exit can re-maximize it. We must un-maximize BEFORE `set_fullscreen`: tao enters
/// fullscreen from a MAXIMIZED `decorations:false` window with a ~40px offset /
/// overflow (tauri #11788) — windowed→fullscreen is fine, maximized→fullscreen is
/// not (the exact symptom the user hit).
#[derive(Default)]
struct FsWasMax(std::sync::Mutex<bool>);

// Unique labels for webview popups created from discussion embeds. Tauri requires each live
// webview window to have a distinct label, and Disqus can open more than one OAuth hop.
static DISCUSSION_POPUP_ID: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(1);

/// One-shot TAC configuration prepared immediately before the Deck opens the first-party
/// verification window. Keeping it in native state survives Cloudflare's top-level navigations;
/// URL fragments do not reliably survive that flow under WebKitGTK.
#[derive(Default)]
struct TacVerificationConfig(std::sync::Mutex<Option<serde_json::Value>>);

#[derive(Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
// The fields are consumed by the Game-mode OSD (player::gm_osd), which only compiles on Linux
// (the Steam Deck). On other targets the struct is still deserialized from the frontend but its
// fields go unread — expected, so silence dead_code off-Linux only.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) struct GmDynamicOverlay {
    pub(crate) visible: bool,
    pub(crate) loading: bool,
    pub(crate) first_frame: bool,
    pub(crate) scrubbing: bool,
    pub(crate) pos: f64,
    pub(crate) dur: f64,
    pub(crate) buffer: f64,
    pub(crate) scrub_time: f64,
    pub(crate) smooth_scrub: bool,
    // True when the scrub is driven by the L2/R2 trigger (stepped, indirect) rather than a
    // finger on the touchscreen (direct). Picks the tween time-constant in gm_osd: a longer
    // one smooths the trigger's 5s steps, a short one keeps the touch knob glued to the finger.
    pub(crate) pad_scrub: bool,
    pub(crate) width: f64,
    pub(crate) height: f64,
    // The HTML seek bar's on-screen geometry (CSS px, same space as width/height) so the
    // native scrub bar is drawn exactly where the player's own bar is — a seamless handoff.
    pub(crate) bar_x: f64,
    pub(crate) bar_y: f64, // vertical CENTRE of the bar
    pub(crate) bar_w: f64,
    pub(crate) bar_h: f64,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Embed mpv into the MAIN window and start playback — single-window design.
///
/// The SPA renders the player overlay (transparent video surface + custom
/// controls) inside the *same* webview, which composites above mpv's child
/// surface, so there is NO separate OS window. `wid` is the main window's Win32
/// `HWND` as an `i64` (see `player_play_embedded` for the pointer-widening
/// rationale).
///
/// Reuses `PlayerHandle::play_embedded`: the first call binds mpv to the window
/// and spawns the event loop; later calls just `loadfile` the next stream (used by
/// next-episode auto-advance). The overlay learns the title/ids from the frontend
/// `nowPlaying` store (same webview), so nothing is emitted here.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn player_embed(
    app: AppHandle,
    url: String,
    start_seconds: Option<f64>,
    alang: Option<String>,
    slang: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    subtitles: Option<Vec<player::Subtitle>>,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("no main window")?;
    #[cfg(windows)]
    let (main_raw, wid) = {
        let m = main.hwnd().map_err(|e| e.to_string())?.0 as isize;
        set_webview_transparent(&main);
        // Embed mpv into the container child (created on the UI thread in setup) sized to
        // the player area — NOT the whole window (mpv re-fills its wid parent → full-
        // window/zoomed render). Fall back to the main window if the container is missing.
        // Do NOT create a window here: this is an async command thread (no message pump).
        let container = MPV_CONTAINER.load(std::sync::atomic::Ordering::Relaxed);
        (m, if container != 0 { container as i64 } else { m as i64 })
    };
    #[cfg(windows)]
    {
        player.play_embedded(&url, wid, app.clone(), start_seconds, alang, slang, headers.clone(), subtitles.clone())?;
        resize_mpv_child(main_raw);
    }
    // Linux/Wayland: embed mpv into a wl_subsurface placed BELOW the (transparent)
    // webview via the OpenGL render API, WITHOUT touching the webview's GTK tree
    // (reparenting it crashes webkit). The core lives in PlayerHandle, so controls
    // + progress events work exactly as on Windows. Make the webview background
    // transparent first so the video shows through the player's video area.
    #[cfg(target_os = "linux")]
    {
        let _ = main.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));
        if player::linux_embed::is_wayland(&main) {
            // Desktop / KWin (native Wayland): mpv in a wl_subsurface below the transparent
            // webview, HTML controls floating over it.
            player.play_embedded_render(&url, app.clone(), start_seconds, alang, slang, &main, headers.clone(), subtitles.clone())?;
        } else {
            // Game mode / gamescope (XWayland X11): no wl_subsurface — embed mpv via `--wid`
            // into a fullscreen X11 CONTAINER window we own (so it can be shown/hidden for the
            // touch-controls swap + made input-transparent). Fullscreen; no windowed layout.
            let size = main.inner_size().map_err(|e| e.to_string())?;
            let xid = player::linux_x11::ensure_container(&main, size.width, size.height)?;
            player.play_embedded(&url, xid, app.clone(), start_seconds, alang, slang, headers.clone(), subtitles.clone())?;
        }
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (&player, &main, &app, &start_seconds, &alang, &slang, &url, &headers, &subtitles);
    }
    Ok(())
}

/// Stop playback: drop the mpv core, which destroys mpv's child surface inside the
/// main window so the (opaque again) browse UI shows through. The overlay itself is
/// torn down by the frontend (`playing = false`).
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn close_player(player: tauri::State<'_, player::PlayerHandle>) -> Result<(), String> {
    // Stop the mpv core. On Linux this also tears down the embed subsurface +
    // render context (via `PlayerHandle::stop` → `linux_embed::detach`) before the
    // core is quit. On Windows it destroys mpv's child inside the container (which
    // is created once on the UI thread and reused for the next play).
    #[cfg(target_os = "linux")]
    player::linux_x11::destroy_container();
    player.stop()
}

/// Game mode (gamescope / Steam Deck) detection — the frontend renders a fullscreen layout
/// (no sidebar, full-width overlay). Detected by gamescope's env marker, which is set whether
/// we connected natively (Wayland, the layer-shell overlay path) or fell back to XWayland.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_is_game_mode(app: AppHandle) -> bool {
    let _ = &app;
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("GAMESCOPE_WAYLAND_DISPLAY").is_some()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Game mode: start/stop compositing the HTML controls onto the video via an mpv overlay.
/// gamescope can't blend a transparent app surface, so the frontend calls this whenever the
/// controls show/hide and mpv bakes a snapshot of them over the video (see linux_overlay).
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_gm_overlay(app: AppHandle, visible: bool, fast: Option<bool>) {
    #[cfg(target_os = "linux")]
    {
        if let Some(win) = app.get_webview_window("main") {
            if visible {
                player::linux_overlay::start(app.clone(), win, fast.unwrap_or(false));
            } else {
                player::linux_overlay::stop(app.clone());
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, visible, fast);
    }
}

/// Game mode dynamic overlay: loading and active scrub are rendered inside mpv as ASS OSD.
/// This keeps the moving Deck UI off the expensive WebKit snapshot/readback path.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_gm_dynamic_overlay(app: AppHandle, state: GmDynamicOverlay) {
    #[cfg(target_os = "linux")]
    player::gm_osd::update(app, state);
    #[cfg(not(target_os = "linux"))]
    let _ = (app, state);
}

/// Start/stop the backend gamepad reader (Steam Deck L2/R2 seek). The webview's own Gamepad
/// API doesn't see the Deck controller under gamescope, so we read it via evdev in Rust and
/// emit `gamepad-trigger` events the frontend feeds into the seek logic (see gamepad_linux).
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn gamepad_start(app: AppHandle) {
    #[cfg(target_os = "linux")]
    player::gamepad_linux::start(app);
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn gamepad_stop() {
    #[cfg(target_os = "linux")]
    player::gamepad_linux::stop();
}

#[derive(Default, serde::Serialize)]
struct GamepadTriggerState {
    l2: bool,
    r2: bool,
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn gamepad_trigger_state() -> GamepadTriggerState {
    #[cfg(target_os = "linux")]
    {
        let state = player::gamepad_linux::trigger_state();
        GamepadTriggerState {
            l2: state.l2,
            r2: state.r2,
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        GamepadTriggerState::default()
    }
}

/// Launch an external video player (the user's chosen executable) with the stream
/// URL as its sole argument — passes exactly the URL and no
/// flags. Used when "external player" is enabled in settings; playback then happens
/// in that app's own window (we get no progress events back).
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn spawn_external_player(path: String, url: String) -> Result<(), String> {
    if url.is_empty() {
        return Err("no stream url".into());
    }
    if path.is_empty() {
        return Err("No external player selected — set its path in Settings.".into());
    }
    std::process::Command::new(&path)
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Couldn't launch external player: {e}"))?;
    Ok(())
}

/// Read a string mpv property for the controls (e.g. `pause`). Note: complex
/// node properties like `track-list` cannot be read this way (mpv won't stringify
/// them) — use [`player_tracks`] instead.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_get_property(
    name: String,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<String, String> {
    player.get_property(&name)
}

/// Register a scrub-preview thumbnail job for the current stream. `key` is the infoHash
/// (or media-episode) cache key; `duration` comes from mpv so we don't re-probe. Tiles
/// are then rendered on demand by the headless libmpv decoder. Cached under
/// `<app-cache>/thumbs`.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_sprite_start(
    app: AppHandle,
    key: String,
    duration: f64,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<(), String> {
    let cache_root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("thumbs");
    player.start_sprite(key, duration, cache_root);
    Ok(())
}

fn dir_size(p: &std::path::Path) -> u64 {
    let mut total = 0;
    if let Ok(rd) = std::fs::read_dir(p) {
        for e in rd.flatten() {
            let path = e.path();
            if path.is_dir() { total += dir_size(&path); }
            else if let Ok(m) = e.metadata() { total += m.len(); }
        }
    }
    total
}

/// Clear the on-disk scrub-thumbnail cache (`<app-cache>/thumbs`) — the sprite JPEGs generated
/// while skimming the seek bar. They regenerate on demand, so this only frees space. Returns
/// the number of bytes freed.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn clear_video_cache(app: AppHandle) -> Result<u64, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("thumbs");
    let freed = dir_size(&dir);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(freed)
}

/// Set the WebKit page zoom (Linux). Used in Game mode instead of CSS `zoom` on the scroll
/// root — CSS zoom forces WebKit to re-rasterize the whole page on every scroll (the slow
/// vertical scrolling on the Deck), whereas native page zoom scrolls on the compositor,
/// exactly like a zoomed page in a desktop browser. No-op on non-Linux (no gamescope there).
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn set_webview_zoom(app: AppHandle, level: f64) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.with_webview(move |pw| {
            use webkit2gtk::WebViewExt;
            pw.inner().set_zoom_level(level);
        });
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (&app, level);
    Ok(())
}

/// Reassert Gamescope's native touchscreen routing after a client-side screen transition. Steam
/// can rewrite the XWayland root property after the controller-triggered navigation event; doing
/// this from Svelte's `afterNavigate` hook runs after that transition rather than racing it.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn restore_native_touch(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        return player::linux_x11::enable_native_touch(&window);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
        Ok(())
    }
}

/// Show the Steam Deck floating on-screen keyboard over a focused field (window-pixel rect).
/// Returns true if the Steam OSK was shown; false → the frontend uses its built-in HTML keyboard.
/// `mode`: 0 single-line, 1 multi-line, 2 email, 3 numeric.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn steam_show_osk(app: AppHandle, x: i32, y: i32, w: i32, h: i32, mode: i32) -> bool {
    #[cfg(target_os = "linux")]
    {
        if steam_osk::show(x, y, w, h, mode) {
            return true;
        }
        // SteamOS's own GTK input module uses this URI to summon the overlay keyboard. It is the
        // reliable Flatpak fallback when the host Steamworks shim cannot be dlopened in the GNOME
        // runtime. A successful portal request suppresses izumi's HTML keyboard.
        use tauri_plugin_opener::OpenerExt;
        let requested = app
            .opener()
            .open_url("steam://open/keyboard", None::<String>)
            .is_ok();
        player::linux_embed::elog(&format!(
            "steam_osk: overlay URI requested={requested}"
        ));
        requested
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, x, y, w, h, mode);
        false
    }
}

#[cfg(not(target_os = "android"))]
fn discussion_log(message: &str) {
    #[cfg(target_os = "linux")]
    player::linux_embed::elog(message);
    #[cfg(not(target_os = "linux"))]
    eprintln!("[izumi] {message}");
}

#[cfg(not(target_os = "android"))]
fn finish_discussion_popup(
    window: &tauri::WebviewWindow,
    app: &AppHandle,
) -> Result<(), String> {
    if !window.label().starts_with("discussion-popup-") {
        return Err("not a discussion popup".into());
    }
    window.close().map_err(|error| error.to_string())?;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
        #[cfg(target_os = "linux")]
        if let Err(error) = player::linux_x11::enable_native_touch(&main) {
            player::linux_embed::elog(&format!(
                "discussion-popup: completion touch restore failed: {error}"
            ));
        }
    }
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn discussion_popup_complete(
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<(), String> {
    finish_discussion_popup(&window, &app)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn resolve_deck_login_popup(app: AppHandle, label: String, proceed: bool) -> Result<(), String> {
    if !label.starts_with("discussion-popup-") {
        return Err("invalid login popup label".into());
    }
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| "login popup is no longer available".to_string())?;
    if proceed {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())
    } else {
        window.close().map_err(|error| error.to_string())
    }
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn set_tac_verification_config(
    config: serde_json::Value,
    pending: tauri::State<'_, TacVerificationConfig>,
) -> Result<(), String> {
    let present = |key: &str| match config.get(key) {
        Some(serde_json::Value::Number(value)) => value.as_u64().is_some_and(|id| id > 0),
        Some(serde_json::Value::String(value)) => !value.trim().is_empty() && value != "0",
        _ => false,
    };
    if !present("MAL_ID") && !present("AniList_ID") {
        return Err("TAC configuration has no MAL_ID or AniList_ID".into());
    }
    *pending.0.lock().map_err(|_| "TAC configuration lock poisoned")? = Some(config);
    Ok(())
}

/// Toggle the WebView's hardware-acceleration policy (Linux, Game mode only). In Game mode the
/// player controls are NEVER shown on screen by WebKit: the opaque mpv X11 container sits above the
/// webview, and a snapshot of the (transparent) HTML controls is pushed into mpv as an overlay. GPU
/// accelerated compositing therefore buys NOTHING for the player UI, yet it captures every element
/// WebKit puts on its own compositing layer (the audio/subtitle + options menus, popovers) at
/// reduced fidelity — grayscale AA + a bilinear resample of the layer texture — which is the
/// pixelated menu text. Forcing the non-accelerated (shared-memory) path while the player is up
/// renders the whole overlay crisp, so the snapshot is sharp.
///
/// This is safe HERE (unlike the global default, which keeps accel ON to fix a Desktop ghost trail
/// — see the webview setup): the Game-mode menus UNMOUNT (Svelte `{#if}`) rather than hide, so the
/// accel-only anti-ghost layer promotion isn't needed, and the one element that relied on it (the
/// moving scrub tooltip) is drawn as a native mpv OSD in Game mode, not HTML. `enabled=true`
/// restores the on-demand default for the browse UI, which needs accel for smooth page-zoom
/// scrolling; Desktop never calls this (its controls are live-composited). No-op on non-Linux.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn set_webview_accel(app: AppHandle, enabled: bool) {
    #[cfg(target_os = "linux")]
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.with_webview(move |pw| {
            use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};
            if let Some(settings) = pw.inner().settings() {
                settings.set_hardware_acceleration_policy(if enabled {
                    HardwareAccelerationPolicy::OnDemand
                } else {
                    HardwareAccelerationPolicy::Never
                });
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (&app, enabled);
}

/// The scrub-preview tile for hover `time` (seconds) on stream `key`. Returns
/// `{status: ready|pending|failed|none, dataUrl?, index}` — `ready` carries that ONE
/// small tile JPEG (few KB), `pending` means its frame isn't generated yet (seekbar
/// shows a loading shimmer, never blank).
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_thumb_tile(
    key: String,
    time: f64,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<player::ThumbTile, String> {
    player.thumb_tile(&key, time)
}

/// Geometry + coverage for stream `key`'s thumbnails: `{status, interval, frames}` so
/// the seekbar can map a hover time to a tile index and stop polling once `done`.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_thumb_info(
    key: String,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<player::ThumbInfo, String> {
    player.thumb_info(&key)
}

/// One process-wide pooled HTTP client. `tauri-plugin-http` builds a FRESH
/// `reqwest::Client` on every request (commands.rs `ClientBuilder::new()` per call),
/// so it never reuses a connection — every addon/AniZip/manifest fetch pays the full
/// ~300ms TCP+TLS handshake. Sharing one client keeps the connection pool warm so
/// repeat fetches to the same host skip the handshake (~25ms instead of ~300ms).
// Swappable so Settings → Network can turn DNS-over-HTTPS on/off at runtime: `set_doh`
// rebuilds the client (with or without the DoH resolver) and swaps it in. Callers take
// a cheap clone (reqwest::Client is Arc-backed) rather than a borrow.
static HTTP: std::sync::OnceLock<std::sync::RwLock<reqwest::Client>> = std::sync::OnceLock::new();
static HTTP_DL: std::sync::OnceLock<std::sync::RwLock<reqwest::Client>> = std::sync::OnceLock::new();

fn build_http_client(doh: Option<String>, download: bool) -> reqwest::Client {
    let mut b = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(if download { 15 } else { 10 }))
        .pool_max_idle_per_host(8)
        .tcp_keepalive(std::time::Duration::from_secs(90));
    // API/metadata requests get a short TOTAL timeout. Downloads MUST NOT — a multi-GB 4K file takes
    // minutes to hours, and a total timeout aborts the transfer mid-stream ("error decoding response
    // body"), which broke every non-trivial download. Downloads instead use a per-read IDLE timeout:
    // a stalled connection still fails promptly (→ resume), but a long healthy transfer isn't killed.
    b = if download {
        b.read_timeout(std::time::Duration::from_secs(60))
    } else {
        b.timeout(std::time::Duration::from_secs(30))
    };
    if let Some(url) = doh {
        b = b.dns_resolver(std::sync::Arc::new(doh::DohResolver::new(url)));
    }
    b.build().unwrap_or_else(|_| reqwest::Client::new())
}

fn http_lock() -> &'static std::sync::RwLock<reqwest::Client> {
    HTTP.get_or_init(|| std::sync::RwLock::new(build_http_client(None, false)))
}
fn http_dl_lock() -> &'static std::sync::RwLock<reqwest::Client> {
    HTTP_DL.get_or_init(|| std::sync::RwLock::new(build_http_client(None, true)))
}

pub(crate) fn http_client() -> reqwest::Client {
    http_lock().read().unwrap().clone()
}
/// A client tuned for large file downloads: no total timeout (only a per-read idle timeout).
pub(crate) fn download_http_client() -> reqwest::Client {
    http_dl_lock().read().unwrap().clone()
}

/// Rebuild the shared HTTP client with DNS-over-HTTPS on or off. Called by the
/// frontend on startup and whenever the Network setting changes. `url` is the DoH
/// JSON endpoint (e.g. https://cloudflare-dns.com/dns-query). Covers every request
/// that goes through the pooled client (addons, AniZip, id-map, Kitsu, downloads,
/// prefetch); AniList/MAL browse fetches and mpv playback keep their own resolvers.
#[tauri::command]
fn set_doh(enabled: bool, url: String) {
    let doh = if enabled && url.trim().starts_with("http") { Some(url.trim().to_string()) } else { None };
    *http_lock().write().unwrap() = build_http_client(doh.clone(), false);
    *http_dl_lock().write().unwrap() = build_http_client(doh, true);
}

/// Set the player's demuxer cache ceiling (bytes) from the user's setting; applied on the next
/// file load. Clamped to a sane floor so a mis-set value can't starve the demuxer.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn set_player_cache(bytes: u64) {
    player::PLAYER_CACHE_BYTES.store(bytes.max(8 * 1024 * 1024), std::sync::atomic::Ordering::Relaxed);
}

/// Inhibit the OS idle / screen-blank while a video is actively playing — so the Steam Deck's
/// screen doesn't dim mid-episode. Called with `on=false` when paused, at EOF, or when the
/// player closes (and gated by the user's "Keep screen awake while playing" setting), so
/// battery-saver still kicks in then and on other screens. Per-OS backends live in
/// [`player::wakelock`] — Wayland idle-inhibit on the Deck (gamescope ignores the old
/// systemd-inhibit logind lock), SetThreadExecutionState on Windows, `caffeinate` on macOS,
/// systemd-inhibit fallback on X11. The embedded libmpv render path has no window, so mpv's
/// own `stop-screensaver` can't do this for us.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn set_idle_inhibit(app: AppHandle, on: bool) {
    player::wakelock::set(&app, on);
}

/// Write a UTF-8 text file to an absolute path chosen via the save dialog. Used by the local-history
/// export (there's no plugin-fs; this is the minimal write primitive the frontend needs).
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Android self-update: download a release APK to the app cache dir and return its path
/// (the frontend then hands it to the package installer via the extplayer plugin). Uses the
/// download client (no total timeout). Overwrites any previous update file.
#[cfg(target_os = "android")]
#[tauri::command]
async fn updater_download_apk(app: AppHandle, url: String) -> Result<String, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join("izumi-update.apk");
    let resp = download_http_client().get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Update download failed (HTTP {})", resp.status().as_u16()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
pub struct HttpReply {
    status: u16,
    body: String,
}

/// Pooled HTTP GET — reuses the shared client so repeated resolve-path fetches skip
/// the per-request TLS handshake that `tauri-plugin-http` pays. Follows redirects.
/// Not scope-restricted (it's our own trusted frontend calling it). NEVER logs the
/// url (addon URLs can embed a debrid secret).
#[tauri::command]
async fn http_get(url: String, headers: Option<std::collections::HashMap<String, String>>) -> Result<HttpReply, String> {
    let mut req = http_client().get(&url);
    if let Some(h) = headers {
        for (k, v) in h {
            req = req.header(k, v);
        }
    }
    let resp = req.send().await.map_err(|_| "request failed".to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|_| "read failed".to_string())?;
    Ok(HttpReply { status, body })
}

#[derive(serde::Serialize)]
pub struct HttpFullReply {
    status: u16,
    headers: std::collections::HashMap<String, String>,
    body: String,
}

/// Pooled HTTP POST that returns status + headers + body as PLAIN data (no streamed
/// resource). Used by the AniList GraphQL client: the webview `fetch` is CORS-bound
/// (breaks when AniList drops `Access-Control-Allow-Origin`), and `@tauri-apps/plugin-http`'s
/// `fetch` returns a lazily-read resource whose rid gets invalidated under urql's concurrent
/// queries ("resource id N is invalid"). This materializes everything up front — the JS side
/// wraps it in a real `Response`. Reuses the shared pool (warm TLS). NEVER logs the url.
#[tauri::command]
async fn http_post(
    url: String,
    body: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<HttpFullReply, String> {
    let mut req = http_client().post(&url).body(body);
    if let Some(h) = headers {
        for (k, v) in h {
            req = req.header(k, v);
        }
    }
    let resp = req.send().await.map_err(|_| "request failed".to_string())?;
    let status = resp.status().as_u16();
    let mut hdrs = std::collections::HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(vs) = v.to_str() {
            hdrs.insert(k.as_str().to_ascii_lowercase(), vs.to_string());
        }
    }
    let body = resp.text().await.map_err(|_| "read failed".to_string())?;
    Ok(HttpFullReply { status, headers: hdrs, body })
}

/// Method-agnostic pooled fetch for source-extension HTTP. The webview `fetch`
/// (and `@tauri-apps/plugin-http`, which normalizes through a `Request`) silently
/// DROPS forbidden header names — `Referer`, `Origin`, `Cookie`, … — before the
/// request leaves the webview. Many streaming embeds gate the actual stream URL on
/// `Referer`, so those extensions resolved nothing. reqwest imposes no such filter,
/// so routing extension requests here delivers every header the extension set.
/// Follows redirects. NEVER logs the url or headers (may embed provider secrets).
#[tauri::command]
async fn ext_fetch(
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpFullReply, String> {
    let verb = method.unwrap_or_else(|| "GET".into()).to_ascii_uppercase();
    let verb = reqwest::Method::from_bytes(verb.as_bytes()).map_err(|_| "bad method".to_string())?;
    let mut req = http_client().request(verb, &url);
    if let Some(h) = headers {
        for (k, v) in h {
            req = req.header(k, v);
        }
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let resp = req.send().await.map_err(|_| "request failed".to_string())?;
    let status = resp.status().as_u16();
    let mut hdrs = std::collections::HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(vs) = v.to_str() {
            hdrs.insert(k.as_str().to_ascii_lowercase(), vs.to_string());
        }
    }
    let body = resp.text().await.map_err(|_| "read failed".to_string())?;
    Ok(HttpFullReply { status, headers: hdrs, body })
}

/// izumi's embedded OpenSubtitles consumer Api-Key — makes *search* keyless for users (download
/// still needs the user's own JWT + quota). A consumer key is client-embedded by design (it ships in
/// the binary), so it's effectively public; the `OPENSUBTITLES_API_KEY` build env overrides the
/// baked default so it can be rotated without a code change.
#[cfg(not(target_os = "android"))]
const OPENSUBTITLES_API_KEY: &str = match option_env!("OPENSUBTITLES_API_KEY") {
    Some(k) => k,
    None => "kpwJltOBFOqFaoRvWSIPph7katlIMxas",
};

/// Mandatory OpenSubtitles `User-Agent` — a missing/default/duplicate UA is an instant 403. Built
/// from the crate version at compile time (e.g. "izumi v0.1.4").
#[cfg(not(target_os = "android"))]
const OPENSUBTITLES_USER_AGENT: &str = concat!("izumi v", env!("CARGO_PKG_VERSION"));

/// Result of an OpenSubtitles `POST /api/v1/login`. Serialized with the Rust field names
/// (snake_case) because the frontend destructures `{ token, base_url, allowed_downloads,
/// remaining, level, expires_at }`. `expires_at` is a client-computed epoch-ms deadline
/// (there is no refresh token; the JWT lives ~12h) after which the frontend must re-login.
/// `base_url` is the resolved (possibly VIP) API base all later calls must target.
#[cfg(not(target_os = "android"))]
#[derive(serde::Serialize)]
pub struct OpenSubtitlesSession {
    token: String,
    base_url: String,
    allowed_downloads: i64,
    remaining: i64,
    level: String,
    expires_at: i64,
}

/// Parse an OpenSubtitles `/login` response body into a session, computing `expires_at` from
/// `now_ms`. Factored out (no network) so it is unit-testable. A returned `base_url` arrives bare
/// (e.g. "vip-api.opensubtitles.com"); it is normalized to an absolute `https://…/api/v1` base the
/// frontend can prefix directly. The login response carries `allowed_downloads` but not
/// `remaining` (that comes from `/download`), so `remaining` defaults to the allowance.
#[cfg(not(target_os = "android"))]
fn parse_opensubtitles_login(body: &str, now_ms: i64) -> Result<OpenSubtitlesSession, String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "bad login json".to_string())?;
    let token = v
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or("login: no token")?
        .to_string();
    let user = v.get("user");
    let allowed_downloads = user
        .and_then(|u| u.get("allowed_downloads"))
        .and_then(|n| n.as_i64())
        .unwrap_or(0);
    let remaining = user
        .and_then(|u| u.get("remaining_downloads"))
        .and_then(|n| n.as_i64())
        .unwrap_or(allowed_downloads);
    let level = user
        .and_then(|u| u.get("level"))
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let base_url = match v.get("base_url").and_then(|s| s.as_str()) {
        Some(host) if !host.is_empty() => {
            if host.starts_with("http") {
                format!("{}/api/v1", host.trim_end_matches('/'))
            } else {
                format!("https://{}/api/v1", host.trim_end_matches('/'))
            }
        }
        _ => String::new(),
    };
    // ~12h token, no refresh; expire ~1h early so a download never races the deadline.
    let expires_at = now_ms + 11 * 60 * 60 * 1000;
    Ok(OpenSubtitlesSession {
        token,
        base_url,
        allowed_downloads,
        remaining,
        level,
        expires_at,
    })
}

/// Sign in to OpenSubtitles and return the JWT + quota + resolved base URL. This is the ONLY place
/// the user's OpenSubtitles credentials go over the wire; the frontend stores just the returned
/// token (and, only with "Stay signed in", the credentials). `POST /api/v1/login` on the pooled
/// client with the embedded Api-Key + mandatory User-Agent. KONG rate-limits `/login`; on a non-2xx
/// (incl. 401) we surface the body and stop — the frontend must not spam re-login.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn opensubtitles_login(
    username: String,
    password: String,
) -> Result<OpenSubtitlesSession, String> {
    let body = serde_json::json!({ "username": username, "password": password }).to_string();
    let resp = http_client()
        .post("https://api.opensubtitles.com/api/v1/login")
        .header("Api-Key", OPENSUBTITLES_API_KEY)
        .header("User-Agent", OPENSUBTITLES_USER_AGENT)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| "login request failed".to_string())?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|_| "login read failed".to_string())?;
    if !status.is_success() {
        return Err(format!("opensubtitles login {}: {text}", status.as_u16()));
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    parse_opensubtitles_login(&text, now_ms)
}

/// Pick the first subtitle entry from a SubDL ZIP archive and return its raw (still-encoded) bytes.
/// Prefers the first `.srt`; falls back to the first `.ass`/`.ssa`. SubDL always returns a ZIP (a
/// non-`unpack` response is never a bare `.srt`). Two-pass so a later `.srt` beats an earlier `.ass`.
#[cfg(not(target_os = "android"))]
fn unzip_first_subtitle(zip_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes)).map_err(|e| e.to_string())?;
    let mut srt_idx: Option<usize> = None;
    let mut ass_idx: Option<usize> = None;
    for i in 0..zip.len() {
        let name = zip
            .by_index(i)
            .map_err(|e| e.to_string())?
            .name()
            .to_ascii_lowercase();
        if name.ends_with(".srt") {
            if srt_idx.is_none() {
                srt_idx = Some(i);
            }
        } else if (name.ends_with(".ass") || name.ends_with(".ssa")) && ass_idx.is_none() {
            ass_idx = Some(i);
        }
    }
    let idx = srt_idx.or(ass_idx).ok_or("no subtitle entry in archive")?;
    let mut entry = zip.by_index(idx).map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    std::io::Read::read_to_end(&mut entry, &mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Decode subtitle `bytes` to a UTF-8 `String`. A UTF-8/UTF-16 BOM authoritatively identifies the
/// encoding (trusted over the heuristic); otherwise chardetng guesses the legacy encoding and
/// encoding_rs decodes it. `Encoding::decode` strips a leading BOM itself; the trailing
/// `strip_prefix` removes any residual U+FEFF so it can never leak into the first cue.
#[cfg(not(target_os = "android"))]
fn normalize_subtitle_charset(bytes: &[u8]) -> String {
    let text = if let Some((enc, _)) = encoding_rs::Encoding::for_bom(bytes) {
        enc.decode(bytes).0.into_owned()
    } else {
        let mut det = chardetng::EncodingDetector::new();
        det.feed(bytes, true);
        det.guess(None, true).decode(bytes).0.into_owned()
    };
    match text.strip_prefix('\u{feff}') {
        Some(stripped) => stripped.to_string(),
        None => text,
    }
}

/// Write `bytes` to `out` atomically (temp file + rename) so a reader never sees a partial file.
/// Mirrors the scrub-tile writer in `player/mod.rs`, but for the normalized subtitle cache.
#[cfg(not(target_os = "android"))]
fn write_text_atomic(out: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = out.with_extension("part");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, out).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Download a picked subtitle, normalize it to UTF-8, and cache it under `<app-cache>/subs`.
///
/// OpenSubtitles: `POST /api/v1/download {file_id}` (Api-Key + Bearer + User-Agent) yields a
/// temporary `link`; GET that link (no extra headers) for the raw subtitle bytes. SubDL: GET the
/// ZIP `url` (attaching `x-api-key` for paid CDN keys; ignored on the free tier) and take the first
/// `.srt`/`.ass` entry. Bytes are charset-detected, decoded to UTF-8, and written atomically to a
/// blake3-content-named `.srt`. Transport is modelled on `ext_fetch` (pooled client + arbitrary auth
/// headers) but reads `bytes()` — SubDL bodies are binary zips, never text. Returns the cache path.
#[cfg(not(target_os = "android"))]
async fn fetch_normalize_subtitle(
    app: &AppHandle,
    provider: &str,
    url: Option<&str>,
    file_id: Option<i64>,
    api_key: Option<&str>,
    token: Option<&str>,
) -> Result<String, String> {
    let client = http_client();
    let raw: Vec<u8> = match provider {
        "opensubtitles" => {
            let file_id = file_id.ok_or("missing file_id")?;
            let key = api_key.unwrap_or("");
            let bearer = token.unwrap_or("");
            let body = serde_json::json!({ "file_id": file_id }).to_string();
            let dl = client
                .post("https://api.opensubtitles.com/api/v1/download")
                .header("Api-Key", key)
                .header("Authorization", format!("Bearer {bearer}"))
                .header("User-Agent", OPENSUBTITLES_USER_AGENT)
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .body(body)
                .send()
                .await
                .map_err(|_| "download request failed".to_string())?;
            let status = dl.status();
            let text = dl
                .text()
                .await
                .map_err(|_| "download read failed".to_string())?;
            if !status.is_success() {
                // Body surfaced verbatim so the TS classifier can tell quota (401 + quota body) from a bad token.
                return Err(format!("opensubtitles /download {}: {text}", status.as_u16()));
            }
            let meta: serde_json::Value =
                serde_json::from_str(&text).map_err(|_| "bad download json".to_string())?;
            let link = meta
                .get("link")
                .and_then(|v| v.as_str())
                .ok_or("no download link")?;
            let file = client
                .get(link)
                .send()
                .await
                .map_err(|_| "link fetch failed".to_string())?;
            if !file.status().is_success() {
                return Err(format!("opensubtitles link {}", file.status().as_u16()));
            }
            file.bytes()
                .await
                .map_err(|_| "link read failed".to_string())?
                .to_vec()
        }
        "subdl" => {
            let zip_url = url.ok_or("missing zip url")?;
            let mut req = client.get(zip_url);
            if let Some(k) = api_key {
                if !k.is_empty() {
                    req = req.header("x-api-key", k);
                }
            }
            let resp = req
                .send()
                .await
                .map_err(|_| "zip fetch failed".to_string())?;
            if !resp.status().is_success() {
                return Err(format!("subdl zip {}", resp.status().as_u16()));
            }
            let zip_bytes = resp
                .bytes()
                .await
                .map_err(|_| "zip read failed".to_string())?;
            unzip_first_subtitle(&zip_bytes)?
        }
        other => return Err(format!("unknown subtitle provider: {other}")),
    };

    let text = normalize_subtitle_charset(&raw);
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("subs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{}.srt", blake3::hash(&raw).to_hex()));
    write_text_atomic(&dest, text.as_bytes())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Download a picked online subtitle (OpenSubtitles `/download` or a SubDL ZIP), normalize it to
/// UTF-8, and add it to the LIVE mpv core as a selected track. The async byte work runs first, then
/// the sync `sub-add` on the reused core; the frontend re-reads `player_tracks` to reflect the new
/// selected track. Never auto-invoked — only on a manual pick in the subtitle menu.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn player_add_subtitle(
    app: AppHandle,
    provider: String,
    url: Option<String>,
    file_id: Option<i64>,
    lang: String,
    title: String,
    api_key: Option<String>,
    token: Option<String>,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<(), String> {
    let path = fetch_normalize_subtitle(
        &app,
        &provider,
        url.as_deref(),
        file_id,
        api_key.as_deref(),
        token.as_deref(),
    )
    .await?;
    player.add_subtitle(&path, &lang, &title)
}

/// Warm the debrid/CDN edge for a resolved next-episode URL by pulling its first few
/// MB and discarding them, so mpv's first read at the episode cut is a cache hit.
/// Fire-and-forget (returns immediately); NEVER logs the url (debrid secret).
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_prefetch(url: String) -> Result<(), String> {
    if url.trim().is_empty() {
        return Ok(());
    }
    tauri::async_runtime::spawn(async move {
        if let Ok(resp) = http_client().get(&url).header("Range", "bytes=0-6291455").send().await {
            use futures_util::StreamExt;
            let mut stream = resp.bytes_stream();
            let mut pulled: u64 = 0;
            while let Some(Ok(chunk)) = stream.next().await {
                pulled += chunk.len() as u64;
                if pulled >= 6 * 1024 * 1024 {
                    break;
                }
            }
        }
    });
    Ok(())
}

/// Return the audio/subtitle track list as a JSON array so the controls can build
/// the audio + subtitle pickers. Built field-by-field from `track-list/N/*`
/// because mpv's `track-list` is a node property that `get_property::<String>`
/// cannot stringify.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_tracks(player: tauri::State<'_, player::PlayerHandle>) -> Result<String, String> {
    player.tracks()
}

/// Return embedded chapters as JSON (`[{time,title}]`). Used by the seekbar to
/// draw chapter dividers; empty for files without chapters.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_chapters(player: tauri::State<'_, player::PlayerHandle>) -> Result<String, String> {
    player.chapters()
}

/// Make the WebView2 background TRANSPARENT (alpha 0) while keeping the OS window
/// OPAQUE — Stremio's native-layer model. This lets mpv (the child window behind
/// the webview) show through wherever the web content is transparent (player mode),
/// without making the whole window a layered/transparent window (which breaks
/// DirectComposition layering + native fullscreen and causes the "detached" feel).
/// No-op if the WebView2 controller isn't ready / doesn't support it.
#[cfg(windows)]
fn set_webview_transparent(win: &tauri::WebviewWindow) {
    let _ = win.with_webview(|webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Controller2, COREWEBVIEW2_COLOR,
        };
        use windows::core::Interface;
        if let Ok(c2) = webview.controller().cast::<ICoreWebView2Controller2>() {
            unsafe {
                let _ = c2.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR { A: 0, R: 0, G: 0, B: 0 });
            }
        }
    });
}

/// Force the WebView2 to report `prefers-color-scheme: dark` for ALL content, including third-party
/// iframes. The Tauri/wry window-theme path (`.theme(Dark)`) does not reliably reach WebView2's color
/// scheme here, so we set it directly on the profile. This is what the in-player discussion embeds
/// (the discussanime archive + Disqus) key their dark mode off — their dark tokens are gated purely on
/// `@media (prefers-color-scheme: dark)`, not on a theme param. No-op if the runtime is too old for
/// ICoreWebView2_13 (the Profile interface).
// Injected into every frame at document-creation. The cross-origin archive iframe (which the profile
// preference + top-session CDP emulation can't reach) is themed by its OWN CSS off `data-theme` on
// <html>/.dq-archive, so in that frame we set it to "dark": the transparent archive then shows a dark
// body + dark cards. A MutationObserver keeps it dark if the archive's own hydration resets it. Only
// runs in the /embed/discussion frame; every other frame returns immediately.
#[cfg(windows)]
const DARK_FRAME_SCRIPT: &str = "(function(){try{if(location.pathname.indexOf('/embed/discussion')!==0)return;var set=function(){var r=document.documentElement;if(!r)return;if(r.getAttribute('data-theme')!=='dark')r.setAttribute('data-theme','dark');var a=document.getElementsByClassName('dq-archive');for(var i=0;i<a.length;i++){if(a[i].getAttribute('data-theme')!=='dark')a[i].setAttribute('data-theme','dark');}};set();new MutationObserver(set).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['data-theme']});document.addEventListener('DOMContentLoaded',set);}catch(e){}})();";

#[cfg(windows)]
static DARK_SCRIPT_ADDED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
fn set_webview_dark(win: &tauri::WebviewWindow) {
    use std::sync::atomic::Ordering;
    let r = win.with_webview(|webview| {
        use webview2_com::AddScriptToExecuteOnDocumentCreatedCompletedHandler;
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_13, COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK,
        };
        use windows::core::{Interface, HSTRING, PCWSTR};
        unsafe {
            let core = match webview.controller().CoreWebView2() {
                Ok(c) => c,
                Err(e) => { eprintln!("[dark] CoreWebView2() failed: {e:?}"); return; }
            };
            // Top-document preference (harmless; the injected script handles the cross-origin iframe).
            if let Ok(profile) = core.cast::<ICoreWebView2_13>().and_then(|w| w.Profile()) {
                let _ = profile.SetPreferredColorScheme(COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK);
            }
            // Add the per-frame dark-forcing script ONCE (it persists + applies to future documents,
            // including the archive iframe opened later).
            if !DARK_SCRIPT_ADDED.swap(true, Ordering::SeqCst) {
                let js = HSTRING::from(DARK_FRAME_SCRIPT);
                let handler = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(|hr, _id| {
                    eprintln!("[dark] AddScriptToExecuteOnDocumentCreated → {hr:?}");
                    Ok(())
                }));
                if let Err(e) = core.AddScriptToExecuteOnDocumentCreated(PCWSTR(js.as_ptr()), &handler) {
                    DARK_SCRIPT_ADDED.store(false, Ordering::SeqCst);
                    eprintln!("[dark] AddScriptToExecuteOnDocumentCreated failed: {e:?}");
                }
            }
        }
    });
    if let Err(e) = r { eprintln!("[dark] with_webview failed: {e:?}"); }
}

/// Left inset (physical px) for the mpv child — the sidebar-rail width while
/// playing windowed, so the video sits to the RIGHT of the black sidebar
/// instead of rendering behind it. 0 in fullscreen / browse. Set from the
/// frontend via `player_set_inset`; read by `resize_mpv_child` (which also runs
/// from the resize event hook, hence a global rather than managed State).
#[cfg(windows)]
static MPV_INSET_LEFT: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

/// Top inset (physical px) for the mpv child — the titlebar height while playing
/// windowed, so the video sits BELOW the titlebar (in the true player area) rather
/// than rendering up under it. 0 in fullscreen / browse.
#[cfg(windows)]
static MPV_INSET_TOP: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

/// Resize mpv's embedded child window (class "mpv") to the main window's client
/// rect, offset by `MPV_INSET_LEFT` on the left. mpv does NOT reliably track the
/// parent size under Tauri/tao, so we do it explicitly on every resize + after
/// fullscreen/inset changes. Without this the video doesn't fill fullscreen and —
/// because the window is transparent — you'd see through it.
/// HWND of the child window mpv is embedded into (0 when not playing). mpv is given
/// THIS as `--wid` — not the main window — because mpv re-fills its wid parent, so
/// handing it the whole window made the video render full-window (contain-fit to the
/// full width, then the opaque sidebar ate the left edge → "zoomed"). The container is
/// sized to exactly the player area, so mpv fills the player area and can't over-render.
#[cfg(windows)]
static MPV_CONTAINER: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

/// The player-area rect in the main window's client coords (physical px): inset from
/// the left (sidebar), 0 in fullscreen.
#[cfg(windows)]
fn player_area(parent: windows::Win32::Foundation::HWND) -> (i32, i32, i32, i32) {
    use std::sync::atomic::Ordering;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;
    unsafe {
        let mut r = RECT::default();
        if GetClientRect(parent, &mut r).is_err() {
            return (0, 0, 0, 0);
        }
        let cw = r.right - r.left;
        let ch = r.bottom - r.top;
        let l = MPV_INSET_LEFT.load(Ordering::Relaxed).clamp(0, cw);
        let t = MPV_INSET_TOP.load(Ordering::Relaxed).clamp(0, ch);
        (l, t, (cw - l).max(1), (ch - t).max(1))
    }
}

/// Create (once) the mpv container child window, sized to the player area. Click-through
/// (`WS_EX_TRANSPARENT`) + disabled so input flows to the WebView2 overlay above it.
#[cfg(windows)]
fn ensure_container(main_raw: isize) -> isize {
    use std::sync::atomic::Ordering;
    use windows::core::w;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, IsWindow, WS_CHILD, WS_CLIPCHILDREN, WS_DISABLED, WS_EX_NOACTIVATE,
        WS_EX_TRANSPARENT, WS_VISIBLE,
    };
    let existing = MPV_CONTAINER.load(Ordering::Relaxed);
    unsafe {
        if existing != 0 && IsWindow(Some(HWND(existing as *mut core::ffi::c_void))).as_bool() {
            return existing;
        }
        let main = HWND(main_raw as *mut core::ffi::c_void);
        let (x, y, w, h) = player_area(main);
        let hwnd = CreateWindowExW(
            WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
            w!("STATIC"),
            w!(""),
            WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_DISABLED,
            x, y, w, h,
            Some(main),
            None,
            None,
            None,
        );
        let raw = hwnd.map(|h| h.0 as isize).unwrap_or(0);
        MPV_CONTAINER.store(raw, Ordering::Relaxed);
        raw
    }
}

/// Fit the mpv CONTAINER to the player area (mpv fills the container), keeping it below
/// the WebView2 sibling, and fill mpv's own child inside it. `parent_raw` is the MAIN
/// window. No-op when not playing (container == 0) or minimized.
#[cfg(windows)]
fn resize_mpv_child(parent_raw: isize) {
    use std::sync::atomic::Ordering;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, IsIconic, MoveWindow, SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE,
    };
    let container_raw = MPV_CONTAINER.load(Ordering::Relaxed);
    if container_raw == 0 {
        return; // not playing
    }
    let parent = HWND(parent_raw as *mut core::ffi::c_void);
    let container = HWND(container_raw as *mut core::ffi::c_void);
    unsafe {
        // Minimizing fires a Resized with a ~0 client rect — sizing to that leaves the
        // swapchain mis-scaled on restore. Skip while minimized / degenerate.
        if IsIconic(parent).as_bool() {
            return;
        }
        let (x, y, w, h) = player_area(parent);
        if w < 16 || h < 16 {
            return;
        }
        // Container → player area (mpv, embedded via --wid=container, fills it). Keep it
        // beneath the WebView2 so the overlay composites on top.
        let _ = MoveWindow(container, x, y, w, h, true);
        let _ = SetWindowPos(container, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        // Ensure mpv's own child fills the container (0,0,w,h) + is click-through.
        let target = (0i32, 0i32, w, h);
        let _ = EnumChildWindows(Some(container), Some(move_mpv_child), LPARAM(&target as *const _ as isize));
    }
}

#[cfg(windows)]
unsafe extern "system" fn move_mpv_child(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::core::BOOL {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetWindowLongPtrW, MoveWindow, PostMessageW, SetWindowLongPtrW, SetWindowPos,
        GWL_EXSTYLE, GWL_STYLE, HWND_BOTTOM, SIZE_RESTORED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        WM_SIZE, WS_DISABLED, WS_EX_TRANSPARENT,
    };
    let (x, y, w, h) = *(lparam.0 as *const (i32, i32, i32, i32));
    let mut buf = [0u16; 32];
    let n = GetClassNameW(hwnd, &mut buf);
    if String::from_utf16_lossy(&buf[..n.max(0) as usize]) == "mpv" {
        // Fit mpv to the (possibly inset) content rect.
        let _ = MoveWindow(hwnd, x, y, w, h, true);
        // Explicitly notify mpv of the new client size so its video output / D3D11
        // swapchain reconfigures to the inset child (an external MoveWindow can leave
        // mpv rendering at the initial full-parent size → the video looks zoomed/cropped).
        // Posted (not sent) so a busy render thread can't deadlock us. lparam = (h<<16)|w.
        let lp = (((h as u32) & 0xFFFF) << 16 | ((w as u32) & 0xFFFF)) as isize;
        let _ = PostMessageW(Some(hwnd), WM_SIZE, WPARAM(SIZE_RESTORED as usize), LPARAM(lp));
        // Turn mpv's child into a pure render surface: WS_EX_TRANSPARENT makes it
        // click-through (hit-testing skips it) and WS_DISABLED disables all input —
        // mpv's own EnableWindow(false) is not enough, so clicks over the video were
        // being stolen from the WebView2 controls (the "lack of control" feel). All
        // input now flows to the HTML overlay.
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT.0 as isize);
        let st = GetWindowLongPtrW(hwnd, GWL_STYLE);
        SetWindowLongPtrW(hwnd, GWL_STYLE, st | WS_DISABLED.0 as isize);
        // Keep it at the bottom of the sibling z-order, beneath the WebView2.
        let _ = SetWindowPos(hwnd, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
    windows::core::BOOL(1)
}

/// Set the video's left (sidebar) + top (titlebar) insets (PHYSICAL px — the frontend
/// already applied devicePixelRatio, so no DPI math here) and refit mpv. Keeps the
/// video inside the player area while windowed (both 0 in fullscreen).
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_set_inset(app: AppHandle, left: i32, top: Option<i32>) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::sync::atomic::Ordering;
        MPV_INSET_LEFT.store(left.max(0), Ordering::Relaxed);
        MPV_INSET_TOP.store(top.unwrap_or(0).max(0), Ordering::Relaxed);
        if let Some(w) = app.get_webview_window("main") {
            resize_mpv_child(w.hwnd().map_err(|e| e.to_string())?.0 as isize);
        }
    }
    #[cfg(not(windows))]
    let _ = (app, left, top);
    Ok(())
}

/// The mpv/libmpv version string for the About page.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn mpv_version() -> String {
    player::libmpv_version()
}

/// Diagnostic: mpv's render-surface + video geometry + the actual mpv child HWND size +
/// the main client rect, so we can tell whether the "zoomed" render is (a) the mpv child
/// not actually inset to the player area, or (b) a panscan/zoom setting. Temporary.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_diag(app: AppHandle, player: tauri::State<'_, player::PlayerHandle>) -> Result<String, String> {
    let props = [
        "osd-width", "osd-height", "dwidth", "dheight",
        "current-window-scale", "display-hidpi-scale",
        "video-out-params/dw", "video-out-params/dh",
        "panscan", "keepaspect", "video-zoom", "video-scale-x", "video-scale-y",
    ];
    let mut m = serde_json::Map::new();
    for p in props {
        m.insert(p.to_string(), serde_json::Value::String(player.get_property(p).unwrap_or_default()));
    }
    #[cfg(windows)]
    {
        use std::sync::atomic::Ordering;
        use windows::Win32::Foundation::{HWND, LPARAM, RECT};
        use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClientRect};
        if let Some(w) = app.get_webview_window("main") {
            if let Ok(h) = w.hwnd() {
                let parent = HWND(h.0 as *mut core::ffi::c_void);
                unsafe {
                    let mut cr = RECT::default();
                    let _ = GetClientRect(parent, &mut cr);
                    m.insert("clientW".into(), serde_json::json!(cr.right - cr.left));
                    m.insert("clientH".into(), serde_json::json!(cr.bottom - cr.top));
                    let mut child: (i32, i32) = (-1, -1);
                    let _ = EnumChildWindows(Some(parent), Some(diag_mpv_child), LPARAM(&mut child as *mut _ as isize));
                    m.insert("mpvChildW".into(), serde_json::json!(child.0));
                    m.insert("mpvChildH".into(), serde_json::json!(child.1));
                }
                m.insert("insetL".into(), serde_json::json!(MPV_INSET_LEFT.load(Ordering::Relaxed)));
                m.insert("insetT".into(), serde_json::json!(MPV_INSET_TOP.load(Ordering::Relaxed)));
            }
        }
    }
    #[cfg(not(windows))]
    let _ = &app;
    serde_json::to_string(&m).map_err(|e| e.to_string())
}

/// Diag helper: write the "mpv"-class child's client size into `(w, h)` at lparam.
#[cfg(windows)]
unsafe extern "system" fn diag_mpv_child(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::core::BOOL {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetClientRect};
    let out = &mut *(lparam.0 as *mut (i32, i32));
    let mut buf = [0u16; 32];
    let n = GetClassNameW(hwnd, &mut buf);
    if String::from_utf16_lossy(&buf[..n.max(0) as usize]) == "mpv" {
        let mut r = RECT::default();
        let _ = GetClientRect(hwnd, &mut r);
        out.0 = r.right - r.left;
        out.1 = r.bottom - r.top;
        return windows::core::BOOL(0);
    }
    windows::core::BOOL(1)
}

/// Save a screenshot of the current frame into the app's Pictures/izumi folder.
/// Returns the directory so the UI can confirm where it landed.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_screenshot(
    app: AppHandle,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<String, String> {
    let dir = app
        .path()
        .picture_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?
        .join("izumi");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dir_s = dir.to_string_lossy().into_owned();
    player.screenshot(&dir_s)?;
    Ok(dir_s)
}

/// Toggle the MAIN window between windowed and fullscreen — the player is embedded
/// here, so this is the video's fullscreen. Returns the NEW state so the UI hides
/// the sidebar/titlebar chrome for edge-to-edge video.
///
/// Uses Tauri/tao's NATIVE `set_fullscreen`. Now that the window is OPAQUE (not a
/// layered transparent window), tao's borderless fullscreen covers the monitor and
/// hides the taskbar correctly, and tao owns the save/restore state — no fragile
/// manual Win32 style/topmost bookkeeping (which corrupted across repeat toggles).
/// `is_fullscreen()` is the single source of truth, so the UI flag can't desync.
///
/// EXCEPT: we un-maximize before entering (and re-maximize on exit) to dodge the
/// maximized→fullscreen offset bug — see [`FsWasMax`].
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_toggle_fullscreen(app: AppHandle, wasmax: tauri::State<'_, FsWasMax>) -> Result<bool, String> {
    let w = app.get_webview_window("main").ok_or("no main window")?;
    let target = !w.is_fullscreen().map_err(|e| e.to_string())?;
    if target {
        let maxed = w.is_maximized().unwrap_or(false);
        *wasmax.0.lock().map_err(|e| e.to_string())? = maxed;
        if maxed {
            let _ = w.unmaximize();
        }
        w.set_fullscreen(true).map_err(|e| e.to_string())?;
    } else {
        w.set_fullscreen(false).map_err(|e| e.to_string())?;
        if *wasmax.0.lock().map_err(|e| e.to_string())? {
            let _ = w.maximize();
        }
    }
    // mpv's child doesn't auto-track the resize under tao — refit it.
    #[cfg(windows)]
    resize_mpv_child(w.hwnd().map_err(|e| e.to_string())?.0 as isize);
    Ok(target)
}

/// Force the main window back to windowed (used when closing the player, so browse
/// never gets stuck fullscreen). No-op if already windowed. Re-maximizes if the
/// window was maximized before it went fullscreen.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_exit_fullscreen(app: AppHandle, wasmax: tauri::State<'_, FsWasMax>) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("no main window")?;
    if w.is_fullscreen().map_err(|e| e.to_string())? {
        w.set_fullscreen(false).map_err(|e| e.to_string())?;
        if *wasmax.0.lock().map_err(|e| e.to_string())? {
            let _ = w.maximize();
        }
        #[cfg(windows)]
        resize_mpv_child(w.hwnd().map_err(|e| e.to_string())?.0 as isize);
    }
    Ok(())
}

/// Run an mpv command on behalf of the on-screen controls (e.g. `cycle pause`,
/// `seek 10`, `set volume 80`). `args` are the mpv command arguments.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_command(
    name: String,
    args: Vec<String>,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<(), String> {
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    player.command(&name, &arg_refs)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_play(
    url: String,
    start_seconds: Option<f64>,
    app: tauri::AppHandle,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<(), String> {
    player.play_own_window(&url, app, start_seconds)
}

/// Play `url` embedded inside the Tauri app window: mpv renders into the host
/// window's native handle, and the (transparent) webview UI composites on top.
///
/// On Windows, `window.hwnd()` yields a `windows::Win32::Foundation::HWND`, a
/// tuple struct wrapping a `*mut c_void`. We read its public `.0` pointer and
/// widen it to `i64` (`isize` first, so the cast is portable), which is exactly
/// the `wid` value mpv expects.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn player_play_embedded(
    url: String,
    start_seconds: Option<f64>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<(), String> {
    // Windows: embed mpv into the host window's HWND. Other platforms aren't ported
    // yet, so wid=0 lets mpv open its own window (mirrors player_play_embedded_pos).
    #[cfg(windows)]
    let wid: i64 = window.hwnd().map_err(|e| e.to_string())?.0 as isize as i64;
    #[cfg(not(windows))]
    let wid: i64 = { let _ = &window; 0 };
    player.play_embedded(&url, wid, app, start_seconds, None, None, None, None)
}

/// Open the provider's auth URL in a dedicated in-app webview window, then poll
/// that window's URL until it reaches `redirect_prefix`. Returns the full
/// redirect URL (query + fragment), so callers can read `?code=` or
/// `#access_token=` themselves. Closes the window when done.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn oauth_capture(
    app: tauri::AppHandle,
    auth_url: String,
    redirect_prefix: String,
) -> Result<String, String> {
    let url = auth_url.parse().map_err(|_| "invalid auth url".to_string())?;
    // reuse/replace any existing "oauth" window
    if let Some(w) = app.get_webview_window("oauth") {
        let _ = w.close();
    }
    let win = WebviewWindowBuilder::new(&app, "oauth", WebviewUrl::External(url))
        .title("Sign in")
        .inner_size(520.0, 760.0)
        .build()
        .map_err(|e| e.to_string())?;
    let mut waited: u64 = 0;
    let result = loop {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        waited += 400;
        match win.url() {
            Ok(u) => {
                let s = u.to_string();
                if s.starts_with(&redirect_prefix) {
                    break Ok(s);
                }
            }
            Err(_) => break Err("Login window was closed.".to_string()),
        }
        if waited > 300_000 {
            break Err("Login timed out.".to_string());
        }
    };
    let _ = win.close();
    result
}

/// Read ALL cookies for `uri` from the WebView2 cookie store (all app webviews share one store) and
/// return them as a `name=value; …` Cookie header. httpOnly + SameSite=lax cookies (discussanime's
/// Better-Auth session token, its `da_session` bridge, …) are invisible to JS and never sent
/// cross-site, so the native CookieManager is the only way to reach them for an authenticated POST.
/// We send the WHOLE jar (not one cookie) so whichever auth cookie the server wants is present. Times
/// out to "" so a missing async callback can't hang the caller. Windows-only; "" elsewhere.
#[cfg(windows)]
async fn read_cookies(window: tauri::WebviewWindow, uri: String) -> String {
    use webview2_com::GetCookiesCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2CookieList, ICoreWebView2_2};
    use windows::core::{Interface, HSTRING, PCWSTR, PWSTR};
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let slot = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let slot_err = slot.clone();
    let wv = window.with_webview(move |pw| unsafe {
        let fail = |s: &std::sync::Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<String>>>>| {
            if let Some(t) = s.lock().unwrap().take() { let _ = t.send(String::new()); }
        };
        let core = match pw.controller().CoreWebView2() { Ok(c) => c, Err(_) => return fail(&slot_err) };
        let cm = match core.cast::<ICoreWebView2_2>().and_then(|w2| w2.CookieManager()) {
            Ok(c) => c,
            Err(_) => return fail(&slot_err),
        };
        let uri_h = HSTRING::from(uri);
        let slot_ok = slot_err.clone();
        let handler = GetCookiesCompletedHandler::create(Box::new(move |_hr, list: Option<ICoreWebView2CookieList>| {
            let mut pairs: Vec<String> = Vec::new();
            if let Some(list) = list {
                let mut count: u32 = 0;
                if list.Count(&mut count).is_ok() {
                    for i in 0..count {
                        if let Ok(cookie) = list.GetValueAtIndex(i) {
                            let mut np = PWSTR::null();
                            let nm = if cookie.Name(&mut np).is_ok() && !np.is_null() {
                                np.to_string().unwrap_or_default()
                            } else { String::new() };
                            let mut vp = PWSTR::null();
                            let vl = if cookie.Value(&mut vp).is_ok() && !vp.is_null() {
                                vp.to_string().unwrap_or_default()
                            } else { String::new() };
                            if !nm.is_empty() { pairs.push(format!("{nm}={vl}")); }
                        }
                    }
                }
            }
            if let Some(t) = slot_ok.lock().unwrap().take() { let _ = t.send(pairs.join("; ")); }
            Ok(())
        }));
        if cm.GetCookies(PCWSTR(uri_h.as_ptr()), &handler).is_err() { fail(&slot_err); }
    });
    if wv.is_err() { return String::new(); }
    match tokio::time::timeout(std::time::Duration::from_secs(6), rx).await { Ok(Ok(v)) => v, _ => String::new() }
}

#[cfg(not(windows))]
async fn read_cookies(_window: tauri::WebviewWindow, _uri: String) -> String {
    String::new()
}

/// True if a cookie header carries a live discussanime session — the Better-Auth `…session_token`
/// (name is `{prefix}.session_token`, possibly `__Secure-`-prefixed). We deliberately do NOT count the
/// `da_session` bridge: on a Better-Auth site it can linger after the real session is gone, and posting
/// it alone 401s — treating it as "signed in" would loop forever instead of prompting a fresh login.
fn has_auth_cookie(header: &str) -> bool {
    header.contains("session_token=") && !header.contains("session_token=;")
}

#[derive(serde::Serialize)]
struct ReactReply {
    ok: bool,
    #[serde(rename = "needsLogin")]
    needs_login: bool,
    counts: Option<serde_json::Value>,
}

// Captured discussanime cookie header (the whole jar). The per-call WebView2 read is async + a little
// racy, so once we get an authed jar we cache it and reuse it — cleared on a 401 (stale) so the next
// reaction re-reads / re-triggers login.
static DA_COOKIES: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Best-effort discussanime cookie header: the cached jar if present, else a live read (cached only
/// when it carries an auth cookie).
async fn da_cookies(window: tauri::WebviewWindow, base: &str) -> String {
    if let Some(v) = DA_COOKIES.lock().unwrap().clone() { return v; }
    let v = read_cookies(window, format!("{base}/")).await;
    if has_auth_cookie(&v) { *DA_COOKIES.lock().unwrap() = Some(v.clone()); }
    v
}

/// Read reaction counts plus the current user's selected key. The browser-side loader can read the
/// public counts itself, but its cross-site request cannot carry discussanime's session cookie, so it
/// always sees `selectedKey: null`. Reading through the native cookie jar restores that user state.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn da_reaction_state(
    window: tauri::WebviewWindow,
    base: String,
    identifier: String,
) -> Result<serde_json::Value, String> {
    let base = base.trim_end_matches('/').to_string();
    let cookie = da_cookies(window, &base).await;
    let url = format!("{base}/api/threads/by-identifier/{identifier}/reaction");
    let mut req = http_client().get(&url);
    if !cookie.is_empty() { req = req.header("cookie", cookie); }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(format!("reaction state HTTP {}", status.as_u16())); }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// Post a discussanime reaction (or clear it with `key=null`) authenticated by the user's `da_session`
/// cookie. Returns `needsLogin` when there's no session (sign in via `da_login`). Goes through the
/// pooled reqwest client with the cookie attached, which sidesteps the browser CORS + SameSite limits
/// that block a POST from the embed.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn da_react(
    window: tauri::WebviewWindow,
    base: String,
    identifier: String,
    key: Option<String>,
) -> Result<ReactReply, String> {
    let base = base.trim_end_matches('/').to_string();
    let cookie = da_cookies(window, &base).await;
    if !has_auth_cookie(&cookie) {
        eprintln!("[da_react] no auth cookie in the jar → needsLogin");
        return Ok(ReactReply { ok: false, needs_login: true, counts: None });
    }
    let url = format!("{base}/api/threads/by-identifier/{identifier}/reaction");
    let body = serde_json::json!({ "reaction": key }).to_string();
    let resp = http_client()
        .post(&url)
        .header("cookie", &cookie)
        .header("content-type", "application/json")
        .header("origin", &base)
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let st = resp.status().as_u16();
    eprintln!("[da_react] POST {url} reaction={key:?} → HTTP {st}");
    if st == 401 {
        *DA_COOKIES.lock().unwrap() = None; // stale session — force a fresh read/login next time
        return Ok(ReactReply { ok: false, needs_login: true, counts: None });
    }
    if !(200..300).contains(&st) {
        return Ok(ReactReply { ok: false, needs_login: false, counts: None });
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    Ok(ReactReply { ok: true, needs_login: false, counts: json.get("counts").cloned() })
}

/// Open discussanime's Disqus-OAuth login in a dedicated window; resolve true once the `da_session`
/// cookie appears (login completed), false on timeout or if the user closes the window.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn da_login(app: tauri::AppHandle, base: String) -> Result<bool, String> {
    let base = base.trim_end_matches('/').to_string();
    // Already signed in (cached, or a persisted cookie from a prior run)? Skip the window entirely —
    // this is what avoids the login window flashing open+closed when a session already exists.
    if DA_COOKIES.lock().unwrap().is_some() { return Ok(true); }
    if let Some(w) = app.get_webview_window("main") {
        let c = read_cookies(w, format!("{base}/")).await;
        if has_auth_cookie(&c) {
            eprintln!("[da_login] existing session cookie found — no window needed");
            *DA_COOKIES.lock().unwrap() = Some(c);
            return Ok(true);
        }
    }
    eprintln!("[da_login] opening discussanime login window");
    let url = format!("{base}/auth/disqus/login").parse().map_err(|_| "bad url".to_string())?;
    if let Some(w) = app.get_webview_window("da-login") { let _ = w.close(); }
    let win = WebviewWindowBuilder::new(&app, "da-login", WebviewUrl::External(url))
        .title("Sign in — Discuss Anime")
        .inner_size(520.0, 760.0)
        .on_new_window(|_u, _f| tauri::webview::NewWindowResponse::Allow) // Disqus OAuth may use a popup
        .build()
        .map_err(|e| e.to_string())?;
    let mut waited: u64 = 0;
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        waited += 800;
        if win.url().is_err() { break; } // user closed the window
        let c = read_cookies(win.clone(), format!("{base}/")).await;
        if has_auth_cookie(&c) {
            eprintln!("[da_login] session cookie appeared — signed in");
            *DA_COOKIES.lock().unwrap() = Some(c);
            let _ = win.close();
            return Ok(true);
        }
        if waited > 300_000 { break; }
    }
    let _ = win.close();
    eprintln!("[da_login] window closed with no session");
    Ok(false)
}

/// Android OAuth login: no second window, so bridge to the extplayer plugin's in-app WebView
/// capture. Same signature + return (the full redirect URL) as the desktop command, so the
/// frontend calls `oauth_capture` identically on both platforms.
#[cfg(target_os = "android")]
#[tauri::command]
async fn oauth_capture(
    app: tauri::AppHandle,
    auth_url: String,
    redirect_prefix: String,
) -> Result<String, String> {
    use tauri_plugin_extplayer::{ExtPlayerExt, OAuthRequest};
    app.extplayer()
        .oauth_capture(OAuthRequest {
            auth_url,
            redirect_prefix,
        })
        .map(|r| r.url)
        .map_err(|e| e.to_string())
}

// ----- Auto-updater -------------------------------------------------------------
// Channel-aware endpoints chosen at RUNTIME so one build serves both channels, both on
// GitHub Releases. STABLE = `releases/latest` (GitHub excludes pre-releases). BETA = a
// rolling `beta` pre-release the CI overwrites each beta build, keeping the URL static.
// EDIT `REPO` to your "owner/name" once the GitHub repo exists.
#[cfg(not(target_os = "android"))]
fn updater_endpoints(channel: &str) -> Vec<url::Url> {
    const REPO: &str = "nickEatsBread/izumi";
    // Failover mirror: tauri's updater tries endpoints in order, so if GitHub is unreachable
    // it falls through to this host (a self-hosted mirror — gitea/another repo — that serves
    // the same signed latest.json per channel and validates the repository/key headers set in
    // `build_updater`). Only updates signed with the release key can install, so a mirror can't
    // inject an unsigned build.
    const FAILOVER: &str = "https://anmw-prod-distnet.quack.si";
    let github = if channel == "beta" {
        format!("https://github.com/{REPO}/releases/download/beta/latest.json")
    } else {
        format!("https://github.com/{REPO}/releases/latest/download/latest.json")
    };
    let failover = format!("{FAILOVER}/{channel}/latest.json");
    [github, failover].iter().filter_map(|s| url::Url::parse(s).ok()).collect()
}

/// True when running inside a Flatpak sandbox (the Steam Deck build). Flatpaks are read-only
/// (`/app`) and updated via Flathub / reinstalling the bundle, so the in-app binary updater
/// can't apply an update there (it fails with EXDEV renaming across the sandbox mounts).
#[cfg(not(target_os = "android"))]
fn running_in_flatpak() -> bool {
    cfg!(target_os = "linux") && std::path::Path::new("/.flatpak-info").exists()
}

/// Exposed to the frontend so it can route updates to the release page inside a Flatpak
/// instead of attempting an in-app install.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn is_flatpak() -> bool {
    running_in_flatpak()
}

// Build a channel-scoped updater: GitHub primary + distnet failover, plus the security
// headers the failover checks — `repository: izumi` and `key: <channel>` (matching the
// requested URL). Headers are sent to every endpoint; GitHub ignores unknown ones.
#[cfg(not(target_os = "android"))]
fn build_updater(app: &tauri::AppHandle, channel: &str) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;
    app.updater_builder()
        .endpoints(updater_endpoints(channel))
        .map_err(|e| e.to_string())?
        .header("repository", "izumi")
        .map_err(|e| e.to_string())?
        .header("key", channel)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[derive(serde::Serialize)]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
    date: Option<String>,
}

/// Check the given channel ("stable"/"beta") for a newer signed build. `None` = up to date.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn updater_check(app: tauri::AppHandle, channel: String) -> Result<Option<UpdateInfo>, String> {
    let channel = if channel == "beta" { "beta" } else { "stable" };
    let updater = build_updater(&app, channel)?;
    match updater.check().await {
        Ok(Some(u)) => Ok(Some(UpdateInfo {
            version: u.version.clone(),
            current: u.current_version.clone(),
            notes: u.body.clone(),
            date: u.date.map(|d| d.to_string()),
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Download + install the newest build on the given channel, then relaunch.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn updater_install(app: tauri::AppHandle, channel: String) -> Result<(), String> {
    // Flatpak (Steam Deck): the sandbox is read-only and the download temp is on a different
    // mount, so tauri's rename-into-place install fails with EXDEV. Never attempt it — the
    // frontend routes the user to the release page to reinstall the .flatpak instead.
    if running_in_flatpak() {
        return Err("Flatpak builds update through the release page, not in-app.".into());
    }
    let channel = if channel == "beta" { "beta" } else { "stable" };
    let updater = build_updater(&app, channel)?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

/// Flatpak (Steam Deck) update check via the XDG `org.freedesktop.portal.Flatpak` UpdateMonitor.
/// The sandbox can't run the binary updater (see `updater_install`), so the Deck instead relies on
/// the portal + a GPG-signed OSTree repo. Returns `Some(commit)` when the portal reports a pending
/// update for this app ref, `None` when up to date (or off Flatpak / off Linux).
///
/// Registered for all desktop targets (like the sibling Linux commands) but only does real work on
/// Linux; the frontend never reaches it off a Flatpak because `is_flatpak` gates the flatpak path.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn flatpak_update_check() -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    {
        if !running_in_flatpak() {
            return Ok(None);
        }
        use ashpd::flatpak::Flatpak;
        use futures_util::StreamExt;
        let proxy = Flatpak::new().await.map_err(|e| e.to_string())?;
        let monitor = proxy
            .create_update_monitor(Default::default())
            .await
            .map_err(|e| e.to_string())?;
        // The portal emits `UpdateAvailable` asynchronously once it has polled the remote — there
        // is no synchronous "check now" call. Await a single signal with a short timeout and treat
        // "nothing yet" as up to date, so the command always returns promptly.
        let mut updates = monitor
            .receive_update_available()
            .await
            .map_err(|e| e.to_string())?;
        let available = match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            updates.next(),
        )
        .await
        {
            // `remote_commit` is the OSTree commit that WOULD be installed (the actual update);
            // `running_commit` is what we're on now. We want the former.
            Ok(Some(info)) => Some(info.remote_commit().to_string()),
            _ => None,
        };
        let _ = monitor.close().await;
        return Ok(available);
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(None)
    }
}

/// Flatpak (Steam Deck) update install via the portal UpdateMonitor. Asks the portal to fetch +
/// stage the new deploy; the portal applies it atomically and it takes effect on the NEXT launch
/// (we never self-relaunch under gamescope — the toast tells the user to quit + relaunch from
/// Steam). Streams the portal's `Progress` to the webview as `flatpak-update-progress` (0..100) so
/// the toast can show a percentage. Errors (incl. a portal `Failed` status) propagate to the UI.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn flatpak_update_install(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if !running_in_flatpak() {
            return Err("not a flatpak build".into());
        }
        use ashpd::flatpak::update_monitor::UpdateStatus;
        use ashpd::flatpak::Flatpak;
        use futures_util::StreamExt;
        let proxy = Flatpak::new().await.map_err(|e| e.to_string())?;
        let monitor = proxy
            .create_update_monitor(Default::default())
            .await
            .map_err(|e| e.to_string())?;
        // Subscribe to `Progress` BEFORE asking for the update so no early signal is missed.
        let mut progress = monitor
            .receive_progress()
            .await
            .map_err(|e| e.to_string())?;
        // No parent window (Game mode has none) and default options.
        monitor
            .update(None, Default::default())
            .await
            .map_err(|e| e.to_string())?;
        // Forward the portal's progress to the toast and stop on a terminal status.
        while let Some(p) = progress.next().await {
            if let Some(pct) = p.progress() {
                let _ = app.emit("flatpak-update-progress", pct);
            }
            match p.status() {
                Some(UpdateStatus::Done) | Some(UpdateStatus::Empty) => break,
                Some(UpdateStatus::Failed) => {
                    let _ = monitor.close().await;
                    return Err(p
                        .error_message()
                        .unwrap_or("flatpak update failed")
                        .to_string());
                }
                _ => {}
            }
        }
        let _ = app.emit("flatpak-update-progress", 100u32);
        let _ = monitor.close().await;
        return Ok(());
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Err("not a flatpak build".into())
    }
}

/// Turn OFF WebKitGTK's damage-propagation feature flags (`PropagateDamagingInformation`,
/// `UnifyDamagedRegions`) — enabled by DEFAULT in WebKitGTK 2.50 (which the Deck's GNOME-49
/// runtime now ships: libwebkit2gtk-4.1.so.0.21.8). They pass only CHANGED rectangles to the
/// system compositor, so on our TRANSPARENT web view a moving element's VACATED region is
/// never recomposited — the scrub-tooltip ghost trail + lingering menus that only a window
/// resize clears (Tauri #12800 / WebKitGTK transparent-view class of bug). With them off, the
/// whole frame is composited every time. There is no env var for this; we toggle the runtime
/// feature via the WebKitFeature C API, which our pinned webkit2gtk crate doesn't expose → FFI.
#[cfg(target_os = "linux")]
unsafe fn disable_webkit_damage(settings: *mut std::ffi::c_void) {
    use std::ffi::CStr;
    use std::os::raw::{c_char, c_int, c_void};
    extern "C" {
        fn webkit_settings_get_all_features() -> *mut c_void;
        fn webkit_feature_list_get_length(list: *mut c_void) -> usize;
        fn webkit_feature_list_get(list: *mut c_void, index: usize) -> *mut c_void;
        fn webkit_feature_get_identifier(feature: *mut c_void) -> *const c_char;
        fn webkit_settings_set_feature_enabled(
            settings: *mut c_void,
            feature: *mut c_void,
            enabled: c_int,
        );
        fn webkit_feature_list_unref(list: *mut c_void);
    }
    let list = webkit_settings_get_all_features();
    if list.is_null() {
        return;
    }
    let n = webkit_feature_list_get_length(list);
    for i in 0..n {
        let f = webkit_feature_list_get(list, i);
        if f.is_null() {
            continue;
        }
        let idp = webkit_feature_get_identifier(f);
        if idp.is_null() {
            continue;
        }
        let id = CStr::from_ptr(idp).to_string_lossy();
        if id == "PropagateDamagingInformation" || id == "UnifyDamagedRegions" {
            webkit_settings_set_feature_enabled(settings, f, 0);
        }
    }
    webkit_feature_list_unref(list);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Linux: the embedded player composites mpv (a wl_subsurface) BELOW the webview,
    // needing a native Wayland session — so we do NOT force GDK_BACKEND=x11 (Desktop mode
    // / KWin gives us Wayland). We DELIBERATELY do NOT set WEBKIT_DISABLE_DMABUF_RENDERER
    // or WEBKIT_DISABLE_COMPOSITING_MODE:
    //   - WEBKIT_DISABLE_COMPOSITING_MODE turns OFF accelerated compositing, which defeats
    //     the CSS layer promotion (`will-change: transform`) that keeps the MOVING scrub
    //     tooltip from leaving a ghost trail — the promoted layer must be a real compositor
    //     layer for moving it to recomposite-and-clear the old position.
    //   - WEBKIT_DISABLE_DMABUF_RENDERER forces a non-native software surface; on the Deck's
    //     AMD/Wayland stack the native DMABUF accelerated path is the RELIABLE one, and
    //     disabling it breaks the transparent overlay. The AppImage-era white-screen these
    //     once guarded against was a bundled-mesa clash; the Flatpak uses the runtime's
    //     matched mesa (+ --device=dri), so it doesn't recur.
    //
    // Steam Deck GAME MODE (gamescope): do NOT force the app onto gamescope's native Wayland
    // socket. Although gamescope exposes wayland + layer-shell, its window management is
    // XWayland-centric: a native-Wayland GTK/webkit TOPLEVEL is never presented (no seat —
    // `gdk_seat_get_keyboard` assertion — and no visible window; the session even tore down).
    // So the app stays an XWayland X11 client (visible), and the controls-over-video overlay
    // is solved a different way (self-composite), not by routing through gamescope's compositor.
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_extplayer::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(download::Downloads::default())
        .manage(direct_torrent::DirectTorrentState::default())
        .manage(sync::SyncState::default())
        .manage(watch_room::WatchRoomState::default())
        .manage(TacVerificationConfig::default())
        .manage(FsWasMax::default())
        .setup(|app| {
            // Restore iroh only for devices that already opted into a sync group. Fresh
            // installs remain fully offline until the user enables Device Sync explicitly.
            let sync_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                sync::initialize_if_configured(sync_app).await
            });

            // Create the desktop main window HERE (not in tauri.conf.json) so we can attach an
            // on_new_window handler. Tauri denies `window.open` by default, which silently blocks the
            // discussion embeds' popups — notably Disqus's OAuth login. Returning `Allow` lets the
            // webview open the popup in-app in the SAME environment (shared cookies/session, opener
            // preserved), so Disqus's login flow + its postMessage-back handshake work. Cookie-sharing
            // via a separate top-level window can't work here (third-party iframe cookies are
            // partitioned from a first-party login), so the popup is the only correct path.
            // Android is single-activity + doesn't support on_new_window, so it keeps its
            // config-defined window (tauri.android.conf.json).
            #[cfg(not(target_os = "android"))]
            {
                use tauri::webview::NewWindowResponse;
                use tauri_plugin_opener::OpenerExt;
                let external_opener = app.handle().clone();
                let popup_app = app.handle().clone();
                let gamescope = std::env::var_os("GAMESCOPE_WAYLAND_DISPLAY").is_some();
                WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .title("izumi")
                    .inner_size(1280.0, 800.0)
                    .decorations(false)
                    .background_color(tauri::window::Color(10, 10, 11, 255))
                    // A native webview begins with an opaque white surface. Keep the window hidden
                    // until the app document finishes its first load so that surface can never be
                    // presented between the dark native window and the dark HTML paint.
                    .visible(false)
                    // Force the webview to report prefers-color-scheme: dark. The app itself is dark via
                    // CSS classes (darkMode:'class', no prefers-color-scheme queries), so this doesn't
                    // change our UI — but the discussion embeds (discussanime archive, Disqus) keep
                    // their "canvas" on the system color scheme, which was light in the webview and left
                    // the forum embed light. Dark here makes those embeds' canvas dark too.
                    .theme(Some(tauri::Theme::Dark))
                    // Re-assert dark prefers-color-scheme on every page load too. The setup-time
                    // set_webview_dark call can no-op if CoreWebView2 isn't fully initialized yet;
                    // on_page_load runs after the document loads, when the profile is guaranteed ready.
                    .on_page_load(|win, payload| {
                        #[cfg(windows)]
                        set_webview_dark(&win);
                        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                            let _ = win.show();
                        }
                    })
                    .on_new_window(move |url, features| {
                        // Only Disqus authentication needs an in-webview popup so its opener and
                        // partitioned session survive. Ordinary embed links (Community Rules, help,
                        // profiles, etc.) belong in the system browser; WebKitGTK otherwise creates
                        // an unusably tiny default child window in the docked player.
                        let host = url.host_str().unwrap_or_default();
                        let path = url.path().to_ascii_lowercase();
                        let is_disqus = host == "disqus.com" || host.ends_with(".disqus.com");
                        let is_auth = path.contains("login") || path.contains("oauth");
                        let is_tac_verify = gamescope
                            && host == "theanimecommunity.com"
                            && path.starts_with("/embed-widget");

                        if gamescope && ((is_disqus && is_auth) || is_tac_verify) {
                            // `Allow` delegates popup geometry to the remote page. Under Gamescope
                            // that produced a tiny centered surface which clipped Disqus's fields.
                            // Create the related WebKit view ourselves: `window_features` preserves
                            // the opener, cookie partition and WebKit context, while our geometry
                            // makes the surface usable on the 1280x800 Deck display.
                            let id = DISCUSSION_POPUP_ID.fetch_add(
                                1,
                                std::sync::atomic::Ordering::Relaxed,
                            );
                            let label = format!("discussion-popup-{id}");
                            let title = if is_tac_verify {
                                "Anime Community verification"
                            } else {
                                "Disqus sign in"
                            };
                            let mut popup = WebviewWindowBuilder::new(
                                &popup_app,
                                &label,
                                WebviewUrl::External("about:blank".parse().unwrap()),
                            )
                            .window_features(features)
                            .title(title)
                            .inner_size(1200.0, 760.0)
                            .min_inner_size(900.0, 650.0)
                            .center()
                            .maximized(true)
                            // Gamescope handles a genuinely fullscreen child reliably. A merely
                            // maximized secondary GTK window can be treated like a tiny dialog by
                            // the compositor and by Steam's floating-keyboard targeting.
                            .fullscreen(true)
                            .decorations(false)
                            .focused(true)
                            .initialization_script(
                                "document.addEventListener('keydown',function(e){if(e.key==='Escape')window.close()});",
                            );
                            if is_disqus && is_auth {
                                // Preserve Disqus's related WebKit view (opener + partitioned cookies),
                                // but do not present it until the Deck keyboard warning is accepted.
                                popup = popup.visible(false).focused(false);
                                // The popup is a remote Disqus document, so izumi's Svelte focus
                                // handler is not present. Ask the narrowly-scoped Steam OSK command
                                // directly whenever one of Disqus's login fields gains focus.
                                popup = popup.initialization_script(
                                    r#"(function(){
                                    function nativeInvoke(){return window.__TAURI__&&window.__TAURI__.core&&window.__TAURI__.core.invoke}
                                    function complete(){var invoke=nativeInvoke();if(invoke)invoke('discussion_popup_complete').catch(function(){window.close()});else window.close()}
                                    var submittedKey='izumi-disqus-login-submitted';
                                    function markAttempted(){try{sessionStorage.setItem(submittedKey,'1')}catch(_error){}}
                                    function addCloseButton(){
                                        if(!document.body||document.getElementById('izumi-disqus-close'))return;
                                        var button=document.createElement('button');
                                        button.id='izumi-disqus-close';
                                        button.type='button';
                                        button.textContent='Close';
                                        button.setAttribute('aria-label','Close Disqus sign in');
                                        button.style.cssText='position:fixed;z-index:2147483647;top:14px;right:16px;min-width:88px;height:42px;padding:0 18px;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:#18181b;color:#fff;font:600 15px system-ui;box-shadow:0 4px 18px rgba(0,0,0,.45);cursor:pointer';
                                        button.addEventListener('click',complete);
                                        document.body.appendChild(button);
                                    }
                                    document.addEventListener('submit',function(e){
                                        try{if(e.target&&e.target.querySelector&&e.target.querySelector('input[type="password"]'))markAttempted()}catch(_error){}
                                    },true);
                                    document.addEventListener('input',function(e){
                                        var el=e.target;if(el&&el.matches&&el.matches('input[type="password"]')&&el.value)markAttempted();
                                    },true);
                                    document.addEventListener('click',function(e){
                                        var el=e.target&&e.target.closest&&e.target.closest('a,button');
                                        if(!el)return;
                                        var label=((el.innerText||'')+' '+(el.getAttribute('aria-label')||'')).trim().toLowerCase();
                                        if(/^(cancel|back to comments|close)(\s|$)/.test(label)){e.preventDefault();complete();return;}
                                        if(el.closest('form')&&el.closest('form').querySelector('input[type="password"]'))markAttempted();
                                    },true);
                                    function maybeComplete(){
                                        var submitted=false;
                                        try{submitted=sessionStorage.getItem(submittedKey)==='1'}catch(_error){}
                                        var path=location.pathname.toLowerCase().replace(/\/+$/,'');
                                        var documented=path==='/next/login-success'||path.indexOf('/embed/comments')===0;
                                        var password=document.querySelector('input[type="password"]');
                                        var blank=!!document.body&&!password&&!document.body.innerText.trim();
                                        var leftLogin=submitted&&!password&&path.indexOf('login')<0&&path.indexOf('oauth')<0;
                                        if(documented||(submitted&&(blank||leftLogin)))setTimeout(complete,500);
                                    }
                                    document.addEventListener('DOMContentLoaded',function(){
                                        addCloseButton();
                                        maybeComplete();
                                        if(document.body)new MutationObserver(function(){addCloseButton();maybeComplete()}).observe(document.body,{childList:true,subtree:true});
                                    });
                                    document.addEventListener('focusin',function(e){
                                        var el=e.target;
                                        if(!el||!(/^(INPUT|TEXTAREA)$/.test(el.tagName)))return;
                                        var type=(el.type||'text').toLowerCase();
                                        if(['checkbox','radio','range','button','submit','color'].indexOf(type)>=0)return;
                                        var r=el.getBoundingClientRect(),d=window.devicePixelRatio||1;
                                        var mode=el.tagName==='TEXTAREA'?1:type==='email'?2:(type==='number'||el.inputMode==='numeric'||el.inputMode==='tel')?3:0;
                                        var invoke=nativeInvoke();
                                        if(invoke)invoke('steam_show_osk',{x:Math.round(r.left*d),y:Math.round(r.top*d),w:Math.round(r.width*d),h:Math.round(r.height*d),mode:mode}).catch(function(){});
                                    },true);
                                    })();"#,
                                );

                                // Disqus documents this as the successful native-webview login
                                // destination. Their page intentionally has no redirect, which is
                                // the blank white surface the user otherwise has to switch away from.
                                let login_app = popup_app.clone();
                                popup = popup.on_page_load(move |window, payload| {
                                    if !matches!(
                                        payload.event(),
                                        tauri::webview::PageLoadEvent::Finished
                                    ) {
                                        return;
                                    }
                                    let url = payload.url();
                                    let is_top_level = window
                                        .url()
                                        .map(|top| top.as_str() == url.as_str())
                                        .unwrap_or(false);
                                    if is_top_level {
                                        discussion_log(&format!(
                                            "discussion-popup: disqus load {}://{}{}",
                                            url.scheme(),
                                            url.host_str().unwrap_or_default(),
                                            url.path()
                                        ));
                                    }
                                    let normalized_path = url.path().trim_end_matches('/');
                                    let success = url
                                        .host_str()
                                        .is_some_and(|host| {
                                            host == "disqus.com" || host.ends_with(".disqus.com")
                                        })
                                        && (normalized_path == "/next/login-success"
                                            || url.path().starts_with("/embed/comments"));
                                    if is_top_level && success {
                                        if let Err(error) =
                                            finish_discussion_popup(&window, &login_app)
                                        {
                                            discussion_log(&format!(
                                                "discussion-popup: login completion failed: {error}"
                                            ));
                                        }
                                    }
                                });
                            }
                            if is_tac_verify {
                                // The top-level view can complete Cloudflare's first-party challenge.
                                // Read the config prepared by the opener from native one-shot state;
                                // unlike a URL fragment this remains available after every challenge
                                // redirect. Then perform TAC's official ready/init handshake unchanged.
                                let config = popup_app
                                    .state::<TacVerificationConfig>()
                                    .0
                                    .lock()
                                    .ok()
                                    .and_then(|mut pending| pending.take());
                                let config_json = serde_json::to_string(&config)
                                    .unwrap_or_else(|_| "null".into());
                                popup = popup.initialization_script(&format!(
                                    r#"(function(){{
                                    var config={config_json};
                                    window.addEventListener('message',function(e){{
                                        if(e.origin!=='https://theanimecommunity.com'||!e.data||e.data.type!=='anime-community:ready')return;
                                        try{{
                                            if(!config||(!config.MAL_ID&&!config.AniList_ID))return;
                                            window.postMessage({{type:'anime-community:init',config:config}},'https://theanimecommunity.com');
                                            if(window.opener)window.opener.postMessage({{type:'izumi-tac-verified'}},'*');
                                            setTimeout(function(){{window.close()}},500);
                                        }}catch(_error){{}}
                                    }});
                                    }})();"#,
                                ));
                            }
                            match popup.build() {
                                Ok(window) => {
                                    #[cfg(target_os = "linux")]
                                    if gamescope {
                                        let popup_window = window.clone();
                                        let event_app = popup_app.clone();
                                        window.on_window_event(move |event| match event {
                                            tauri::WindowEvent::Focused(true) => {
                                                if let Err(error) = player::linux_x11::enable_native_touch(&popup_window) {
                                                    player::linux_embed::elog(&format!(
                                                        "discussion-popup: focus touch restore failed: {error}"
                                                    ));
                                                }
                                            }
                                            tauri::WindowEvent::Destroyed => {
                                                if let Some(main) = event_app.get_webview_window("main") {
                                                    let _ = main.set_focus();
                                                    if let Err(error) = player::linux_x11::enable_native_touch(&main) {
                                                        player::linux_embed::elog(&format!(
                                                            "discussion-popup: close touch restore failed: {error}"
                                                        ));
                                                    }
                                                }
                                            }
                                            _ => {}
                                        });
                                    }
                                    if gamescope && is_disqus && is_auth {
                                        // The cross-origin iframe cannot notify Svelte before calling
                                        // window.open. Tell the main view now, while this related popup
                                        // remains hidden; it reveals the exact popup after acknowledgement.
                                        let emitted = popup_app
                                            .get_webview_window("main")
                                            .is_some_and(|main| {
                                                main.emit(
                                                    "deck-keyboard-warning",
                                                    serde_json::json!({
                                                        "label": label,
                                                        "service": "Disqus",
                                                    }),
                                                )
                                                .is_ok()
                                            });
                                        if !emitted {
                                            // Never strand a login window if the main view is unavailable.
                                            let _ = window.show();
                                            let _ = window.set_focus();
                                        }
                                    }
                                    NewWindowResponse::Create { window }
                                }
                                Err(error) => {
                                    eprintln!("[discussion-popup] create failed: {error}");
                                    NewWindowResponse::Deny
                                }
                            }
                        } else if is_disqus && is_auth {
                            // Desktop WebView2/WebKit popup sizing is usable already.
                            NewWindowResponse::Allow
                        } else {
                            let _ = external_opener.opener().open_url(url.to_string(), None::<String>);
                            NewWindowResponse::Deny
                        }
                    })
                    .build()?;
            }

            // Keep mpv's embedded child sized to the window on every resize (mpv
            // doesn't auto-track the parent under tao). Covers maximize/restore/drag;
            // fullscreen toggles refit directly.
            #[cfg(windows)]
            if let Some(win) = app.get_webview_window("main") {
                // Opaque window, transparent webview background (Stremio model).
                set_webview_transparent(&win);
                // Force prefers-color-scheme: dark on the WebView2 (incl. iframes) — the discussion
                // embeds key their dark mode off it. .theme(Dark) above doesn't reliably reach it.
                set_webview_dark(&win);
                if let Ok(h) = win.hwnd() {
                    let raw = h.0 as isize;
                    // Create the mpv container child window HERE (main/UI thread) — NOT
                    // in the async `player_embed` command, where a window with no message
                    // pump makes the app "not responding". Reused for the app's lifetime.
                    let _ = ensure_container(raw);
                    win.on_window_event(move |event| {
                        if matches!(event, tauri::WindowEvent::Resized(_)) {
                            resize_mpv_child(raw);
                        }
                    });
                }
            }
            // Linux: make the WebView background fully TRANSPARENT so the mpv video
            // subsurface below shows through the player's transparent areas. Accelerated
            // compositing is left ON (default) — it's REQUIRED for the frontend's
            // compositing-layer promotion (`will-change: transform` on the moving scrub
            // tooltip + popup menus) to actually recomposite-and-clear old positions;
            // forcing software rendering (policy=Never) makes that promotion a no-op and the
            // ghost trail returns. The menus must NOT use backdrop-filter (it samples a
            // backdrop the webview can't see — the video is a separate subsurface).
            #[cfg(target_os = "linux")]
            if let Some(win) = app.get_webview_window("main") {
                // Steam overrides the session's native touch default with left-click emulation for
                // this XWayland app. Change Gamescope back to passthrough after our window exists so
                // WebKitGTK receives real XI2 touch sequences and owns drag + kinetic scrolling,
                // including inside cross-origin discussion frames.
                if let Err(e) = player::linux_x11::enable_native_touch(&win) {
                    player::linux_embed::elog(&format!("x11: native touch passthrough failed: {e}"));
                }
                let touch_win = win.clone();
                win.on_window_event(move |event| {
                    // Steam may rewrite its root property during an app-focus transition. Reassert
                    // passthrough after GTK receives focus; this remains compositor-level native
                    // input routing and does not synthesize or reinterpret any gestures.
                    if matches!(event, tauri::WindowEvent::Focused(true)) {
                        if let Err(e) = player::linux_x11::enable_native_touch(&touch_win) {
                            player::linux_embed::elog(&format!("x11: focus touch passthrough failed: {e}"));
                        }
                    }
                });
                // The edge restores above (boot, focus, gamepad press, navigation) all lose the
                // property war whenever Steam writes AFTER them with no further edge — Steam owns
                // the mode from its own XWayland root (a different X server; its writes are
                // unobservable from in here), and gamescope keeps one global last-writer-wins
                // value. That's the touch-dead-at-launch-until-a-d-pad-press bug and the random
                // mid-session touch deaths. So on top of the edges, re-publish passthrough every
                // 250ms: a same-value XChangeProperty still raises PropertyNotify, which makes
                // gamescope re-read mode 4 from OUR root. One property write + flush on the local
                // socket per tick — negligible.
                if std::env::var_os("GAMESCOPE_WAYLAND_DISPLAY").is_some() {
                    let keepalive_win = win.clone();
                    let mut err_logged = false;
                    glib::timeout_add_local(std::time::Duration::from_millis(250), move || {
                        if let Err(e) = player::linux_x11::keepalive_native_touch(&keepalive_win) {
                            if !err_logged {
                                err_logged = true;
                                player::linux_embed::elog(&format!("x11: touch keepalive failed (logged once): {e}"));
                            }
                        }
                        glib::ControlFlow::Continue
                    });
                }
                let _ = win.with_webview(|pw| {
                    use glib::object::ObjectType;
                    use webkit2gtk::{
                        CookieAcceptPolicy, CookieManagerExt, SettingsExt,
                        WebContextExt, WebViewExt, WebsiteDataManagerExt,
                    };
                    let wv = pw.inner();
                    wv.set_background_color(&gdk::RGBA::new(0.0, 0.0, 0.0, 0.0));
                    if std::env::var_os("GAMESCOPE_WAYLAND_DISPLAY").is_some() {
                        // TAC's Cloudflare clearance and Disqus's login live in third-party
                        // discussion frames. WebKitGTK's tracking policy otherwise withholds those
                        // cookies after the related first-party popup closes, causing TAC to loop
                        // back to a blocked challenge and Disqus to appear signed out again.
                        if let Some(context) = wv.context() {
                            if let Some(cookies) = context.cookie_manager() {
                                cookies.set_accept_policy(CookieAcceptPolicy::Always);
                            }
                        }
                        if let Some(data) = wv.website_data_manager() {
                            data.set_itp_enabled(false);
                        }
                    }
                    // THE root fix for the ghost trails: turn off WebKitGTK 2.50 damage
                    // propagation (see disable_webkit_damage).
                    if let Some(settings) = wv.settings() {
                        // Gamescope passthrough lets WebKit's GTK drag/swipe gestures use this
                        // async path, including velocity-based native kinetic scrolling.
                        settings.set_enable_smooth_scrolling(true);
                        let sptr = settings.as_ptr() as *mut std::ffi::c_void;
                        unsafe { disable_webkit_damage(sptr) };
                    }
                });
                // One-shot compositor capability probe (logs to izumi-embed.log). Decides the
                // Game-mode video-overlay architecture from measured facts — does gamescope's
                // XWayland report an RGBA/composited screen, and does its Wayland socket expose
                // wl_subcompositor. No-op effect on the running player; pure diagnostics.
                player::linux_embed::probe_compositor(&win);
            }
            #[cfg(not(any(windows, target_os = "linux")))]
            let _ = app;
            Ok(())
        });

    // Desktop keeps the full native-player + updater command set. Android registers only the
    // shared HTTP-bridge / DoH / downloads commands — the libmpv player, gamepad, scrub, updater,
    // and multi-window OAuth commands don't exist there (playback is delegated to an external app).
    #[cfg(not(target_os = "android"))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(player::PlayerHandle::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            player_play,
            player_play_embedded,
            player_embed,
            close_player,
            player_is_game_mode,
            player_gm_overlay,
            player_gm_dynamic_overlay,
            gamepad_start,
            gamepad_stop,
            gamepad_trigger_state,
            spawn_external_player,
            player_get_property,
            player_sprite_start,
            player_thumb_tile,
            player_thumb_info,
            clear_video_cache,
            set_webview_zoom,
            restore_native_touch,
            set_webview_accel,
            steam_show_osk,
            discussion_popup_complete,
            resolve_deck_login_popup,
            set_tac_verification_config,
            player_prefetch,
            http_get,
            http_post,
            ext_fetch,
            set_doh,
            set_player_cache,
            set_idle_inhibit,
            write_text_file,
            updater_check,
            updater_install,
            is_flatpak,
            flatpak_update_check,
            flatpak_update_install,
            player_tracks,
            player_chapters,
            player_toggle_fullscreen,
            player_exit_fullscreen,
            player_set_inset,
            player_screenshot,
            player_diag,
            mpv_version,
            player_command,
            player_add_subtitle,
            opensubtitles_login,
            oauth_capture,
            da_reaction_state,
            da_react,
            da_login,
            download::download_start,
            download::download_cancel,
            download::download_delete,
            download::download_dir_default,
            download::reveal_in_folder,
            direct_torrent::torrent_playback_url,
            sync::sync_status,
            sync::sync_relay_config,
            sync::sync_set_relay,
            sync::sync_enable,
            sync::sync_disable,
            sync::sync_create,
            sync::sync_join,
            sync::sync_nearby_list,
            sync::sync_pairing_open,
            sync::sync_pair_nearby,
            sync::sync_pair_respond,
            sync::sync_leave,
            sync::sync_write,
            sync::sync_read,
            watch_room::watch_room_host,
            watch_room::watch_room_join,
            watch_room::watch_room_exchange,
            watch_room::watch_room_leave
        ]);

    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        http_get,
        http_post,
        ext_fetch,
        set_doh,
        write_text_file,
        updater_download_apk,
        oauth_capture,
        download::download_start,
        download::download_cancel,
        download::download_delete,
        download::download_dir_default,
        download::reveal_in_folder,
        direct_torrent::torrent_playback_url,
        sync::sync_status,
        sync::sync_relay_config,
        sync::sync_set_relay,
        sync::sync_enable,
        sync::sync_disable,
        sync::sync_create,
        sync::sync_join,
        sync::sync_nearby_list,
        sync::sync_pairing_open,
        sync::sync_pair_nearby,
        sync::sync_pair_respond,
        sync::sync_leave,
        sync::sync_write,
        sync::sync_read,
        watch_room::watch_room_host,
        watch_room::watch_room_join,
        watch_room::watch_room_exchange,
        watch_room::watch_room_leave
    ]);

    // "Full" Android flavor only: the embedded libmpv player plugin (registers its own
    // plugin:mpv|* commands). Absent in the "lite" build, which delegates to an external player.
    #[cfg(all(target_os = "android", feature = "android-mpv"))]
    let builder = builder.plugin(tauri_plugin_mpv::init());

    // UI-wide haptics on mobile (both Android flavors + iOS). Desktop never registers this — the
    // JS wrapper (src/lib/haptics.ts) also gates on $isAndroid, so nothing calls it off-mobile.
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_haptics::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
#[cfg(not(target_os = "android"))]
mod subtitle_cache_tests {
    use super::*;

    #[test]
    fn atomic_write_roundtrips_and_blake3_is_stable() {
        let bytes = b"1\n00:00:01,000 --> 00:00:02,000\nHi\n";
        let h1 = blake3::hash(bytes).to_hex().to_string();
        let h2 = blake3::hash(bytes).to_hex().to_string();
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);
        let dir = std::env::temp_dir().join("izumi_sub_atomic_test");
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join(format!("{h1}.srt"));
        let _ = std::fs::remove_file(&out);
        write_text_atomic(&out, bytes).unwrap();
        assert_eq!(std::fs::read(&out).unwrap(), bytes);
        let _ = std::fs::remove_file(&out);
    }
}

#[cfg(test)]
#[cfg(not(target_os = "android"))]
mod subtitle_charset_tests {
    use super::*;

    #[test]
    fn strips_utf8_bom() {
        assert_eq!(normalize_subtitle_charset(b"\xEF\xBB\xBFHello"), "Hello");
    }

    #[test]
    fn decodes_utf16le_bom() {
        assert_eq!(normalize_subtitle_charset(b"\xFF\xFEH\x00i\x00"), "Hi");
    }

    #[test]
    fn decodes_utf16be_bom() {
        assert_eq!(normalize_subtitle_charset(b"\xFE\xFF\x00H\x00i"), "Hi");
    }

    #[test]
    fn decodes_windows_1252() {
        let src = "Voilà déjà là où l'été était très agréable à Genève";
        let (bytes, _, _) = encoding_rs::WINDOWS_1252.encode(src);
        assert_eq!(normalize_subtitle_charset(&bytes), src);
    }

    #[test]
    fn decodes_shift_jis() {
        let src = "これは日本語の字幕ファイルです。文字化けせずに正しく表示されることを確認するテストです。";
        let (bytes, _, _) = encoding_rs::SHIFT_JIS.encode(src);
        assert_eq!(normalize_subtitle_charset(&bytes), src);
    }
}

#[cfg(test)]
#[cfg(not(target_os = "android"))]
mod subtitle_zip_tests {
    use super::*;

    fn make_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            for (name, data) in entries {
                w.start_file(*name, opts).unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        }
        buf
    }

    #[test]
    fn picks_first_srt() {
        let zip = make_zip(&[
            ("readme.txt", b"hi"),
            ("Subs/movie.ass", b"[Script Info]"),
            ("Subs/movie.srt", b"1\n00:00:01,000 --> 00:00:02,000\nHello\n"),
        ]);
        assert_eq!(
            unzip_first_subtitle(&zip).unwrap(),
            b"1\n00:00:01,000 --> 00:00:02,000\nHello\n"
        );
    }

    #[test]
    fn falls_back_to_ass() {
        let zip = make_zip(&[("a.txt", b"x"), ("b.ass", b"[Events]")]);
        assert_eq!(unzip_first_subtitle(&zip).unwrap(), b"[Events]");
    }

    #[test]
    fn errors_when_no_subtitle() {
        let zip = make_zip(&[("a.txt", b"x"), ("b.nfo", b"y")]);
        assert!(unzip_first_subtitle(&zip).is_err());
    }
}

#[cfg(test)]
#[cfg(not(target_os = "android"))]
mod subtitle_login_tests {
    use super::*;

    #[test]
    fn parses_vip_login() {
        let body = r#"{"token":"eyJTEST","status":200,"base_url":"vip-api.opensubtitles.com","user":{"allowed_downloads":1000,"level":"VIP member","vip":true,"user_id":42}}"#;
        let s = parse_opensubtitles_login(body, 1_000_000).unwrap();
        assert_eq!(s.token, "eyJTEST");
        assert_eq!(s.base_url, "https://vip-api.opensubtitles.com/api/v1");
        assert_eq!(s.allowed_downloads, 1000);
        assert_eq!(s.remaining, 1000);
        assert_eq!(s.level, "VIP member");
        assert_eq!(s.expires_at, 1_000_000 + 11 * 60 * 60 * 1000);
    }

    #[test]
    fn parses_free_login() {
        let body = r#"{"token":"free1","user":{"allowed_downloads":20,"level":"Sub leecher"}}"#;
        let s = parse_opensubtitles_login(body, 0).unwrap();
        assert_eq!(s.token, "free1");
        assert_eq!(s.base_url, "");
        assert_eq!(s.allowed_downloads, 20);
        assert_eq!(s.remaining, 20);
    }

    #[test]
    fn rejects_login_without_token() {
        assert!(parse_opensubtitles_login("{}", 0).is_err());
    }
}
