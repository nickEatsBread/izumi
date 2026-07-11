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
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

/// In-flight download cancel flags, keyed by job id. Setting a flag aborts that
/// job's chunk loop on its next iteration.
#[derive(Default)]
pub struct Downloads(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c })
        .collect()
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
        // 416 Range Not Satisfiable on a resume = the .part already holds the whole file → finish.
        if status.as_u16() == 416 && received > 0 {
            break;
        }
        if !status.is_success() {
            return Err(format!("Download failed (HTTP {}).", status.as_u16()));
        }
        if total == 0 {
            total = resp.content_length().map(|l| l + received).unwrap_or(0);
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
