use serde::{Deserialize, Serialize};

/// Combined Android save-picker + write. Desktop never uses this.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTextFileRequest {
    pub file_name: String,
    pub mime: Option<String>,
    pub contents: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SaveTextFileResponse {
    pub saved: bool,
}

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

/// Paths needed to load the pinned AnymeX Android runtime and enumerate Izumi's privately stored
/// Aniyomi APKs. Both paths stay inside the app data directory.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AniyomiRuntimeRequest {
    pub runtime_path: String,
    pub extensions_path: String,
}

/// One call through the Android runtime host. JSON is used at the Kotlin boundary because the
/// returned extension maps are heterogeneous and Tauri's generated argument classes are static.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AniyomiCallRequest {
    pub runtime_path: String,
    pub extensions_path: String,
    pub method: String,
    pub args_json: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JsonResponse {
    pub json: String,
}

/// A URL to show in Android's browser-backed Custom Tab.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BrowserRequest {
    pub url: String,
}

/// Direct-play media handed to the Google Cast Default Media Receiver.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastMediaRequest {
    pub url: String,
    pub title: Option<String>,
    pub content_type: String,
    #[serde(default)]
    pub position_ms: u64,
    /// JSON array of `{ url, title?, lang?, contentType }` sidecar tracks.
    #[serde(default = "default_json_array")]
    pub subtitles_json: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TizenReceiverDevice {
    pub id: String,
    pub name: String,
    pub address: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TizenReceiverDiscovery {
    pub devices: Vec<TizenReceiverDevice>,
}

fn default_json_array() -> String {
    "[]".to_string()
}

/// Plain text handed to Android's system share sheet.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ShareTextRequest {
    pub title: String,
    pub text: String,
}

/// Android power/network state used to decide whether optional background seeding is responsible.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
    pub unmetered: bool,
    pub charging: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LanDiscoveryRequest {
    pub enabled: bool,
}

/// A request to run the in-app OAuth login flow (mobile: a WebView that captures the redirect).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthRequest {
    pub auth_url: String,
    pub redirect_prefix: String,
}

/// The captured redirect URL (query + fragment), from which callers read `?code=`/`#access_token=`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OAuthResponse {
    pub url: String,
}

/// Read reaction counts + the signed-in user's selected key for a discussanime thread, carrying the
/// `da_session` cookie the in-frame browser fetch cannot.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaReactionStateRequest {
    pub base: String,
    pub identifier: String,
}

/// Post (or clear, `key = None`) a discussanime reaction authenticated by the `da_session` cookie.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaReactRequest {
    pub base: String,
    pub identifier: String,
    pub key: Option<String>,
}

/// Sign in to discussanime in the in-app overlay WebView.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaLoginRequest {
    pub base: String,
}

/// The raw JSON body of a reaction-state response, for the frontend to parse.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ReactionStateResponse {
    pub body: String,
}

/// Result of a reaction POST: `ok` on success, `needs_login` when there is no live session.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReactResponse {
    pub ok: bool,
    pub needs_login: bool,
    #[serde(default)]
    pub body: Option<String>,
}

/// Result of a discussanime login attempt.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DaLoginResponse {
    pub ok: bool,
}

/// Drive the Android background-download foreground service: `active: true` starts it (or
/// refreshes its progress notification), `false` stops it. No-op on desktop.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadForegroundRequest {
    pub active: bool,
    pub title: Option<String>,
    /// Human-readable byte/speed/item summary shown below the episode title.
    pub detail: Option<String>,
    /// 0-100; omit for an indeterminate bar.
    pub progress: Option<u32>,
    /// Active + queued item count, shown under the title.
    pub count: Option<u32>,
}

/// Keep the app process/network relay alive only while a TV is actively consuming phone-hosted media.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CompanionCastForegroundRequest {
    pub active: bool,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NotificationPermissionResponse {
    pub granted: bool,
}
