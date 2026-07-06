// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod doh;
mod download;
mod player;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Remembers whether the main window was maximized before entering fullscreen, so
/// exit can re-maximize it. We must un-maximize BEFORE `set_fullscreen`: tao enters
/// fullscreen from a MAXIMIZED `decorations:false` window with a ~40px offset /
/// overflow (tauri #11788) — windowed→fullscreen is fine, maximized→fullscreen is
/// not (the exact symptom the user hit).
#[derive(Default)]
struct FsWasMax(std::sync::Mutex<bool>);

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
#[tauri::command]
async fn player_embed(
    app: AppHandle,
    url: String,
    start_seconds: Option<f64>,
    alang: Option<String>,
    slang: Option<String>,
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
        player.play_embedded(&url, wid, app.clone(), start_seconds, alang, slang)?;
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
            player.play_embedded_render(&url, app.clone(), start_seconds, alang, slang, &main)?;
        } else {
            // Game mode / gamescope (XWayland X11): no wl_subsurface — embed mpv via `--wid`
            // into a fullscreen X11 CONTAINER window we own (so it can be shown/hidden for the
            // touch-controls swap + made input-transparent). Fullscreen; no windowed layout.
            let size = main.inner_size().map_err(|e| e.to_string())?;
            let xid = player::linux_x11::ensure_container(&main, size.width, size.height)?;
            player.play_embedded(&url, xid, app.clone(), start_seconds, alang, slang)?;
        }
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (&player, &main, &app, &start_seconds, &alang, &slang, &url);
    }
    Ok(())
}

/// Stop playback: drop the mpv core, which destroys mpv's child surface inside the
/// main window so the (opaque again) browse UI shows through. The overlay itself is
/// torn down by the frontend (`playing = false`).
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
#[tauri::command]
fn player_gm_overlay(app: AppHandle, visible: bool) {
    #[cfg(target_os = "linux")]
    {
        if let Some(win) = app.get_webview_window("main") {
            if visible {
                player::linux_overlay::start(app.clone(), win);
            } else {
                player::linux_overlay::stop(app.clone());
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, visible);
    }
}

/// Start/stop the backend gamepad reader (Steam Deck L2/R2 seek). The webview's own Gamepad
/// API doesn't see the Deck controller under gamescope, so we read it via evdev in Rust and
/// emit `gamepad-trigger` events the frontend feeds into the seek logic (see gamepad_linux).
#[tauri::command]
fn gamepad_start(app: AppHandle) {
    #[cfg(target_os = "linux")]
    player::gamepad_linux::start(app);
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

#[tauri::command]
fn gamepad_stop() {
    #[cfg(target_os = "linux")]
    player::gamepad_linux::stop();
}

/// Launch an external video player (the user's chosen executable) with the stream
/// URL as its sole argument — passes exactly the URL and no
/// flags. Used when "external player" is enabled in settings; playback then happens
/// in that app's own window (we get no progress events back).
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

/// The scrub-preview tile for hover `time` (seconds) on stream `key`. Returns
/// `{status: ready|pending|failed|none, dataUrl?, index}` — `ready` carries that ONE
/// small tile JPEG (few KB), `pending` means its frame isn't generated yet (seekbar
/// shows a loading shimmer, never blank).
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

fn build_http_client(doh: Option<String>) -> reqwest::Client {
    let mut b = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .pool_max_idle_per_host(8)
        .tcp_keepalive(std::time::Duration::from_secs(90));
    if let Some(url) = doh {
        b = b.dns_resolver(std::sync::Arc::new(doh::DohResolver::new(url)));
    }
    b.build().unwrap_or_else(|_| reqwest::Client::new())
}

fn http_lock() -> &'static std::sync::RwLock<reqwest::Client> {
    HTTP.get_or_init(|| std::sync::RwLock::new(build_http_client(None)))
}

pub(crate) fn http_client() -> reqwest::Client {
    http_lock().read().unwrap().clone()
}

/// Rebuild the shared HTTP client with DNS-over-HTTPS on or off. Called by the
/// frontend on startup and whenever the Network setting changes. `url` is the DoH
/// JSON endpoint (e.g. https://cloudflare-dns.com/dns-query). Covers every request
/// that goes through the pooled client (addons, AniZip, id-map, Kitsu, downloads,
/// prefetch); AniList/MAL browse fetches and mpv playback keep their own resolvers.
#[tauri::command]
fn set_doh(enabled: bool, url: String) {
    let doh = if enabled && url.trim().starts_with("http") { Some(url.trim().to_string()) } else { None };
    *http_lock().write().unwrap() = build_http_client(doh);
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

/// Warm the debrid/CDN edge for a resolved next-episode URL by pulling its first few
/// MB and discarding them, so mpv's first read at the episode cut is a cache hit.
/// Fire-and-forget (returns immediately); NEVER logs the url (debrid secret).
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
#[tauri::command]
fn player_tracks(player: tauri::State<'_, player::PlayerHandle>) -> Result<String, String> {
    player.tracks()
}

/// Return embedded chapters as JSON (`[{time,title}]`). Used by the seekbar to
/// draw chapter dividers; empty for files without chapters.
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
#[tauri::command]
fn mpv_version() -> String {
    player::libmpv_version()
}

/// Diagnostic: mpv's render-surface + video geometry + the actual mpv child HWND size +
/// the main client rect, so we can tell whether the "zoomed" render is (a) the mpv child
/// not actually inset to the player area, or (b) a panscan/zoom setting. Temporary.
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
#[tauri::command]
fn player_command(
    name: String,
    args: Vec<String>,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<(), String> {
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    player.command(&name, &arg_refs)
}

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
    player.play_embedded(&url, wid, app, start_seconds, None, None)
}

/// Open the provider's auth URL in a dedicated in-app webview window, then poll
/// that window's URL until it reaches `redirect_prefix`. Returns the full
/// redirect URL (query + fragment), so callers can read `?code=` or
/// `#access_token=` themselves. Closes the window when done.
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

// ----- Auto-updater -------------------------------------------------------------
// Channel-aware endpoints chosen at RUNTIME so one build serves both channels, both on
// GitHub Releases. STABLE = `releases/latest` (GitHub excludes pre-releases). BETA = a
// rolling `beta` pre-release the CI overwrites each beta build, keeping the URL static.
// EDIT `REPO` to your "owner/name" once the GitHub repo exists.
fn updater_endpoints(channel: &str) -> Vec<url::Url> {
    const REPO: &str = "nickEatsBread/izumi";
    // Failover mirror: if GitHub is unreachable the updater falls through to this host,
    // which validates the `repository`/`key` headers set in `build_updater`.
    const FAILOVER: &str = "https://anmw-prod-distnet.quack.si";
    let github = if channel == "beta" {
        format!("https://github.com/{REPO}/releases/download/beta/latest.json")
    } else {
        format!("https://github.com/{REPO}/releases/latest/download/latest.json")
    };
    let failover = format!("{FAILOVER}/{channel}/latest.json");
    [github, failover].iter().filter_map(|s| url::Url::parse(s).ok()).collect()
}

// Build a channel-scoped updater: GitHub primary + distnet failover, plus the security
// headers the failover checks — `repository: izumi` and `key: <channel>` (matching the
// requested URL). Headers are sent to every endpoint; GitHub ignores unknown ones.
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

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
    date: Option<String>,
}

/// Check the given channel ("stable"/"beta") for a newer signed build. `None` = up to date.
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
#[tauri::command]
async fn updater_install(app: tauri::AppHandle, channel: String) -> Result<(), String> {
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(player::PlayerHandle::new())
        .manage(download::Downloads::default())
        .manage(FsWasMax::default())
        .setup(|app| {
            // Keep mpv's embedded child sized to the window on every resize (mpv
            // doesn't auto-track the parent under tao). Covers maximize/restore/drag;
            // fullscreen toggles refit directly.
            #[cfg(windows)]
            if let Some(win) = app.get_webview_window("main") {
                // Opaque window, transparent webview background (Stremio model).
                set_webview_transparent(&win);
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
                let _ = win.with_webview(|pw| {
                    use glib::object::ObjectType;
                    use webkit2gtk::WebViewExt;
                    let wv = pw.inner();
                    wv.set_background_color(&gdk::RGBA::new(0.0, 0.0, 0.0, 0.0));
                    // THE root fix for the ghost trails: turn off WebKitGTK 2.50 damage
                    // propagation (see disable_webkit_damage).
                    if let Some(settings) = wv.settings() {
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
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            player_play,
            player_play_embedded,
            player_embed,
            close_player,
            player_is_game_mode,
            player_gm_overlay,
            gamepad_start,
            gamepad_stop,
            spawn_external_player,
            player_get_property,
            player_sprite_start,
            player_thumb_tile,
            player_thumb_info,
            player_prefetch,
            http_get,
            http_post,
            set_doh,
            updater_check,
            updater_install,
            player_tracks,
            player_chapters,
            player_toggle_fullscreen,
            player_exit_fullscreen,
            player_set_inset,
            player_screenshot,
            player_diag,
            mpv_version,
            player_command,
            oauth_capture,
            download::download_start,
            download::download_cancel,
            download::download_delete,
            download::download_dir_default,
            download::reveal_in_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
