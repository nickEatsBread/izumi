// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod player;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn player_play(url: String, player: tauri::State<'_, player::PlayerHandle>) -> Result<(), String> {
    player.play_own_window(&url)
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
    window: tauri::WebviewWindow,
    player: tauri::State<'_, player::PlayerHandle>,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let wid = hwnd.0 as isize as i64;
    player.play_embedded(&url, wid)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}));
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(player::PlayerHandle::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            player_play,
            player_play_embedded
        ])
        .setup(|_app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = _app.deep_link().register_all();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
