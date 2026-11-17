//! Steam Deck on-screen keyboard via the Steamworks floating gamepad text input.
//!
//! When izumi is added to Steam as a non-Steam game and launched in Game mode, Steam's floating
//! keyboard can type straight into the focused WebKit field (OS keystrokes, no read-back plumbing).
//! izumi talks to Steam's own client library, `steamclient.so`, which every Steam install has (SteamOS
//! ships no `libsteam_api.so`; only games bundle one). It is dlopened at RUNTIME (no build-time SDK
//! dependency, nothing bundled) and does what libsteam_api does inside: `CreateInterface
//! ("SteamClient021")`, a pipe, the user, and `ISteamUtils010`, whose floating keyboard is called
//! through the interface's vtable. If any step fails, [`show`] returns false and the frontend falls
//! back to its built-in HTML keyboard.
//!
//! No app id is used: the client reads `SteamAppId` as it loads and refuses a non-Steam shortcut's id
//! (which Steam itself sets for izumi), and borrowing another app's id would show that app in the
//! viewer's Steam activity. Loaded without one, it connects as no app at all.
//!
//! Requires the Flatpak to reach the host Steam install: `--filesystem=~/.steam:ro` (see the manifest).
#![cfg(target_os = "linux")]

use std::ffi::{c_char, c_int, c_void, CString};
use std::sync::{Mutex, OnceLock};

extern "C" {
    fn dlopen(filename: *const c_char, flag: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}
const RTLD_NOW: c_int = 2;

type ShowFn = unsafe extern "C" fn(*mut c_void, c_int, c_int, c_int, c_int, c_int) -> bool;

struct Steam {
    utils: *mut c_void,
    show: ShowFn,
}

// ISteamClient021 / ISteamUtils010 vtable slots (isteamclient.h, isteamutils.h). Checked on a Deck:
// GetAppID answers the app id it connected with and IsSteamRunningOnSteamDeck answers true.
const CLIENT_CREATE_PIPE: usize = 0;
const CLIENT_CONNECT_GLOBAL_USER: usize = 2;
const CLIENT_GET_UTILS: usize = 9;
const UTILS_GET_APP_ID: usize = 9;
const UTILS_ON_DECK: usize = 34;
const UTILS_SHOW_FLOATING: usize = 35;

unsafe fn slot(object: *mut c_void, index: usize) -> *mut c_void {
    let table = *(object as *const *const *mut c_void);
    *table.add(index)
}

/// The floating keyboard through Steam's own client library, loaded without an app id.
fn init() -> Option<Steam> {
    let launched = std::env::var_os("SteamAppId");
    std::env::remove_var("SteamAppId");
    let steam = unsafe { connect_client() };
    if let Some(app) = launched {
        std::env::set_var("SteamAppId", app);
    }
    steam
}

unsafe fn connect_client() -> Option<Steam> {
    {
        let mut h = std::ptr::null_mut();
        for p in [
            "/home/deck/.local/share/Steam/linux64/steamclient.so",
            "/home/deck/.steam/sdk64/steamclient.so",
            "/home/deck/.steam/steam/linux64/steamclient.so",
        ] {
            if let Ok(c) = CString::new(p) {
                h = dlopen(c.as_ptr(), RTLD_NOW);
                if !h.is_null() {
                    break;
                }
            }
        }
        if h.is_null() {
            crate::player::linux_embed::elog("steam_osk: steamclient.so not found");
            return None;
        }
        let create: unsafe extern "C" fn(*const c_char, *mut c_int) -> *mut c_void =
            std::mem::transmute(sym(h, "CreateInterface")?);
        let version = CString::new("SteamClient021").ok()?;
        let client = create(version.as_ptr(), std::ptr::null_mut());
        if client.is_null() {
            crate::player::linux_embed::elog("steam_osk: SteamClient021 unavailable");
            return None;
        }
        let create_pipe: unsafe extern "C" fn(*mut c_void) -> i32 = std::mem::transmute(slot(client, CLIENT_CREATE_PIPE));
        let connect: unsafe extern "C" fn(*mut c_void, i32) -> i32 = std::mem::transmute(slot(client, CLIENT_CONNECT_GLOBAL_USER));
        let get_utils: unsafe extern "C" fn(*mut c_void, i32, *const c_char) -> *mut c_void =
            std::mem::transmute(slot(client, CLIENT_GET_UTILS));
        let pipe = create_pipe(client);
        if pipe == 0 || connect(client, pipe) == 0 {
            crate::player::linux_embed::elog("steam_osk: Steam refused the connection");
            return None;
        }
        let utils_version = CString::new("SteamUtils010").ok()?;
        let utils = get_utils(client, pipe, utils_version.as_ptr());
        if utils.is_null() {
            return None;
        }
        // A wrong slot would call the wrong method: connected without an app, GetAppID answers 0, and
        // the keyboard is only asked for on a Deck.
        let app_id: unsafe extern "C" fn(*mut c_void) -> u32 = std::mem::transmute(slot(utils, UTILS_GET_APP_ID));
        let on_deck: unsafe extern "C" fn(*mut c_void) -> bool = std::mem::transmute(slot(utils, UTILS_ON_DECK));
        if app_id(utils) != 0 || !on_deck(utils) {
            crate::player::linux_embed::elog("steam_osk: ISteamUtils010 layout not recognised");
            return None;
        }
        crate::player::linux_embed::elog("steam_osk: floating keyboard through steamclient");
        Some(Steam { utils, show: std::mem::transmute(slot(utils, UTILS_SHOW_FLOATING)) })
    }
}
// SAFETY: the ISteamUtils pointer + fn pointer are process-global; the connection is made once,
// serialised through the OnceLock init, and only used from Tauri command threads.
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
