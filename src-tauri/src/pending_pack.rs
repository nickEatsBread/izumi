//! A pack the installer was asked to set up (the Deck's `install.sh --pack <url>`): the installer
//! writes `<config>/pending-pack.json` and the next launch opens that pack's review screen. Taking it
//! deletes the marker, so it is offered once; nothing is applied without the user's review.

use std::path::Path;
use tauri::{AppHandle, Manager};

const MARKER: &str = "pending-pack.json";
const MAX_MARKER_BYTES: u64 = 8 * 1024;

/// The URL from a marker, if it is a plain public https URL.
fn url_from_marker(bytes: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let url = value.get("url")?.as_str()?.trim();
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    let public = parsed.scheme() == "https"
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && host.contains('.')
        && host.parse::<std::net::IpAddr>().is_err()
        && !host.trim_start_matches('[').starts_with(|c: char| c.is_ascii_digit() || c == ':');
    (public && url.len() <= 2048).then(|| parsed.to_string())
}

fn take(dir: &Path) -> Option<String> {
    let path = dir.join(MARKER);
    let meta = std::fs::metadata(&path).ok()?;
    let bytes = if meta.len() <= MAX_MARKER_BYTES { std::fs::read(&path).ok() } else { None };
    let _ = std::fs::remove_file(&path);
    url_from_marker(&bytes?)
}

/// The pending pack URL, once.
#[tauri::command]
pub fn pack_take_pending(app: AppHandle) -> Option<String> {
    take(&app.path().app_config_dir().ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_public_https_urls() {
        assert_eq!(url_from_marker(br#"{"url":"https://example.github.io/pack/pack.json"}"#).as_deref(), Some("https://example.github.io/pack/pack.json"));
        assert!(url_from_marker(br#"{"url":"http://example.github.io/pack.json"}"#).is_none());
        assert!(url_from_marker(br#"{"url":"https://192.168.1.2/pack.json"}"#).is_none());
        assert!(url_from_marker(br#"{"url":"https://user:pw@example.com/pack.json"}"#).is_none());
        assert!(url_from_marker(br#"{"url":"https://nas/pack.json"}"#).is_none());
        assert!(url_from_marker(b"not json").is_none());
    }

    #[test]
    fn a_marker_is_taken_once() {
        let dir = std::env::temp_dir().join(format!("izumi-pending-pack-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(MARKER), br#"{"url":"https://example.com/pack.json"}"#).unwrap();
        assert_eq!(take(&dir).as_deref(), Some("https://example.com/pack.json"));
        assert_eq!(take(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
