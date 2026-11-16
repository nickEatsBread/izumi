//! Protected (Widevine) handling by hosting Google's module directly, the way Kodi does.
//!
//! On Linux the module also powers playback: WebKitGTK has no EME, so protected files are read
//! through `izcr://` (`protocol.rs`) and decrypted in memory on one module thread (`cdm.rs`, C++ shim
//! in `native/widevine/`). On Windows the webview has EME and streams protected media itself, so the
//! module is used only to *save* a protected episode as a clear file (`save.rs`): there the host
//! vtable is built in Rust (`host_win.rs`) because a COM-less `.dll` cannot be loaded the dlopen way.
//! macOS is the same as Windows: save-only, through the same Rust host.
//!
//! The module is used only after the user has accepted its licence (`fetch.rs`). It is downloaded from
//! Google unless a browser on the machine already ships a copy, which the host prefers: the WebView2
//! runtime, Edge or Chrome on Windows, Chrome on macOS.
mod cdm;
pub(crate) mod fetch;
mod fmp4;
// The in-memory streaming path (Track/RawVideo over izcr://) needs libmpv, which only the Linux
// desktop embeds. Windows saves to a clear file instead and never touches these.
#[cfg(target_os = "linux")]
mod media;
mod mpd;
#[cfg(target_os = "linux")]
mod protocol;
pub(crate) mod save;
mod seccomp;
#[cfg(target_os = "linux")]
pub(crate) mod session;
// The Rust CDM host vtable. Linux links the C++ shim instead (build.rs).
// Named for Windows, where it started; macOS uses the same host unchanged.
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod host_win;

#[cfg(target_os = "linux")]
pub use protocol::register as register_protocol;
#[cfg(target_os = "linux")]
pub use session::{end_all, is_protected_url, Request};

use tauri::{AppHandle, Emitter, Manager};

fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("no app data folder: {e}"))
}

/// Licenses a protected manifest and registers its in-memory streams for the player, opening at
/// `start` seconds (see `Prepared::start`). Linux only; other platforms stream in the webview.
#[cfg(target_os = "linux")]
pub async fn prepare(app: &AppHandle, manifest_url: &str, req: &Request, start: Option<f64>) -> anyhow::Result<session::Prepared> {
    use std::sync::Arc;
    let data = data_dir(app).map_err(anyhow::Error::msg)?;
    let emitter = app.clone();
    let on_refused: media::OnRefused = Arc::new(move || {
        eprintln!("[widevine] the module refused a video sample; switching to its own decoder");
        let _ = emitter.emit("player-drm-video-refused", ());
    });
    session::prepare(&data, manifest_url, req, start, on_refused).await
}

/// Saves a protected episode as a clear file (`save.rs`), reporting progress as `download-progress`
/// for download `id`. `drm` is the source's licence request (URL + headers) so the module can get
/// the content keys. Returns the folder; the player opens it as `file://<folder>`.
pub async fn save_download(
    app: &AppHandle,
    id: String,
    manifest_url: String,
    dir: String,
    name: String,
    max_height: Option<u32>,
    drm: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let licence: save::Licence = drm
        .map(|d| serde_json::from_value(d).map_err(|e| format!("bad protected-stream request: {e}")))
        .transpose()?
        .ok_or("saving a protected episode needs its licence request")?;
    let data = data_dir(app)?;
    let emitter = app.clone();
    let progress_id = id.clone();
    let folder = save::folder_for(std::path::Path::new(&dir), &name);
    let result = save::save(&id, &manifest_url, &folder, max_height, &licence, &data, move |received, total, speed| {
        let _ = emitter.emit("download-progress", (progress_id.as_str(), received, total, speed));
    })
    .await
    .map_err(|e| format!("{e:#}"))?;
    Ok(serde_json::json!({ "path": folder.display().to_string(), "bytes": result.bytes, "height": result.height }))
}

/// Stops a running `save_download`; the partial files stay so a resume continues them.
pub fn cancel_save(id: &str) {
    save::cancel(id);
}

/// Error text the frontend recognises to offer the module download.
pub const NOT_INSTALLED: &str = "widevine-not-installed";

/// Whether two language tags name the same language (`jpn` vs `ja-JP`, `eng` vs `en`).
pub(crate) fn lang_matches(a: &str, b: &str) -> bool {
    fn base(tag: &str) -> String {
        let primary = tag.split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
        let two = match primary.as_str() {
            "jpn" => "ja",
            "eng" => "en",
            "spa" => "es",
            "fra" | "fre" => "fr",
            "deu" | "ger" => "de",
            "ita" => "it",
            "por" => "pt",
            "rus" => "ru",
            "ara" => "ar",
            "zho" | "chi" => "zh",
            "kor" => "ko",
            "hin" => "hi",
            "tha" => "th",
            "vie" => "vi",
            "ind" => "id",
            "msa" | "may" => "ms",
            "pol" => "pl",
            "tur" => "tr",
            other => other,
        };
        two.to_string()
    }
    !a.is_empty() && base(a) == base(b)
}

/// What this build can do with the module. The two capabilities differ and must stay two fields:
/// every platform that builds the host can *save* through it, but only Linux *plays* through it
/// (Windows and macOS keep live playback in their webview). The frontend routes saves on `supported`
/// and playback on `playback`; one flag for both sent Windows playback to a surface it does not have.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The module host is built here, so protected episodes can be saved through it.
    pub supported: bool,
    /// Protected streams also *play* through izumi's own player (Linux only).
    pub playback: bool,
    /// The accepted module version izumi will load (none until the licence has been accepted).
    pub installed: Option<String>,
    /// A browser's own module version found on this device (Windows, macOS). Setting it up still
    /// asks the user to accept the licence but downloads nothing.
    pub available: Option<String>,
}

/// Whether protected playback goes through izumi's own player on this build (see [`Status`]).
pub const NATIVE_PLAYBACK: bool = cfg!(target_os = "linux");

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Staged {
    pub version: String,
    pub license: String,
}

#[derive(Clone, serde::Serialize)]
struct Progress {
    received: u64,
    total: u64,
}

pub fn widevine_status(app: AppHandle) -> Result<Status, String> {
    let data = data_dir(&app)?;
    Ok(Status {
        supported: true,
        playback: NATIVE_PLAYBACK,
        installed: fetch::installed(&data).map(|i| i.version),
        available: fetch::system_copy().map(|i| i.version),
    })
}

/// One module download at a time, shared by the player's prompt and the background module worker.
pub(crate) static DOWNLOAD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Downloads and verifies Google's current module into a staging folder; returns its licence text
/// for the user to read. Nothing is usable until [`widevine_accept`].
pub async fn widevine_download(app: AppHandle) -> Result<Staged, String> {
    let _one_at_a_time = DOWNLOAD.lock().await;
    let data = data_dir(&app)?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let emitter = app.clone();
    let progress = move |received: u64, total: u64| {
        let _ = emitter.emit("widevine-download-progress", Progress { received, total });
    };
    let staged = fetch::stage(&client, &data, &progress).await.map_err(|e| format!("{e:#}"))?;
    Ok(Staged { version: staged.version, license: staged.license })
}

pub fn widevine_accept(app: AppHandle, version: String) -> Result<String, String> {
    let data = data_dir(&app)?;
    let installed = fetch::accept(&data, &version, "user").map(|i| i.version).map_err(|e| format!("{e:#}"))?;
    // Recorded as wanted so the background worker keeps it updated like a pack's module.
    if let Err(e) = crate::modules::module_request("widevine".into(), "user".into()) {
        eprintln!("[widevine] could not record the module request: {e}");
    }
    Ok(installed)
}

/// Deletes the module and every request for it (Settings > Remove).
pub fn widevine_remove(app: AppHandle) -> Result<(), String> {
    let data = data_dir(&app)?;
    crate::modules::module_release("widevine".into(), None)?;
    fetch::remove(&data).map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn language_tags_match_across_code_styles() {
        assert!(super::lang_matches("ja-JP", "jpn"));
        assert!(super::lang_matches("en-US", "eng"));
        assert!(!super::lang_matches("en-US", "jpn"));
        assert!(!super::lang_matches("", ""));
    }

    /// Saving is available wherever the host is built; playback through it only on Linux. A build
    /// that reports native playback without the Linux player would route protected streams away from
    /// the webview that actually plays them.
    #[test]
    fn playback_is_native_only_on_linux() {
        assert_eq!(super::NATIVE_PLAYBACK, cfg!(target_os = "linux"));
        let status = super::Status { supported: true, playback: super::NATIVE_PLAYBACK, installed: None, available: None };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["supported"], true);
        assert_eq!(json["playback"], cfg!(target_os = "linux"));
    }
}
