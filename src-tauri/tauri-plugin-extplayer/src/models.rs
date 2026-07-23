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

/// A URL to show in Android's browser-backed Custom Tab.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BrowserRequest {
    pub url: String,
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
