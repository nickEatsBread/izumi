//! Steam Deck on-screen keyboard via the Steamworks floating gamepad text input.
//!
//! When izumi is added to Steam as a non-Steam game and launched in Game mode, Steam provides the
//! client pipe + app-id env. We dlopen the host's `libsteam_api.so` at RUNTIME (no build-time SDK
//! dependency, no bundled .so) and call the flat C API:
//!   SteamAPI_Init() -> SteamAPI_SteamUtils() -> SteamAPI_ISteamUtils_ShowFloatingGamepadTextInput()
//! The floating keyboard injects OS keystrokes straight into the focused WebKit field (no read-back
//! plumbing). If any step fails (not launched via Steam, sandbox blocks the Steam pipe, old SDK),
//! [`show`] returns false and the frontend falls back to its built-in HTML keyboard.
//!
//! Requires the Flatpak to reach the host Steam pipe + the .so: `--filesystem=~/.steam:ro` (see the
//! manifest). `SteamAPI_RunCallbacks` is pumped on a background thread to keep the pipe alive.
#![cfg(target_os = "linux")]

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::sync::{Mutex, OnceLock};

extern "C" {
    fn dlopen(filename: *const c_char, flag: c_int) -> *mut c_void;
    fn dlerror() -> *const c_char;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}
const RTLD_NOW: c_int = 2;

type ShowFn = unsafe extern "C" fn(*mut c_void, c_int, c_int, c_int, c_int, c_int) -> bool;

struct Steam {
    utils: *mut c_void,
    show: ShowFn,
}
// SAFETY: the ISteamUtils pointer + fn pointer are process-global; SteamAPI flat calls are
// serialised through the OnceLock init and only invoked from Tauri command threads.
unsafe impl Send for Steam {}
unsafe impl Sync for Steam {}

static STEAM: OnceLock<Steam> = OnceLock::new();
static INIT_LOCK: Mutex<()> = Mutex::new(());

unsafe fn sym(h: *mut c_void, name: &str) -> Option<*mut c_void> {
    let c = CString::new(name).ok()?;
    let p = dlsym(h, c.as_ptr());
    if p.is_null() {
        None
    } else {
        Some(p)
    }
}

fn init() -> Option<Steam> {
    unsafe {
        // The host Steam ships libsteam_api.so; dlopen it from the usual install locations (the
        // Flatpak needs --filesystem=~/.steam:ro to read these).
        let mut h = std::ptr::null_mut();
        let mut last_error = String::new();
        for p in [
            // Current SteamOS puts the host-facing 64-bit SDK shim here.
            "/home/deck/.local/share/Steam/steamrt64/libsteam_api.so",
            "/home/deck/.steam/steam/linux64/libsteam_api.so",
            "/home/deck/.local/share/Steam/linux64/libsteam_api.so",
            "/home/deck/.steam/sdk64/libsteam_api.so",
            "libsteam_api.so",
        ] {
            if let Ok(c) = CString::new(p) {
                let _ = dlerror();
                h = dlopen(c.as_ptr(), RTLD_NOW);
                if !h.is_null() {
                    break;
                }
                let error = dlerror();
                if !error.is_null() {
                    last_error = CStr::from_ptr(error).to_string_lossy().into_owned();
                }
            }
        }
        if h.is_null() {
            crate::player::linux_embed::elog(&format!(
                "steam_osk: libsteam_api.so load failed: {last_error}"
            ));
            return None;
        }

        // Steam needs an app id to locate the pipe. Steam usually sets SteamAppId for a launched
        // non-Steam game; fall back to 480 (Spacewar test id) if it's absent.
        if std::env::var_os("SteamAppId").is_none() {
            std::env::set_var("SteamAppId", "480");
        }

        // Init — try the classic bool SteamAPI_Init(), then the newer SteamAPI_InitFlat(char*).
        let ok = if let Some(p) = sym(h, "SteamAPI_Init") {
            let f: unsafe extern "C" fn() -> bool = std::mem::transmute(p);
            f()
        } else if let Some(p) = sym(h, "SteamAPI_InitFlat") {
            let f: unsafe extern "C" fn(*mut c_char) -> c_int = std::mem::transmute(p);
            let mut err = [0i8; 1024];
            f(err.as_mut_ptr()) == 0 // 0 == k_ESteamAPIInitResult_OK
        } else {
            false
        };
        if !ok {
            crate::player::linux_embed::elog("steam_osk: SteamAPI_Init failed (Steam not reachable)");
            return None;
        }

        let utils_fn: unsafe extern "C" fn() -> *mut c_void = std::mem::transmute(
            sym(h, "SteamAPI_SteamUtils")
                .or_else(|| sym(h, "SteamAPI_SteamUtils_v011"))
                .or_else(|| sym(h, "SteamAPI_SteamUtils_v010"))?,
        );
        let utils = utils_fn();
        if utils.is_null() {
            return None;
        }
        let show: ShowFn =
            std::mem::transmute(sym(h, "SteamAPI_ISteamUtils_ShowFloatingGamepadTextInput")?);

        // Pump callbacks so the pipe stays alive + dismissal events are delivered.
        if let Some(rc) = sym(h, "SteamAPI_RunCallbacks") {
            let run: unsafe extern "C" fn() = std::mem::transmute(rc);
            std::thread::spawn(move || loop {
                run();
                std::thread::sleep(std::time::Duration::from_millis(100));
            });
        }
        crate::player::linux_embed::elog("steam_osk: initialised — floating keyboard available");
        Some(Steam { utils, show })
    }
}

fn steam() -> Option<&'static Steam> {
    if let Some(steam) = STEAM.get() {
        return Some(steam);
    }
    // Do not permanently cache a failed first attempt. Steam can still be bringing its client pipe
    // up when the app receives an early focus event; a later field focus should be allowed to retry.
    let _guard = INIT_LOCK.lock().ok()?;
    if STEAM.get().is_none() {
        STEAM.set(init()?).ok()?;
    }
    STEAM.get()
}

/// Show the Steam floating keyboard over the field at the given WINDOW-pixel rect. Returns false if
/// the Steam OSK is unavailable — the caller then shows the built-in HTML keyboard. `mode`: 0 =
/// single-line, 1 = multi-line, 2 = email, 3 = numeric.
pub fn show(x: i32, y: i32, w: i32, h: i32, mode: i32) -> bool {
    steam()
        .map(|s| unsafe { (s.show)(s.utils, mode.clamp(0, 3), x, y, w.max(1), h.max(1)) })
        .unwrap_or(false)
}
