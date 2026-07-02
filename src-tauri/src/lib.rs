// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod player;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
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
            oauth_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
