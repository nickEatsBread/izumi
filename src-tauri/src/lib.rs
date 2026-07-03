// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
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
    let wid = {
        let hwnd = main.hwnd().map_err(|e| e.to_string())?;
        hwnd.0 as isize as i64
    };
    #[cfg(not(windows))]
    let wid: i64 = 0;
    player.play_embedded(&url, wid, app.clone(), start_seconds, alang, slang)?;
    #[cfg(windows)]
    {
        // Ensure the webview is transparent (in case the setup-time call raced the
        // webview init), then fit mpv's freshly-created child to the window.
        set_webview_transparent(&main);
        resize_mpv_child(wid as isize);
    }
    Ok(())
}

/// Stop playback: drop the mpv core, which destroys mpv's child surface inside the
/// main window so the (opaque again) browse UI shows through. The overlay itself is
/// torn down by the frontend (`playing = false`).
#[tauri::command]
fn close_player(player: tauri::State<'_, player::PlayerHandle>) -> Result<(), String> {
    player.stop()
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

/// Resize mpv's embedded child window (created by `--wid`, window class "mpv") to
/// fill the main window's client rect. mpv does NOT reliably track the parent size
/// under Tauri/tao (stremio-shell-ng gets this "for free" from mpv on its NWG
/// window; we don't), so we do it explicitly on every resize + after fullscreen
/// toggles. Without this the video stays at its creation size (doesn't fill
/// fullscreen) and — because the window is transparent — you see through it.
#[cfg(windows)]
fn resize_mpv_child(parent_raw: isize) {
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClientRect};
    let parent = HWND(parent_raw as *mut core::ffi::c_void);
    unsafe {
        let mut rect = RECT::default();
        if GetClientRect(parent, &mut rect).is_err() {
            return;
        }
        let size = (rect.right - rect.left, rect.bottom - rect.top);
        let _ = EnumChildWindows(Some(parent), Some(move_mpv_child), LPARAM(&size as *const _ as isize));
    }
}

#[cfg(windows)]
unsafe extern "system" fn move_mpv_child(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::core::BOOL {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetWindowLongPtrW, MoveWindow, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE,
        GWL_STYLE, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_DISABLED,
        WS_EX_TRANSPARENT,
    };
    let (w, h) = *(lparam.0 as *const (i32, i32));
    let mut buf = [0u16; 32];
    let n = GetClassNameW(hwnd, &mut buf);
    if String::from_utf16_lossy(&buf[..n.max(0) as usize]) == "mpv" {
        // Fit mpv to the client area.
        let _ = MoveWindow(hwnd, 0, 0, w, h, true);
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
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let wid = hwnd.0 as isize as i64;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(player::PlayerHandle::new())
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
                    win.on_window_event(move |event| {
                        if matches!(event, tauri::WindowEvent::Resized(_)) {
                            resize_mpv_child(raw);
                        }
                    });
                }
            }
            #[cfg(not(windows))]
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            player_play,
            player_play_embedded,
            player_embed,
            close_player,
            player_get_property,
            player_tracks,
            player_chapters,
            player_toggle_fullscreen,
            player_exit_fullscreen,
            player_command,
            oauth_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
