// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod player;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Create (once) or fetch the dedicated `"player"` window: transparent,
/// borderless, fullscreen, always-on-top. It loads the `/player` Svelte route,
/// which paints the custom controls over the video that mpv renders into this
/// window's native handle. Reused as-is on subsequent plays (loadfile only).
fn player_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(w) = app.get_webview_window("player") {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, "player", WebviewUrl::App("player".into()))
        .transparent(true)
        .decorations(false)
        .fullscreen(true)
        .always_on_top(true)
        .title("Player")
        .build()
        .map_err(|e| e.to_string())
}

/// Open the transparent player window and embed the stream in it: mpv renders
/// into the player window's native handle (`wid`), the `/player` route composites
/// the controls on top. Emits `now-playing` so the controls can show the title.
///
/// Reuses `PlayerHandle::play_embedded` (Plan 3/4): first call binds mpv to the
/// window and spawns the event loop; later calls just `loadfile` the next stream
/// into the same window (used by next-episode auto-advance).
#[tauri::command]
async fn play_in_player(
    app: AppHandle,
    url: String,
    start_seconds: Option<f64>,
    title: String,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<(), String> {
    let win = player_window(&app)?;
    let _ = win.set_focus();
    // `wid` is the Win32 HWND as an i64 — see `player_play_embedded` for the
    // pointer-widening rationale.
    #[cfg(windows)]
    let wid = {
        let hwnd = win.hwnd().map_err(|e| e.to_string())?;
        hwnd.0 as isize as i64
    };
    #[cfg(not(windows))]
    let wid: i64 = 0;
    player.play_embedded(&url, wid, app.clone(), start_seconds)?;
    let _ = app.emit("now-playing", title);
    Ok(())
}

/// Stop playback (drops the mpv core, releasing the embedded window) and close
/// the player window, returning focus to the opaque browse window.
#[tauri::command]
fn close_player(
    app: AppHandle,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<(), String> {
    player.stop()?;
    if let Some(w) = app.get_webview_window("player") {
        let _ = w.close();
    }
    Ok(())
}

/// Read a string mpv property for the controls (e.g. `track-list`, `pause`).
#[tauri::command]
fn player_get_property(
    name: String,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<String, String> {
    player.get_property(&name)
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
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let wid = hwnd.0 as isize as i64;
    player.play_embedded(&url, wid, app, start_seconds)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(player::PlayerHandle::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            player_play,
            player_play_embedded,
            play_in_player,
            close_player,
            player_get_property,
            player_command,
            oauth_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
