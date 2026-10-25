//! The startup animation a pack can set: one short video izumi plays full-screen while it starts.
//!
//! The file is downloaded once over HTTPS, checked against the size and SHA-256 the pack pinned, and
//! kept in `<data>/startup/`. The webview plays it from a loopback HTTP server under a random path
//! ([`startup_animation_url`]) that serves only that file and answers range requests. WebKitGTK's
//! media loader needs exactly that: it can't decode the file from a blob URL and refuses custom
//! URI schemes for media.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Largest file accepted. A few seconds of 1080p video fits easily.
const MAX_BYTES: u64 = 16 << 20;
const FILE: &str = "animation.bin";
const META: &str = "animation.json";

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub mime: String,
    pub bytes: u64,
    pub sha256: String,
    /// Who set it: `pack:<id>`.
    pub by: String,
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("startup")).map_err(|e| format!("no app data folder: {e}"))
}

/// The container type from the first bytes: MP4 (`ftyp` box) or WebM/Matroska (EBML header).
fn sniff(head: &[u8]) -> Option<&'static str> {
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        return Some("video/mp4");
    }
    if head.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        return Some("video/webm");
    }
    None
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn valid_sha(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn valid_owner(by: &str) -> bool {
    by.strip_prefix("pack:").is_some_and(|id| {
        !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    })
}

/// Checks a downloaded file against what the pack pinned and returns its type.
fn verify(body: &[u8], bytes: u64, sha256: &str) -> Result<&'static str, String> {
    if body.len() as u64 != bytes {
        return Err(format!("the animation is {} bytes, not the {bytes} the pack names", body.len()));
    }
    if sha256_hex(body) != sha256.to_ascii_lowercase() {
        return Err("the animation does not match the pack's checksum".into());
    }
    sniff(body).ok_or_else(|| "the animation is not an MP4 or WebM video".into())
}

fn read_info(dir: &Path) -> Option<Info> {
    let info: Info = serde_json::from_slice(&std::fs::read(dir.join(META)).ok()?).ok()?;
    dir.join(FILE).is_file().then_some(info)
}

fn store(dir: &Path, body: &[u8], info: &Info) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{FILE}.tmp"));
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(FILE)).map_err(|e| e.to_string())?;
    store_meta(dir, info)
}

/// Downloads, verifies and keeps the animation `by` (a pack) names.
#[tauri::command]
pub async fn startup_animation_set(app: AppHandle, url: String, sha256: String, bytes: u64, by: String) -> Result<Info, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "bad animation URL".to_string())?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("the animation must come from an https URL".into());
    }
    if !valid_sha(&sha256) || bytes == 0 || bytes > MAX_BYTES || !valid_owner(&by) {
        return Err("the pack's animation entry is invalid".into());
    }
    let dir = dir(&app)?;
    if let Some(info) = read_info(&dir) {
        if info.sha256 == sha256.to_ascii_lowercase() {
            let info = Info { by, ..info };
            store_meta(&dir, &info)?;
            return Ok(info);
        }
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let mut res = client.get(parsed).send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("download failed: {e}"))?;
    if res.content_length().is_some_and(|n| n != bytes) {
        return Err("the animation's size changed since the pack was made".into());
    }
    let mut body = Vec::with_capacity(bytes as usize);
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("download failed: {e}"))? {
        body.extend_from_slice(&chunk);
        if body.len() as u64 > bytes {
            return Err("the animation is larger than the pack says".into());
        }
    }
    let mime = verify(&body, bytes, &sha256)?;
    let info = Info { mime: mime.into(), bytes, sha256: sha256.to_ascii_lowercase(), by };
    store(&dir, &body, &info)?;
    Ok(info)
}

fn store_meta(dir: &Path, info: &Info) -> Result<(), String> {
    std::fs::write(dir.join(META), serde_json::to_vec_pretty(info).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Removes the animation. With `by`, only if that owner set it (a pack being removed).
#[tauri::command]
pub fn startup_animation_clear(app: AppHandle, by: Option<String>) -> Result<(), String> {
    let dir = dir(&app)?;
    if let (Some(by), Some(info)) = (by.as_deref(), read_info(&dir)) {
        if info.by != by {
            return Ok(());
        }
    }
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn startup_animation_info(app: AppHandle) -> Result<Option<Info>, String> {
    Ok(read_info(&dir(&app)?))
}

/// `bytes=a-b`, `bytes=a-` or `bytes=-n` as an inclusive range within `len`; None if unsatisfiable.
fn byte_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start, end) = spec.split_once('-')?;
    let (start, end) = match (start.trim(), end.trim()) {
        ("", suffix) => {
            let n: u64 = suffix.parse().ok()?;
            (len.checked_sub(n.min(len))?, len.checked_sub(1)?)
        }
        (a, "") => (a.parse().ok()?, len.checked_sub(1)?),
        (a, b) => (a.parse().ok()?, b.parse::<u64>().ok()?.min(len.checked_sub(1)?)),
    };
    (start <= end && end < len).then_some((start, end))
}

/// The saved video, or the part of it `range` asks for.
fn respond(dir: &Path, range: Option<&str>) -> axum::http::Response<Vec<u8>> {
    use axum::http::{header, Response, StatusCode};
    let empty = |status: StatusCode| Response::builder().status(status).body(Vec::new()).expect("valid response");
    let Some(info) = read_info(dir) else { return empty(StatusCode::NOT_FOUND) };
    let Ok(body) = std::fs::read(dir.join(FILE)) else { return empty(StatusCode::NOT_FOUND) };
    let len = body.len() as u64;
    let response = Response::builder()
        .header(header::CONTENT_TYPE, info.mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store");
    let response = match range.map(|value| byte_range(value, len)) {
        None => response.status(StatusCode::OK).header(header::CONTENT_LENGTH, len).body(body),
        Some(None) => response
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{len}"))
            .body(Vec::new()),
        Some(Some((start, end))) => response
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .header(header::CONTENT_LENGTH, end - start + 1)
            .body(body[start as usize..=end as usize].to_vec()),
    };
    response.unwrap_or_else(|_| empty(StatusCode::INTERNAL_SERVER_ERROR))
}

static SERVER: tokio::sync::OnceCell<String> = tokio::sync::OnceCell::const_new();

/// Starts the loopback server once and returns the video's address on it. The random path keeps
/// other local programs from guessing it; it serves the startup video and nothing else.
async fn server_url(dir: PathBuf) -> Result<String, String> {
    SERVER
        .get_or_try_init(|| async move {
            let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await.map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let mut token = [0u8; 16];
            getrandom::fill(&mut token).map_err(|e| e.to_string())?;
            let path = format!("/{}/animation", token.iter().map(|b| format!("{b:02x}")).collect::<String>());
            let route = axum::routing::get(move |headers: axum::http::HeaderMap| {
                let dir = dir.clone();
                async move {
                    let range = headers.get(axum::http::header::RANGE).and_then(|value| value.to_str().ok());
                    respond(&dir, range).map(axum::body::Body::from)
                }
            });
            let router = axum::Router::new().route(&path, route);
            tauri::async_runtime::spawn(async move {
                if let Err(error) = axum::serve(listener, router).await {
                    eprintln!("[startup] animation server stopped: {error}");
                }
            });
            Ok::<_, String>(format!("http://127.0.0.1:{port}{path}"))
        })
        .await
        .cloned()
}

/// Where the webview can play the startup video, or None when there is none.
#[tauri::command]
pub async fn startup_animation_url(app: AppHandle) -> Result<Option<String>, String> {
    let dir = dir(&app)?;
    let Some(info) = read_info(&dir) else { return Ok(None) };
    Ok(Some(format!("{}?v={}", server_url(dir).await?, &info.sha256[..16])))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mp4() -> Vec<u8> {
        let mut v = vec![0, 0, 0, 0x18];
        v.extend_from_slice(b"ftypisom\0\0\x02\0isomiso2");
        v
    }

    #[test]
    fn sniffs_mp4_and_webm_only() {
        assert_eq!(sniff(&mp4()), Some("video/mp4"));
        assert_eq!(sniff(&[0x1a, 0x45, 0xdf, 0xa3, 1, 2]), Some("video/webm"));
        assert_eq!(sniff(b"<html><body>"), None);
        assert_eq!(sniff(b"GIF89a"), None);
    }

    #[test]
    fn verify_checks_size_hash_and_type() {
        let body = mp4();
        let sha = sha256_hex(&body);
        assert_eq!(verify(&body, body.len() as u64, &sha), Ok("video/mp4"));
        assert_eq!(verify(&body, body.len() as u64, &sha.to_ascii_uppercase()), Ok("video/mp4"));
        assert!(verify(&body, body.len() as u64 + 1, &sha).is_err());
        assert!(verify(&body, body.len() as u64, &"0".repeat(64)).is_err());
        let html = b"<html>not a video</html>".to_vec();
        assert!(verify(&html, html.len() as u64, &sha256_hex(&html)).is_err());
    }

    #[test]
    fn ranges_follow_http_rules() {
        assert_eq!(byte_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(byte_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(byte_range("bytes=90-500", 100), Some((90, 99)));
        assert_eq!(byte_range("bytes=-30", 100), Some((70, 99)));
        assert_eq!(byte_range("bytes=-300", 100), Some((0, 99)));
        assert_eq!(byte_range("bytes=100-", 100), None);
        assert_eq!(byte_range("bytes=20-10", 100), None);
        assert_eq!(byte_range("items=0-1", 100), None);
        assert_eq!(byte_range("bytes=0-", 0), None);
    }

    #[test]
    fn owners_are_pack_ids() {
        assert!(valid_owner("pack:io.github.example.pack"));
        assert!(!valid_owner("user"));
        assert!(!valid_owner("pack:../../x"));
    }

    #[test]
    fn stored_animation_reads_back() {
        let dir = std::env::temp_dir().join(format!("izumi-startup-{}", std::process::id()));
        let body = mp4();
        let info = Info { mime: "video/mp4".into(), bytes: body.len() as u64, sha256: sha256_hex(&body), by: "pack:a".into() };
        store(&dir, &body, &info).unwrap();
        assert_eq!(read_info(&dir), Some(info));
        let whole = respond(&dir, None);
        assert_eq!((whole.status().as_u16(), whole.body().len()), (200, body.len()));
        let part = respond(&dir, Some("bytes=4-7"));
        assert_eq!(part.status().as_u16(), 206);
        assert_eq!(part.body().as_slice(), b"ftyp");
        assert_eq!(part.headers()["content-range"], format!("bytes 4-7/{}", body.len()));
        assert_eq!(part.headers()["content-type"], "video/mp4");
        assert_eq!(respond(&dir, Some("bytes=999-")).status().as_u16(), 416);
        std::fs::remove_file(dir.join(FILE)).unwrap();
        assert_eq!(read_info(&dir), None, "metadata without the file is not an animation");
        assert_eq!(respond(&dir, None).status().as_u16(), 404);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
