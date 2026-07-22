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
use reqwest::{header::CONTENT_RANGE, StatusCode};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

/// In-flight download cancel flags, keyed by job id. Setting a flag aborts that
/// job's chunk loop on its next iteration.
#[derive(Default)]
pub struct Downloads(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

fn sanitize(name: &str) -> String {
    #[allow(unused_mut)]
    let mut s: String = name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c })
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
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
                | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9"
                | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
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
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("downloads");
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
    let out = run_download(&app, &id, &url, &dir, &filename, &cancel).await;
    if let Ok(mut map) = state.0.lock() {
        map.remove(&id);
    }
    out
}

async fn run_download(
    app: &AppHandle,
    id: &str,
    url: &str,
    dir: &str,
    filename: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<String, String> {
    let dir = std::path::PathBuf::from(dir);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
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
    let mut received = tokio::fs::metadata(&part).await.map(|m| m.len()).unwrap_or(0);
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
        if received > 0 {
            req = req.header("Range", format!("bytes={received}-"));
        }
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                if attempt < MAX_RETRIES && !cancel.load(Ordering::Relaxed) {
                    attempt += 1;
                    tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
                    continue;
                }
                return Err(e.to_string());
            }
        };
        let status = resp.status();
        let content_length = resp.content_length();
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

        let mut stream = resp.bytes_stream();
        let mut interrupted = false;
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                let _ = file.flush().await;
                let _ = app.emit("download-paused", (id, received));
                return Ok("paused".into()); // .part kept for resume
            }
            match chunk {
                Ok(bytes) => {
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
    tokio::fs::rename(&part, &final_path).await.map_err(|e| e.to_string())?;
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
        let p = std::path::PathBuf::from(&dir).join(sanitize(&filename)).with_extension("part");
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
