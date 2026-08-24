//! Offline downloads: stream a resolved debrid URL to a local file. Pure reqwest
//! GET → `.part` file → rename on completion, emitting `download-progress` /
//! `download-done` / `download-paused` events (same `Emitter` pattern as the player).
//! Pause is a cooperative cancel that KEEPS the `.part`; resume re-requests with a
//! `Range` header (the RD/AllDebrid/etc. CDNs support byte ranges). Cancel deletes
//! the `.part`. No torrent client, no `plugin-fs` — all disk I/O stays here.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use futures_util::StreamExt;
use reqwest::{
    header::{CONTENT_RANGE, CONTENT_TYPE},
    StatusCode,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use url::Url;

/// In-flight download cancel flags, keyed by job id. Setting a flag aborts that
/// job's chunk loop on its next iteration.
#[derive(Default)]
pub struct Downloads(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

pub(crate) fn sanitize(name: &str) -> String {
    #[allow(unused_mut)]
    let mut s: String = name
        .chars()
        .map(|c| {
            if "\\/:*?\"<>|".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    // Windows: a name whose stem equals a reserved DEVICE (CON, PRN, AUX, NUL, COM1-9, LPT1-9,
    // CONIN$/CONOUT$) maps to that device REGARDLESS of extension — opening "NUL.mkv" opens the
    // null device, so every written byte is silently discarded yet the download reports success.
    // The OS also strips trailing dots/spaces. Debrid/torrent filenames are attacker-influenceable,
    // so harden them here. Gated to Windows so legitimate Linux/Android names are untouched.
    #[cfg(windows)]
    {
        s = s.trim_end_matches(|c| c == ' ' || c == '.').to_string();
        let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
        let reserved = matches!(
            stem.as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "CONIN$"
                | "CONOUT$"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        );
        if reserved {
            s.insert(0, '_');
        }
        if s.is_empty() || s == "." || s == ".." {
            s = "_".to_string();
        }
    }
    s
}

#[derive(Debug, PartialEq, Eq)]
enum ResumeResponse {
    Append { total: Option<u64> },
    Restart { total: Option<u64> },
    Complete,
}

#[derive(Debug, PartialEq, Eq)]
struct HlsVariant {
    url: Url,
    bandwidth: u64,
    height: Option<u32>,
}

#[derive(Debug, PartialEq, Eq)]
enum HlsPlaylist {
    Master(Vec<HlsVariant>),
    Media(Vec<Url>),
}

fn hls_attribute(line: &str, wanted: &str) -> Option<String> {
    let attrs = line.split_once(':')?.1.as_bytes();
    let mut offset = 0;
    while offset < attrs.len() {
        while offset < attrs.len() && (attrs[offset] == b',' || attrs[offset].is_ascii_whitespace())
        {
            offset += 1;
        }
        let key_start = offset;
        while offset < attrs.len() && attrs[offset] != b'=' && attrs[offset] != b',' {
            offset += 1;
        }
        if offset >= attrs.len() || attrs[offset] != b'=' {
            while offset < attrs.len() && attrs[offset] != b',' {
                offset += 1;
            }
            continue;
        }
        let key = std::str::from_utf8(&attrs[key_start..offset]).ok()?.trim();
        offset += 1;
        let quoted = offset < attrs.len() && attrs[offset] == b'"';
        if quoted {
            offset += 1;
        }
        let value_start = offset;
        if quoted {
            while offset < attrs.len() && attrs[offset] != b'"' {
                offset += 1;
            }
        } else {
            while offset < attrs.len() && attrs[offset] != b',' {
                offset += 1;
            }
        }
        let value = std::str::from_utf8(&attrs[value_start..offset])
            .ok()?
            .trim();
        if quoted && offset < attrs.len() {
            offset += 1;
        }
        while offset < attrs.len() && attrs[offset] != b',' {
            offset += 1;
        }
        if key.eq_ignore_ascii_case(wanted) {
            return Some(value.to_string());
        }
    }
    None
}

fn parse_hls_playlist(base: &Url, text: &str) -> Result<HlsPlaylist, String> {
    if !text.trim_start().starts_with("#EXTM3U") {
        return Err(
            "The source returned a non-HLS document instead of an episode playlist.".into(),
        );
    }
    let mut variants = Vec::new();
    let mut resources = Vec::new();
    let mut pending_variant: Option<(u64, Option<u32>)> = None;
    let mut saw_segment = false;

    for raw in text.lines() {
        let line = raw.trim();
        if line.starts_with("#EXT-X-STREAM-INF:") {
            let bandwidth = hls_attribute(line, "BANDWIDTH")
                .and_then(|value| value.parse().ok())
                .unwrap_or(0);
            let height = hls_attribute(line, "RESOLUTION")
                .and_then(|value| value.split_once('x').map(|(_, height)| height.to_string()))
                .and_then(|height| height.parse().ok());
            pending_variant = Some((bandwidth, height));
            continue;
        }
        if line.starts_with("#EXT-X-KEY:") {
            let method = hls_attribute(line, "METHOD").unwrap_or_default();
            if !method.eq_ignore_ascii_case("NONE") {
                return Err(
                    "This HLS source still exposes encrypted segments and cannot be saved safely."
                        .into(),
                );
            }
            continue;
        }
        if line.starts_with("#EXT-X-BYTERANGE:") {
            return Err("Byte-range HLS downloads are not supported by this source yet.".into());
        }
        if line.starts_with("#EXT-X-MAP:") {
            let uri = hls_attribute(line, "URI")
                .ok_or_else(|| "HLS initialization segment is missing its URI.".to_string())?;
            resources.push(
                base.join(&uri)
                    .map_err(|error| format!("Invalid HLS resource URL: {error}"))?,
            );
            continue;
        }
        if line.starts_with("#EXTINF:") {
            saw_segment = true;
            continue;
        }
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let resolved = base
            .join(line)
            .map_err(|error| format!("Invalid HLS resource URL: {error}"))?;
        if let Some((bandwidth, height)) = pending_variant.take() {
            variants.push(HlsVariant {
                url: resolved,
                bandwidth,
                height,
            });
        } else {
            resources.push(resolved);
        }
    }

    if !variants.is_empty() {
        return Ok(HlsPlaylist::Master(variants));
    }
    if !saw_segment || resources.is_empty() {
        return Err("The HLS playlist contained no downloadable media segments.".into());
    }
    Ok(HlsPlaylist::Media(resources))
}

fn choose_hls_variant(
    mut variants: Vec<HlsVariant>,
    preferred_height: Option<u32>,
) -> Option<HlsVariant> {
    if let Some(preferred) = preferred_height {
        let within = variants
            .iter()
            .enumerate()
            .filter(|(_, variant)| variant.height.is_some_and(|height| height <= preferred))
            .max_by_key(|(_, variant)| (variant.height.unwrap_or(0), variant.bandwidth))
            .map(|(index, _)| index);
        if let Some(index) = within {
            return Some(variants.swap_remove(index));
        }
        let lowest = variants
            .iter()
            .enumerate()
            .filter_map(|(index, variant)| {
                variant
                    .height
                    .map(|height| (index, height, variant.bandwidth))
            })
            .min_by_key(|(_, height, bandwidth)| (*height, *bandwidth))
            .map(|(index, _, _)| index);
        if let Some(index) = lowest {
            return Some(variants.swap_remove(index));
        }
    }
    variants.into_iter().max_by_key(|variant| variant.bandwidth)
}

fn looks_like_hls(body: &[u8]) -> bool {
    body.iter()
        .copied()
        .skip_while(u8::is_ascii_whitespace)
        .take(7)
        .eq(b"#EXTM3U".iter().copied())
}

fn looks_like_document(body: &[u8]) -> bool {
    let prefix = body
        .iter()
        .copied()
        .skip_while(u8::is_ascii_whitespace)
        .take(64)
        .collect::<Vec<_>>();
    let lower = String::from_utf8_lossy(&prefix).to_ascii_lowercase();
    lower.starts_with("<!doctype html")
        || lower.starts_with("<html")
        || lower.starts_with("<head")
        || lower.starts_with("<body")
        || lower.starts_with("<?xml")
}

fn invalid_progressive_content_type(value: &str) -> bool {
    let mime = value
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    mime.starts_with("text/")
        || mime == "application/json"
        || mime == "application/xml"
        || mime == "application/dash+xml"
        || mime == "application/vnd.apple.mpegurl"
        || mime == "application/x-mpegurl"
}

/// Parse `Content-Range: bytes START-END/TOTAL` (or `bytes */TOTAL` on 416).
/// The first tuple item is absent for the unsatisfied-range form.
fn parse_content_range(value: &str) -> Option<(Option<u64>, u64)> {
    let value = value.trim().strip_prefix("bytes ")?;
    let (range, total) = value.split_once('/')?;
    let total = total.parse::<u64>().ok()?;
    if range == "*" {
        return Some((None, total));
    }
    let (start, end) = range.split_once('-')?;
    let start = start.parse::<u64>().ok()?;
    let end = end.parse::<u64>().ok()?;
    (start <= end && end < total).then_some((Some(start), total))
}

/// Decide how a response to a resume request may touch the existing partial file.
/// A 200 means the server ignored Range, so the file must be truncated before its
/// body is consumed. A 206 is append-safe only when Content-Range starts exactly
/// where the local file ends. A 416 is complete only when both totals agree.
fn classify_resume_response(
    received: u64,
    status: StatusCode,
    content_range: Option<&str>,
    content_length: Option<u64>,
) -> Result<ResumeResponse, String> {
    let parsed_range = content_range.and_then(parse_content_range);
    if received == 0 {
        if !status.is_success() {
            return Err(format!("Download failed (HTTP {}).", status.as_u16()));
        }
        if status == StatusCode::PARTIAL_CONTENT && !matches!(parsed_range, Some((Some(0), _))) {
            return Err("Initial partial response is missing a valid Content-Range header.".into());
        }
        let total = parsed_range.map(|(_, total)| total).or(content_length);
        return Ok(ResumeResponse::Append { total });
    }
    match status {
        StatusCode::PARTIAL_CONTENT => match parsed_range {
            Some((Some(start), total)) if start == received => {
                Ok(ResumeResponse::Append { total: Some(total) })
            }
            Some((Some(start), _)) => Err(format!(
                "Resume response starts at byte {start}, expected {received}."
            )),
            _ => Err("Resume response is missing a valid Content-Range header.".into()),
        },
        StatusCode::OK => Ok(ResumeResponse::Restart {
            total: content_length,
        }),
        StatusCode::RANGE_NOT_SATISFIABLE => match parsed_range {
            Some((None, total)) if total == received => Ok(ResumeResponse::Complete),
            _ => Ok(ResumeResponse::Restart { total: None }),
        },
        _ if status.is_success() => Err(format!(
            "Download server returned HTTP {} for a resume request.",
            status.as_u16()
        )),
        _ => Err(format!("Download failed (HTTP {}).", status.as_u16())),
    }
}

/// The default download root: `<app_data_dir>/downloads` (created if missing).
#[tauri::command]
pub fn download_dir_default(app: AppHandle) -> Result<String, String> {
    let d = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("downloads");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d.to_string_lossy().into_owned())
}

/// Stream `url` to `<dir>/<filename>`. Resolves when the file is fully written (or
/// paused). Progress arrives via `download-progress` events. Resumes an existing
/// `.part` via a Range request.
#[tauri::command]
pub async fn download_start(
    app: AppHandle,
    id: String,
    url: String,
    dir: String,
    filename: String,
    // Extension-sourced files can be gated on request headers (Referer/Origin); a headerless GET
    // gets a 403 for a URL the player streams fine. Optional — debrid links need none.
    headers: Option<std::collections::HashMap<String, String>>,
    // Adaptive sources must be expanded into their media segments. Treating the manifest as an
    // ordinary file is how a ~25 KB playlist was previously reported as a completed episode.
    hls: Option<bool>,
    preferred_height: Option<u32>,
    state: tauri::State<'_, Downloads>,
) -> Result<String, String> {
    // Guard: never run two streams for the same id. A second call (e.g. a re-pump
    // or a dev HMR requeue) would append to the same .part concurrently and emit an
    // interleaved second byte counter — which is exactly the "progress bar yanks
    // between 5–20%" bug. Bail out benignly; the in-flight stream keeps going.
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
        if map.contains_key(&id) {
            return Ok("already-running".into());
        }
        map.insert(id.clone(), cancel.clone());
    }
    // Run the transfer, then ALWAYS drop the job from the registry — done, paused, OR error — so a
    // failed download can be retried. (The old code left the id registered on a stream error, and
    // the guard above then silently swallowed every retry as "already-running".)
    let out = if hls.unwrap_or(false) {
        run_hls_download(
            &app,
            &id,
            &url,
            &dir,
            &filename,
            &headers,
            preferred_height,
            &cancel,
        )
        .await
    } else {
        run_download(&app, &id, &url, &dir, &filename, &headers, &cancel).await
    };
    if let Ok(mut map) = state.0.lock() {
        map.remove(&id);
    }
    out
}

fn request_with_headers(
    url: &str,
    headers: &Option<HashMap<String, String>>,
) -> reqwest::RequestBuilder {
    let mut request = crate::download_http_client().get(url);
    if let Some(headers) = headers {
        for (name, value) in headers {
            request = request.header(name, value);
        }
    }
    request
}

async fn fetch_hls_manifest(
    url: &Url,
    headers: &Option<HashMap<String, String>>,
) -> Result<(Url, String), String> {
    const MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;
    let response = request_with_headers(url.as_str(), headers)
        .send()
        .await
        .map_err(|error| format!("Could not fetch HLS playlist: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Could not fetch HLS playlist (HTTP {}).",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MANIFEST_BYTES as u64)
    {
        return Err("The HLS playlist response was unexpectedly large.".into());
    }
    let final_url = response.url().clone();
    let body = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read HLS playlist: {error}"))?;
    if body.len() > MAX_MANIFEST_BYTES {
        return Err("The HLS playlist response was unexpectedly large.".into());
    }
    if looks_like_document(&body) {
        return Err("The source returned a web page instead of an HLS playlist. Refresh the source and retry.".into());
    }
    let text = String::from_utf8(body.to_vec())
        .map_err(|_| "The HLS playlist was not valid UTF-8.".to_string())?;
    Ok((final_url, text))
}

async fn resolve_hls_resources(
    url: &str,
    headers: &Option<HashMap<String, String>>,
    preferred_height: Option<u32>,
) -> Result<Vec<Url>, String> {
    let mut current = Url::parse(url).map_err(|error| format!("Invalid HLS URL: {error}"))?;
    for _ in 0..5 {
        let (base, text) = fetch_hls_manifest(&current, headers).await?;
        match parse_hls_playlist(&base, &text)? {
            HlsPlaylist::Master(variants) => {
                current = choose_hls_variant(variants, preferred_height)
                    .ok_or_else(|| {
                        "The HLS master playlist contained no playable variants.".to_string()
                    })?
                    .url;
            }
            HlsPlaylist::Media(resources) => return Ok(resources),
        }
    }
    Err("The HLS playlist redirected through too many nested manifests.".into())
}

async fn fetch_hls_resource(
    url: &Url,
    headers: &Option<HashMap<String, String>>,
) -> Result<Vec<u8>, String> {
    const MAX_SEGMENT_BYTES: usize = 128 * 1024 * 1024;
    const MAX_RETRIES: u32 = 4;
    let mut attempt = 0;
    loop {
        let response = match request_with_headers(url.as_str(), headers).send().await {
            Ok(response) if response.status().is_success() => response,
            Ok(_response) if attempt < MAX_RETRIES => {
                attempt += 1;
                tokio::time::sleep(std::time::Duration::from_millis(350 * attempt as u64)).await;
                continue;
            }
            Ok(response) => {
                return Err(format!(
                    "HLS segment failed (HTTP {}) after retries.",
                    response.status().as_u16()
                ));
            }
            Err(_) if attempt < MAX_RETRIES => {
                attempt += 1;
                tokio::time::sleep(std::time::Duration::from_millis(350 * attempt as u64)).await;
                continue;
            }
            Err(error) => return Err(format!("Could not fetch HLS segment: {error}")),
        };
        if response
            .content_length()
            .is_some_and(|length| length > MAX_SEGMENT_BYTES as u64)
        {
            return Err("An HLS segment was unexpectedly large.".into());
        }
        let body = response
            .bytes()
            .await
            .map_err(|error| format!("Could not read HLS segment: {error}"))?;
        if body.len() > MAX_SEGMENT_BYTES {
            return Err("An HLS segment was unexpectedly large.".into());
        }
        if body.is_empty() {
            return Err("The source returned an empty HLS segment.".into());
        }
        if looks_like_hls(&body) || looks_like_document(&body) {
            return Err(
                "The source returned a playlist or web page where a video segment was expected."
                    .into(),
            );
        }
        return Ok(body.to_vec());
    }
}

async fn run_hls_download(
    app: &AppHandle,
    id: &str,
    url: &str,
    dir: &str,
    filename: &str,
    headers: &Option<HashMap<String, String>>,
    preferred_height: Option<u32>,
    cancel: &Arc<AtomicBool>,
) -> Result<String, String> {
    let resources = resolve_hls_resources(url, headers, preferred_height).await?;
    if cancel.load(Ordering::Relaxed) {
        let _ = app.emit("download-paused", (id, 0_u64));
        return Ok("paused".into());
    }

    let dir = std::path::PathBuf::from(dir);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| error.to_string())?;
    let final_path = dir.join(sanitize(filename));
    let part = final_path.with_extension("part");
    // Segment boundaries are not recoverable from a raw partial file. A resumed HLS job therefore
    // restarts cleanly rather than appending a second copy of the opening segments.
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&part)
        .await
        .map_err(|error| error.to_string())?;
    let mut received = 0_u64;
    let mut last_emit = Instant::now();
    let mut last_bytes = 0_u64;

    let resource_count = resources.len() as u64;
    let mut completed_resources = 0_u64;
    for resource in resources {
        if cancel.load(Ordering::Relaxed) {
            let _ = file.flush().await;
            let _ = app.emit("download-paused", (id, received));
            return Ok("paused".into());
        }
        let bytes = fetch_hls_resource(&resource, headers).await?;
        if cancel.load(Ordering::Relaxed) {
            let _ = file.flush().await;
            let _ = app.emit("download-paused", (id, received));
            return Ok("paused".into());
        }
        file.write_all(&bytes)
            .await
            .map_err(|error| error.to_string())?;
        received += bytes.len() as u64;
        completed_resources += 1;
        if last_emit.elapsed().as_millis() > 300 {
            let seconds = last_emit.elapsed().as_secs_f64().max(0.001);
            let speed = ((received - last_bytes) as f64 / seconds) as u64;
            // HLS has no aggregate Content-Length. The running mean segment size gives the UI a
            // useful, converging total/ETA without prefetching every segment twice via HEAD.
            let estimated_total = received
                .saturating_mul(resource_count)
                .checked_div(completed_resources)
                .unwrap_or(received)
                .max(received);
            let _ = app.emit("download-progress", (id, received, estimated_total, speed));
            last_emit = Instant::now();
            last_bytes = received;
        }
    }
    if received == 0 {
        return Err("The HLS source produced no episode data.".into());
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);
    tokio::fs::rename(&part, &final_path)
        .await
        .map_err(|error| error.to_string())?;
    let path = final_path.to_string_lossy().into_owned();
    let _ = app.emit("download-done", (id, path.clone(), received));
    Ok(path)
}

async fn run_download(
    app: &AppHandle,
    id: &str,
    url: &str,
    dir: &str,
    filename: &str,
    headers: &Option<std::collections::HashMap<String, String>>,
    cancel: &Arc<AtomicBool>,
) -> Result<String, String> {
    let dir = std::path::PathBuf::from(dir);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let final_path = dir.join(sanitize(filename));
    let part = final_path.with_extension("part");

    // Append to (or create) the .part; `received` = what we already have on disk (prior-session
    // resume). The download client has NO total timeout — only a per-read idle timeout — so a
    // multi-GB 4K file isn't aborted mid-transfer.
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&part)
        .await
        .map_err(|e| e.to_string())?;
    let mut received = tokio::fs::metadata(&part)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    let mut total: u64 = 0;
    let mut last_emit = Instant::now();
    let mut last_bytes = received;

    // Resilient transfer: a big debrid file can still hit a mid-stream reset / idle timeout. Flush
    // what we have and resume from `received` via a Range request. The budget is CONSECUTIVE failures
    // without progress (any received chunk resets it), so a long download with the odd hiccup keeps
    // going, but a truly stuck one gives up.
    const MAX_RETRIES: u32 = 6;
    let mut attempt: u32 = 0;
    loop {
        let mut req = crate::download_http_client().get(url);
        if let Some(h) = headers {
            for (k, v) in h {
                req = req.header(k, v);
            }
        }
        if received > 0 {
            req = req.header("Range", format!("bytes={received}-"));
        }
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                if attempt < MAX_RETRIES && !cancel.load(Ordering::Relaxed) {
                    attempt += 1;
                    tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64))
                        .await;
                    continue;
                }
                return Err(e.to_string());
            }
        };
        let status = resp.status();
        let content_length = resp.content_length();
        let content_type = resp
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let content_range = resp
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok());
        match classify_resume_response(received, status, content_range, content_length)? {
            ResumeResponse::Complete => break,
            ResumeResponse::Restart {
                total: response_total,
            } => {
                // The server ignored Range (200), or rejected a stale/oversized partial (416).
                // Truncate before consuming a 200 body; for 416, retry once without Range.
                file.set_len(0).await.map_err(|e| e.to_string())?;
                received = 0;
                total = response_total.unwrap_or(0);
                last_bytes = 0;
                last_emit = Instant::now();
                if status == StatusCode::RANGE_NOT_SATISFIABLE {
                    continue;
                }
            }
            ResumeResponse::Append {
                total: response_total,
            } => {
                if total == 0 {
                    total = response_total
                        .or_else(|| content_length.map(|length| length + received))
                        .unwrap_or(0);
                }
            }
        }

        if received == 0 && invalid_progressive_content_type(&content_type) {
            file.set_len(0).await.map_err(|error| error.to_string())?;
            drop(file);
            let _ = tokio::fs::remove_file(&part).await;
            return if content_type.to_ascii_lowercase().contains("mpegurl") {
                Err("The source returned an HLS playlist instead of a video file. Retry after refreshing the source.".into())
            } else {
                Err(format!(
                    "The source returned {content_type} instead of episode media. Refresh the source and retry."
                ))
            };
        }

        let mut stream = resp.bytes_stream();
        let mut inspect_first_chunk = received == 0;
        let mut interrupted = false;
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                let _ = file.flush().await;
                let _ = app.emit("download-paused", (id, received));
                return Ok("paused".into()); // .part kept for resume
            }
            match chunk {
                Ok(bytes) => {
                    if inspect_first_chunk {
                        inspect_first_chunk = false;
                        if looks_like_hls(&bytes) || looks_like_document(&bytes) {
                            drop(stream);
                            file.set_len(0).await.map_err(|error| error.to_string())?;
                            drop(file);
                            let _ = tokio::fs::remove_file(&part).await;
                            return if looks_like_hls(&bytes) {
                                Err("The source returned an HLS playlist instead of a video file. Retry after refreshing the source.".into())
                            } else {
                                Err("The source returned a web page instead of episode media. Refresh the source and retry.".into())
                            };
                        }
                    }
                    file.write_all(&bytes).await.map_err(|e| e.to_string())?;
                    received += bytes.len() as u64;
                    attempt = 0; // progress → reset the retry budget
                    if last_emit.elapsed().as_millis() > 300 {
                        let secs = last_emit.elapsed().as_secs_f64().max(0.001);
                        let speed = ((received - last_bytes) as f64 / secs) as u64;
                        let _ = app.emit("download-progress", (id, received, total, speed));
                        last_emit = Instant::now();
                        last_bytes = received;
                    }
                }
                Err(e) => {
                    // Mid-stream body error (connection drop / idle timeout) → resume below.
                    let _ = file.flush().await;
                    if attempt < MAX_RETRIES && !cancel.load(Ordering::Relaxed) {
                        interrupted = true;
                        break;
                    }
                    return Err(e.to_string());
                }
            }
        }
        if interrupted {
            attempt += 1;
            tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
            continue;
        }
        // Stream ended cleanly. Done if we have the whole file (or the length was unknown);
        // otherwise the server closed early → resume.
        if total == 0 || received >= total {
            break;
        }
        if attempt < MAX_RETRIES && !cancel.load(Ordering::Relaxed) {
            attempt += 1;
            tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
            continue;
        }
        return Err("Download ended before the full file arrived.".into());
    }

    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(&part, &final_path)
        .await
        .map_err(|e| e.to_string())?;
    let fp = final_path.to_string_lossy().into_owned();
    let _ = app.emit("download-done", (id, fp.clone(), received));
    Ok(fp)
}

/// Stop an in-flight download. `delete_part=true` (cancel) removes the partial;
/// `false` (pause) keeps it so a later `download_start` resumes.
#[tauri::command]
pub fn download_cancel(
    id: String,
    delete_part: bool,
    dir: String,
    filename: String,
    state: tauri::State<'_, Downloads>,
) -> Result<(), String> {
    if let Some(f) = state.0.lock().map_err(|e| e.to_string())?.remove(&id) {
        f.store(true, Ordering::Relaxed);
    }
    if delete_part {
        let p = std::path::PathBuf::from(&dir)
            .join(sanitize(&filename))
            .with_extension("part");
        let _ = std::fs::remove_file(p);
    }
    Ok(())
}

/// Delete a completed downloaded file.
#[tauri::command]
pub fn download_delete(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Reveal a downloaded file in the OS file manager (uses the opener plugin).
#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_satisfied_and_unsatisfied_content_ranges() {
        assert_eq!(
            parse_content_range("bytes 50-99/100"),
            Some((Some(50), 100))
        );
        assert_eq!(parse_content_range("bytes */100"), Some((None, 100)));
        assert_eq!(parse_content_range("bytes 100-50/100"), None);
    }

    #[test]
    fn restarts_when_a_server_ignores_range() {
        assert_eq!(
            classify_resume_response(50, StatusCode::OK, None, Some(100)).unwrap(),
            ResumeResponse::Restart { total: Some(100) },
        );
    }

    #[test]
    fn appends_only_when_partial_content_starts_at_local_length() {
        assert_eq!(
            classify_resume_response(
                50,
                StatusCode::PARTIAL_CONTENT,
                Some("bytes 50-99/100"),
                Some(50),
            )
            .unwrap(),
            ResumeResponse::Append { total: Some(100) },
        );
        assert!(classify_resume_response(
            50,
            StatusCode::PARTIAL_CONTENT,
            Some("bytes 40-99/100"),
            Some(60),
        )
        .is_err());
    }

    #[test]
    fn accepts_416_only_when_the_partial_is_complete() {
        assert_eq!(
            classify_resume_response(
                100,
                StatusCode::RANGE_NOT_SATISFIABLE,
                Some("bytes */100"),
                Some(0),
            )
            .unwrap(),
            ResumeResponse::Complete,
        );
        assert_eq!(
            classify_resume_response(
                80,
                StatusCode::RANGE_NOT_SATISFIABLE,
                Some("bytes */100"),
                Some(0),
            )
            .unwrap(),
            ResumeResponse::Restart { total: None },
        );
    }

    #[test]
    fn parses_hls_media_resources_and_relative_initialization_segments() {
        let base = Url::parse("https://cdn.example/show/720/index.m3u8?token=one").unwrap();
        let playlist = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:6,\nseg-1.m4s\n#EXTINF:6,\n../seg-2.m4s?x=1\n#EXT-X-ENDLIST\n";
        let HlsPlaylist::Media(resources) = parse_hls_playlist(&base, playlist).unwrap() else {
            panic!("expected media playlist");
        };
        assert_eq!(
            resources.iter().map(Url::as_str).collect::<Vec<_>>(),
            vec![
                "https://cdn.example/show/720/init.mp4",
                "https://cdn.example/show/720/seg-1.m4s",
                "https://cdn.example/show/seg-2.m4s?x=1",
            ]
        );
    }

    #[test]
    fn selects_the_best_hls_variant_within_the_requested_height() {
        let base = Url::parse("https://cdn.example/master.m3u8").unwrap();
        let playlist = "#EXTM3U\n\
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480\n480/index.m3u8\n\
#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720\n720/index.m3u8\n\
#EXT-X-STREAM-INF:BANDWIDTH=4200000,RESOLUTION=1920x1080\n1080/index.m3u8\n";
        let HlsPlaylist::Master(variants) = parse_hls_playlist(&base, playlist).unwrap() else {
            panic!("expected master playlist");
        };
        let chosen = choose_hls_variant(variants, Some(720)).unwrap();
        assert_eq!(chosen.height, Some(720));
        assert_eq!(chosen.url.as_str(), "https://cdn.example/720/index.m3u8");
    }

    #[test]
    fn rejects_encrypted_or_document_responses_instead_of_marking_them_complete() {
        let base = Url::parse("https://cdn.example/index.m3u8").unwrap();
        let encrypted = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:6,\nseg.ts\n";
        assert!(parse_hls_playlist(&base, encrypted)
            .unwrap_err()
            .contains("encrypted"));
        assert!(invalid_progressive_content_type("text/html; charset=utf-8"));
        assert!(invalid_progressive_content_type(
            "application/vnd.apple.mpegurl"
        ));
        assert!(looks_like_document(
            b"  <!DOCTYPE html><title>Cloudflare</title>"
        ));
        assert!(looks_like_hls(b"\n#EXTM3U\n#EXTINF:6,"));
        assert!(!looks_like_document(b"\x47video transport stream"));
    }

    #[test]
    fn sanitize_replaces_illegal_path_chars() {
        assert_eq!(sanitize("a/b\\c:d*e?f\"g<h>i|j"), "a_b_c_d_e_f_g_h_i_j");
        assert_eq!(sanitize("Fine Name [1080p].mkv"), "Fine Name [1080p].mkv");
    }

    #[cfg(windows)]
    #[test]
    fn sanitize_neutralizes_windows_reserved_device_names() {
        // Reserved device stems map to the device regardless of extension → prefixed.
        assert_eq!(sanitize("NUL.mkv"), "_NUL.mkv");
        assert_eq!(sanitize("con"), "_con");
        assert_eq!(sanitize("COM1.mp4"), "_COM1.mp4");
        // A trailing dot/space (silently stripped by Windows) is removed.
        assert_eq!(sanitize("episode.mkv. "), "episode.mkv");
        // Non-reserved names that merely contain a device substring are left alone.
        assert_eq!(sanitize("NULL.mkv"), "NULL.mkv");
        assert_eq!(sanitize("console.log"), "console.log");
        // Degenerate results collapse to a safe placeholder.
        assert_eq!(sanitize(".."), "_");
    }
}
