//! Protected (Widevine) playback on Linux through izumi's own libmpv player.
//!
//! WebKitGTK has no EME, so instead of a browser engine izumi hosts Google's Widevine module itself,
//! the way Kodi does: one module thread (`cdm.rs`, C++ shim in `native/widevine/`), licences through
//! the source's licence URL, and protected files read through `izcr://` (`protocol.rs`), where they
//! are decrypted in memory. Video goes through the module's own decoder unless the module allows
//! decrypt-only video, in which case mpv's hardware decoder is used. The module is downloaded from
//! Google only after the user has read and accepted its licence (`fetch.rs`).
mod cdm;
pub(crate) mod fetch;
mod fmp4;
mod media;
mod mpd;
mod protocol;
pub(crate) mod save;
mod seccomp;
pub(crate) mod session;

pub use protocol::register as register_protocol;
pub use session::{end_all, is_protected_url, Request};

use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("no app data folder: {e}"))
}

/// Licenses a protected manifest and registers its in-memory streams for the player.
pub async fn prepare(app: &AppHandle, manifest_url: &str, req: &Request) -> anyhow::Result<session::Prepared> {
    let data = data_dir(app).map_err(anyhow::Error::msg)?;
    let emitter = app.clone();
    let on_refused: media::OnRefused = Arc::new(move || {
        eprintln!("[widevine] the module refused a video sample; switching to its own decoder");
        let _ = emitter.emit("player-drm-video-refused", ());
    });
    session::prepare(&data, manifest_url, req, on_refused).await
}

/// Saves a protected episode for offline use (`save.rs`), reporting progress as `download-progress`
/// for download `id`. Returns the folder; the player opens it as `file://<folder>`.
pub async fn save_download(app: &AppHandle, id: String, manifest_url: String, dir: String, name: String, max_height: Option<u32>) -> Result<serde_json::Value, String> {
    let emitter = app.clone();
    let progress_id = id.clone();
    let folder = save::folder_for(std::path::Path::new(&dir), &name);
    let result = save::save(&id, &manifest_url, &folder, max_height, move |received, total, speed| {
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Protected playback through izumi's own player is available on this build.
    pub supported: bool,
    pub installed: Option<String>,
}

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
    Ok(Status { supported: true, installed: fetch::installed(&data).map(|i| i.version) })
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
}
