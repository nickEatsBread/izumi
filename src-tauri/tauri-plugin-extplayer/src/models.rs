use serde::{Deserialize, Serialize};

/// A request to play a video URL (or a local file path) in an external Android player.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest {
    /// A remote URL (isLocal = false) or an absolute local file path (isLocal = true).
    pub url: String,
    /// Display title, passed to players that show one.
    pub title: Option<String>,
    /// When true, `url` is a local file → resolve via a FileProvider content URI.
    #[serde(default)]
    pub is_local: bool,
}

/// A request to hand a downloaded APK to the system package installer (self-update).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    /// Absolute path to the downloaded .apk on local storage.
    pub path: String,
}
