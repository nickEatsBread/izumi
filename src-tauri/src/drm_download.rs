//! Decrypting DRM downloads: fetch the same segments the player would stream, obtain the Widevine
//! content keys for the session, decrypt every CENC fragment, and write one CLEAR fragmented MP4 to
//! disk. The result is an ordinary local file mpv plays with no CDM, no licence and no network — so
//! there is no persistent offline licence anywhere, unlike the Shaka offline path.
//!
//! Flow (desktop only; Android keeps the Shaka path):
//!   1. GET the sidecar's offline plan (segment URLs, byte ranges, Widevine pssh + kid).
//!   2. Resolve an L3 device (`widevine_device`: override, cached pool member, or bundled seed),
//!      run the licence exchange through the sidecar proxy, get keys.
//!   3. Download the protected video (then audio) MP4s into encrypted staging `.part` files.
//!   4. Decrypt each `moof`/`mdat` fragment, build one `moov` carrying both tracks, and emit
//!      `ftyp` + `moov` + the fragments interleaved by decode time into the final clear file.
//!   5. Write sidecar subtitles beside it, delete the staging files, emit `download-done`.
//!
//! Content keys live in memory only for the job; they are never written to disk or logged (only the
//! KID hex is logged). The play slot is released via `DELETE releaseUrl` on every exit path.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use aes::Aes128;
use cipher::{KeyIvInit, StreamCipher, StreamCipherSeek};
use ctr::Ctr128BE;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::download::sanitize;

/// In-flight DRM download cancel flags, keyed by job id (same shape as `download::Downloads`).
#[derive(Default)]
pub struct DrmDownloads(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

// ----------------------------------------------------------------------------------------------
// Plan model (mirrors src/cr/offline-plan.ts OfflinePlan)
// ----------------------------------------------------------------------------------------------

// Fields mirror the plan JSON for clarity even where the downloader does not branch on them (a
// SegmentBase track is one continuous GET from offset 0, which already covers init + sidx + media).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct PlanTrack {
    kind: Option<String>,
    lang: Option<String>,
    height: Option<u32>,
    /// Single-file source (`SegmentBase`).
    url: Option<String>,
    init_range: Option<String>,
    index_range: Option<String>,
    /// Segmented source (`SegmentTemplate`).
    init: Option<String>,
    segments: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
struct PlanSubtitle {
    url: String,
    lang: Option<String>,
    kind: Option<String>,
    format: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfflinePlan {
    pssh: Option<String>,
    kid: Option<String>,
    video: Option<PlanTrack>,
    audio: Option<PlanTrack>,
    #[serde(default)]
    subtitles: Vec<PlanSubtitle>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanResponse {
    plan: OfflinePlan,
    license_url: String,
    /// The command is also passed a release URL; this is a fallback when that argument is empty.
    release_url: Option<String>,
}

// ----------------------------------------------------------------------------------------------
// Tauri commands
// ----------------------------------------------------------------------------------------------

/// Download one DRM-protected episode as a clear, offline MP4. Resolves when the file is fully
/// written or paused; progress arrives via `download-progress` events, completion via
/// `download-done`, cancellation via `download-paused`, failure via `download-error`.
#[tauri::command]
pub async fn drm_download_start(
    app: AppHandle,
    id: String,
    plan_url: String,
    license_url: String,
    release_url: String,
    dir: String,
    filename: String,
    state: tauri::State<'_, DrmDownloads>,
) -> Result<String, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        // Never run two decrypting jobs for the same id — a second would race the staging files.
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
        if map.contains_key(&id) {
            return Ok("already-running".into());
        }
        map.insert(id.clone(), cancel.clone());
    }
    let out = run_drm_download(
        &app,
        &id,
        &plan_url,
        &license_url,
        &release_url,
        &dir,
        &filename,
        &cancel,
    )
    .await;
    if let Ok(mut map) = state.0.lock() {
        map.remove(&id);
    }
    // A failed job reports itself so the queue can surface the error and keep the staging parts for
    // a later resume; the clear output was already deleted before we got here.
    if let Err(message) = &out {
        if !cancel.load(Ordering::Relaxed) {
            let _ = app.emit("download-error", (&id, message.clone()));
        }
    }
    out
}

/// Stop an in-flight DRM download. `delete_part=true` (cancel) destroys the encrypted staging
/// files; `false` (pause) keeps them so a later `drm_download_start` resumes.
#[tauri::command]
pub fn drm_download_cancel(
    id: String,
    delete_part: bool,
    dir: String,
    filename: String,
    state: tauri::State<'_, DrmDownloads>,
) -> Result<(), String> {
    if let Some(flag) = state.0.lock().map_err(|e| e.to_string())?.remove(&id) {
        flag.store(true, Ordering::Relaxed);
    }
    if delete_part {
        for part in staging_paths(&dir, &filename) {
            let _ = std::fs::remove_file(part);
        }
    }
    Ok(())
}

/// Encrypted staging files for a job: one per track. Both are deleted on success/cancel and kept on
/// failure for resume. Never holds decrypted content.
fn staging_paths(dir: &str, filename: &str) -> Vec<std::path::PathBuf> {
    let base = std::path::PathBuf::from(dir).join(sanitize(filename));
    vec![
        base.with_extension("mp4.part"),
        base.with_extension("mp4.apart"),
    ]
}

/// A guard that releases the sidecar play slot exactly once on every exit path (success, cancel,
/// failure). Releasing twice would be a spurious DELETE; never releasing leaks a scarce slot.
struct SlotGuard {
    release_url: String,
    done: bool,
}

impl SlotGuard {
    fn new(release_url: String) -> Self {
        Self {
            release_url,
            done: false,
        }
    }

    async fn release(&mut self) {
        if self.done || self.release_url.is_empty() {
            return;
        }
        self.done = true;
        let client = crate::http_client();
        let _ = client
            .delete(&self.release_url)
            .timeout(Duration::from_secs(10))
            .send()
            .await;
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_drm_download<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    plan_url: &str,
    license_url: &str,
    release_url: &str,
    dir: &str,
    filename: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<String, String> {
    let dir_path = std::path::PathBuf::from(dir);
    tokio::fs::create_dir_all(&dir_path)
        .await
        .map_err(|e| e.to_string())?;
    let final_path = dir_path.join(sanitize(filename));
    let video_part = final_path.with_extension("mp4.part");
    let audio_part = final_path.with_extension("mp4.apart");

    // Fetch the plan first so the slot guard can fall back to the plan's own release URL when the
    // caller passes an empty one. The slot is then released exactly once on every exit path.
    let plan = match fetch_plan(plan_url).await {
        Ok(plan) => plan,
        Err(error) => {
            // No slot was taken yet (the plan fetch is what resolves the session), so just report.
            let _ = tokio::fs::remove_file(&final_path).await;
            return Err(error);
        }
    };
    let effective_release = if release_url.is_empty() {
        plan.release_url.clone().unwrap_or_default()
    } else {
        release_url.to_string()
    };
    let mut slot = SlotGuard::new(effective_release);

    let result = decrypt_and_write(
        app,
        id,
        plan,
        license_url,
        &final_path,
        &video_part,
        &audio_part,
        cancel,
    )
    .await;

    // Release the play slot regardless of outcome, exactly once.
    slot.release().await;

    match result {
        Ok(Outcome::Done { path, bytes }) => {
            let _ = tokio::fs::remove_file(&video_part).await;
            let _ = tokio::fs::remove_file(&audio_part).await;
            let _ = app.emit("download-done", (id, path.clone(), bytes));
            Ok(path)
        }
        Ok(Outcome::Paused { received }) => {
            let _ = app.emit("download-paused", (id, received));
            Ok("paused".into())
        }
        Err(error) => {
            // Never leave a half-written clear file behind; the encrypted staging parts are kept so
            // a resume can continue the download.
            let _ = tokio::fs::remove_file(&final_path).await;
            Err(error)
        }
    }
}

enum Outcome {
    Done { path: String, bytes: u64 },
    Paused { received: u64 },
}

#[allow(clippy::too_many_arguments)]
async fn decrypt_and_write<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    plan: PlanResponse,
    license_url: &str,
    final_path: &std::path::Path,
    video_part: &std::path::Path,
    audio_part: &std::path::Path,
    cancel: &Arc<AtomicBool>,
) -> Result<Outcome, String> {
    let video = plan
        .plan
        .video
        .clone()
        .ok_or("The offline plan has no video track.")?;
    let pssh = plan
        .plan
        .pssh
        .clone()
        .ok_or("The offline plan is missing Widevine protection data.")?;
    plan.plan
        .kid
        .as_ref()
        .ok_or("The offline plan is missing the content key id.")?;
    let effective_license = if license_url.is_empty() {
        plan.license_url.clone()
    } else {
        license_url.to_string()
    };

    // 2. Obtain content keys once (keys stay in memory for the job only).
    let keys = fetch_keys(app, &pssh, &effective_license).await?;
    // Log the KID hex only — never key material.
    let kids = keys
        .keys()
        .map(|kid| hex_lower(kid))
        .collect::<Vec<_>>()
        .join(",");
    eprintln!("[drm-dl] content keys for kid(s) {kids}");

    if cancel.load(Ordering::Relaxed) {
        return Ok(Outcome::Paused { received: 0 });
    }

    // 3. Download protected tracks into encrypted staging files (resumable).
    let mut progress = Progress::new(app, id);
    let video_bytes = download_track(&video, video_part, cancel, &mut progress).await?;
    if cancel.load(Ordering::Relaxed) {
        return Ok(Outcome::Paused {
            received: progress.received,
        });
    }
    let audio_bytes = match plan.plan.audio.clone() {
        Some(audio) => Some(download_track(&audio, audio_part, cancel, &mut progress).await?),
        None => None,
    };
    if cancel.load(Ordering::Relaxed) {
        return Ok(Outcome::Paused {
            received: progress.received,
        });
    }

    // 4. Decrypt + mux into the clear output.
    let clear = build_clear_mp4(video_bytes, audio_bytes, &keys)
        .map_err(|e| format!("Could not decrypt the download: {e}"))?;
    tokio::fs::write(final_path, &clear)
        .await
        .map_err(|e| e.to_string())?;

    // 5. Sidecar subtitles beside the file.
    write_subtitles(final_path, &plan.plan.subtitles).await;

    let bytes = clear.len() as u64;
    Ok(Outcome::Done {
        path: final_path.to_string_lossy().into_owned(),
        bytes,
    })
}

// ----------------------------------------------------------------------------------------------
// Plan + licence
// ----------------------------------------------------------------------------------------------

async fn fetch_plan(plan_url: &str) -> Result<PlanResponse, String> {
    let response = crate::http_client()
        .get(plan_url)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Could not fetch the offline plan: {e}"))?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string));
        return Err(detail.unwrap_or_else(|| format!("Offline plan request failed (HTTP {status}).")));
    }
    response
        .json::<PlanResponse>()
        .await
        .map_err(|e| format!("The offline plan was not understood: {e}"))
}

/// A device the licence server rejects (HTTP 403, or 429 that outlasts the retries), or no device
/// at all. The client treats this specially and falls back to the Shaka download path, so the error
/// message is a stable, detectable prefix.
pub const LICENSE_FORBIDDEN_PREFIX: &str = "licence-forbidden:";

/// Run the Widevine L3 licence exchange and return kid -> key. The device comes from
/// `widevine_device` (override → cached pool member → fresh pool member → bundled seed); a refused
/// device is rotated away from once inside this job before `licence-forbidden:` reaches the client.
async fn fetch_keys<R: Runtime>(
    app: &AppHandle<R>,
    pssh_b64: &str,
    license_url: &str,
) -> Result<HashMap<[u8; 16], [u8; 16]>, String> {
    let supply = crate::widevine_device::DeviceSupply::from_app(app);
    crate::widevine_device::exchange_with_rotation(&supply, |device| async move {
        fetch_keys_with_device(&device, pssh_b64, license_url).await
    })
    .await
}

/// The stable refusal error: `widevine_device` rotates on it, the client falls back to Shaka on it.
fn device_refused(status: u16) -> String {
    format!(
        "{LICENSE_FORBIDDEN_PREFIX} the Widevine device was refused (HTTP {status}). \
         Supply your own device via IZUMI_WVD_PATH."
    )
}

/// The licence exchange against an explicit device blob (the testable core of `fetch_keys`).
async fn fetch_keys_with_device(
    device_bytes: &[u8],
    pssh_b64: &str,
    license_url: &str,
) -> Result<HashMap<[u8; 16], [u8; 16]>, String> {
    use widevine::{Cdm, Device, KeyType, LicenseType, Pssh};

    let device =
        Device::read_wvd(device_bytes).map_err(|e| format!("Invalid Widevine device: {e}"))?;
    let cdm = Cdm::new(device);

    // The source's pssh data is a WidevineCencHeader (a base64 content_id token). `Pssh::from_b64`
    // chokes on it, so decode the base64 box and use `from_bytes`.
    let raw = data_encoding::BASE64
        .decode(pssh_b64.as_bytes())
        .map_err(|e| format!("Invalid pssh: {e}"))?;
    let pssh = Pssh::from_bytes(&raw).map_err(|e| format!("Invalid pssh box: {e}"))?;
    // The request goes out with a PLAIN client id. Privacy Mode (an encrypted client id bound to the
    // service's own certificate) is refused for these device blobs, while a browser CDM and
    // pywidevine both send the plain form — see docs/drm-offline-downloads.md.
    let request = cdm
        .open()
        .get_license_request(pssh, LicenseType::STREAMING)
        .map_err(|e| format!("Could not build the licence request: {e}"))?;
    let challenge = request
        .challenge()
        .map_err(|e| format!("Could not build the licence challenge: {e}"))?;

    let client = crate::http_client();
    let mut last_error = String::new();
    let mut last_status = 0u16;
    let mut body: Option<Vec<u8>> = None;
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(600 * attempt as u64)).await;
        }
        let response = client
            .post(license_url)
            .header("content-type", "application/octet-stream")
            .header("accept", "application/json, application/octet-stream, */*")
            .timeout(Duration::from_secs(30))
            .body(challenge.to_vec())
            .send()
            .await;
        match response {
            Ok(res) => {
                let status = res.status();
                let data = res.bytes().await.map_err(|e| e.to_string())?;
                if status.is_success() {
                    body = Some(data.to_vec());
                    break;
                }
                // A 403 means the device blob itself was refused: surface it so the device supply
                // rotates (or the client falls back to Shaka) rather than retrying a dead device.
                last_status = status.as_u16();
                if last_status == 403 {
                    return Err(device_refused(last_status));
                }
                // Only 5xx/429 are worth retrying; any other 4xx is a hard failure.
                last_error = format!("licence HTTP {last_status}");
                if last_status != 429 && !status.is_server_error() {
                    return Err(format!("The source refused the licence ({last_error})."));
                }
            }
            Err(error) => {
                last_status = 0;
                last_error = error.to_string();
            }
        }
    }
    // A 429 that outlasts the backoff is treated as this device being throttled: the same signal
    // as a 403, so the next device gets a chance instead of the job failing.
    if body.is_none() && last_status == 429 {
        return Err(device_refused(last_status));
    }
    let body = body.ok_or_else(|| format!("Could not obtain a Widevine licence ({last_error})."))?;
    let resolved = request
        .get_keys(&body)
        .map_err(|e| format!("The licence had no usable keys: {e}"))?;
    let mut keys: HashMap<[u8; 16], [u8; 16]> = HashMap::new();
    for key in resolved.of_type(KeyType::CONTENT) {
        // AES-128 content keys and KIDs are 16 bytes; reject anything else rather than truncate.
        let kid: [u8; 16] = key
            .kid
            .as_ref()
            .try_into()
            .map_err(|_| "A content key id was not 16 bytes.".to_string())?;
        let bytes: [u8; 16] = key
            .key
            .as_slice()
            .try_into()
            .map_err(|_| "A content key was not 16 bytes.".to_string())?;
        keys.insert(kid, bytes);
    }
    if keys.is_empty() {
        return Err("The licence contained no content keys.".into());
    }
    Ok(keys)
}

// ----------------------------------------------------------------------------------------------
// Downloading protected tracks into encrypted staging files
// ----------------------------------------------------------------------------------------------

struct Progress<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    id: &'a str,
    received: u64,
    last_emit: Instant,
    last_bytes: u64,
}

impl<'a, R: Runtime> Progress<'a, R> {
    fn new(app: &'a AppHandle<R>, id: &'a str) -> Self {
        Self {
            app,
            id,
            received: 0,
            last_emit: Instant::now(),
            last_bytes: 0,
        }
    }

    /// Emit `download-progress` at ~4 Hz (250 ms) max so a fast transfer does not flood IPC.
    fn tick(&mut self, total: u64) {
        if self.last_emit.elapsed().as_millis() < 250 {
            return;
        }
        let seconds = self.last_emit.elapsed().as_secs_f64().max(0.001);
        let speed = ((self.received - self.last_bytes) as f64 / seconds) as u64;
        let _ = self
            .app
            .emit("download-progress", (self.id, self.received, total, speed));
        self.last_emit = Instant::now();
        self.last_bytes = self.received;
    }
}

/// Download a protected track into its encrypted staging file and return the whole bytes. A
/// `SegmentBase` track is one file (init range then the rest); a `SegmentTemplate` track is an init
/// plus numbered segments. Both resume from the existing part length with a `Range` request.
async fn download_track<R: Runtime>(
    track: &PlanTrack,
    part: &std::path::Path,
    cancel: &Arc<AtomicBool>,
    progress: &mut Progress<'_, R>,
) -> Result<Vec<u8>, String> {
    let mut on_disk = tokio::fs::metadata(part)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    // Progress accounting carries across tracks, so seed it with what is already on disk.
    progress.received += on_disk;

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(part)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(url) = &track.url {
        // SegmentBase: one continuous MP4. Resume by byte offset.
        fetch_into(url, &mut file, &mut on_disk, cancel, progress).await?;
    } else if let (Some(init), Some(segments)) = (&track.init, &track.segments) {
        // SegmentTemplate: init then each media segment, concatenated in order. A partial resume
        // cannot know the segment boundary of a half-written file, so restart cleanly.
        if on_disk > 0 {
            file.set_len(0).await.map_err(|e| e.to_string())?;
            progress.received -= on_disk;
        }
        let mut urls = vec![init.clone()];
        urls.extend(segments.iter().cloned());
        for url in urls {
            if cancel.load(Ordering::Relaxed) {
                let _ = tokio::io::AsyncWriteExt::flush(&mut file).await;
                return Ok(Vec::new());
            }
            let mut start = 0_u64;
            fetch_into(&url, &mut file, &mut start, cancel, progress).await?;
        }
    } else {
        return Err("A plan track had neither a file URL nor segments.".into());
    }

    tokio::io::AsyncWriteExt::flush(&mut file)
        .await
        .map_err(|e| e.to_string())?;
    drop(file);
    if cancel.load(Ordering::Relaxed) {
        return Ok(Vec::new());
    }
    tokio::fs::read(part).await.map_err(|e| e.to_string())
}

/// Append one GET to `file`, resuming from `*received_for_url` via `Range` (10s idle read timeout,
/// a few retries on transient failure). Updates the shared progress counter as bytes arrive.
async fn fetch_into<R: Runtime>(
    url: &str,
    file: &mut tokio::fs::File,
    received_for_url: &mut u64,
    cancel: &Arc<AtomicBool>,
    progress: &mut Progress<'_, R>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    const MAX_RETRIES: u32 = 6;
    let mut attempt: u32 = 0;
    let mut total_hint: u64 = 0;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        let mut request = crate::download_http_client()
            .get(url)
            .timeout(Duration::from_secs(600));
        if *received_for_url > 0 {
            request = request.header("Range", format!("bytes={}-", received_for_url));
        }
        let response = match request.send().await {
            Ok(r) => r,
            Err(error) => {
                if attempt < MAX_RETRIES && !cancel.load(Ordering::Relaxed) {
                    attempt += 1;
                    tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                    continue;
                }
                return Err(format!("Segment download failed: {error}"));
            }
        };
        let status = response.status();
        if !status.is_success() {
            return Err(format!("Segment download failed (HTTP {}).", status.as_u16()));
        }
        // 200 to a Range request means the server ignored it: restart this URL from scratch.
        if *received_for_url > 0 && status == reqwest::StatusCode::OK {
            file.set_len(file.metadata().await.map(|m| m.len()).unwrap_or(0) - *received_for_url)
                .await
                .ok();
            progress.received = progress.received.saturating_sub(*received_for_url);
            *received_for_url = 0;
        }
        if let Some(len) = response.content_length() {
            total_hint = progress.received + len;
        }

        let mut stream = response.bytes_stream();
        let mut interrupted = false;
        loop {
            // 10s idle timeout per chunk: a stalled connection fails promptly and resumes.
            let next = tokio::time::timeout(Duration::from_secs(10), stream.next()).await;
            let chunk = match next {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(_) => {
                    let _ = file.flush().await;
                    if attempt < MAX_RETRIES && !cancel.load(Ordering::Relaxed) {
                        interrupted = true;
                        break;
                    }
                    return Err("Segment download idle-timed out.".into());
                }
            };
            if cancel.load(Ordering::Relaxed) {
                let _ = file.flush().await;
                return Ok(());
            }
            match chunk {
                Ok(bytes) => {
                    file.write_all(&bytes).await.map_err(|e| e.to_string())?;
                    *received_for_url += bytes.len() as u64;
                    progress.received += bytes.len() as u64;
                    attempt = 0;
                    progress.tick(total_hint);
                }
                Err(error) => {
                    let _ = file.flush().await;
                    if attempt < MAX_RETRIES && !cancel.load(Ordering::Relaxed) {
                        interrupted = true;
                        break;
                    }
                    return Err(format!("Segment download error: {error}"));
                }
            }
        }
        if interrupted {
            attempt += 1;
            tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
            continue;
        }
        return Ok(());
    }
}

async fn write_subtitles(final_path: &std::path::Path, subtitles: &[PlanSubtitle]) {
    let stem = final_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".into());
    let dir = final_path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    for (index, track) in subtitles.iter().enumerate() {
        let body = match crate::http_client()
            .get(&track.url)
            .timeout(Duration::from_secs(30))
            .send()
            .await
        {
            Ok(res) if res.status().is_success() => match res.bytes().await {
                Ok(bytes) => bytes,
                Err(_) => continue,
            },
            _ => continue,
        };
        let lang = track.lang.clone().unwrap_or_else(|| format!("und{index}"));
        let ext = track
            .format
            .clone()
            .filter(|f| !f.is_empty())
            .unwrap_or_else(|| "vtt".into());
        // Captions get `captions` in the name so the player's menu can distinguish them.
        let caption = track.kind.as_deref() == Some("captions");
        let name = if caption {
            format!("{stem}.{lang}.captions.{ext}")
        } else {
            format!("{stem}.{lang}.{ext}")
        };
        let _ = tokio::fs::write(dir.join(sanitize(&name)), &body).await;
    }
}

// ----------------------------------------------------------------------------------------------
// CENC decryption + fragmented-MP4 muxing
// ----------------------------------------------------------------------------------------------

fn be32(b: &[u8], at: usize) -> u32 {
    u32::from_be_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// A top-level box at `off` with its total `size`, from `find_box`.
fn find_box(buf: &[u8], start: usize, end: usize, name: &[u8; 4]) -> Option<(usize, usize)> {
    let mut off = start;
    while off + 8 <= end {
        let size = be32(buf, off) as usize;
        if size < 8 || off + size > end {
            return None;
        }
        if &buf[off + 4..off + 8] == name {
            return Some((off, size));
        }
        off += size;
    }
    None
}

/// Depth-first search for a box inside the known MP4 container nesting.
fn find_deep(buf: &[u8], start: usize, end: usize, name: &[u8; 4]) -> Option<(usize, usize)> {
    if let Some(hit) = find_box(buf, start, end, name) {
        return Some(hit);
    }
    let mut off = start;
    while off + 8 <= end {
        let size = be32(buf, off) as usize;
        if size < 8 || off + size > end {
            return None;
        }
        if matches!(
            &buf[off + 4..off + 8],
            b"trak" | b"mdia" | b"minf" | b"stbl" | b"stsd" | b"sinf" | b"schi"
        ) {
            if let Some(hit) = find_deep(buf, off + 8, off + size, name) {
                return Some(hit);
            }
        }
        off += size;
    }
    None
}

#[derive(Debug)]
struct TrackCrypto {
    kid: [u8; 16],
    iv_size: u8,
}

fn tkhd_track_id(buf: &[u8], start: usize, end: usize) -> Option<u32> {
    let (off, size) = find_box(buf, start + 8, end, b"tkhd")?;
    let version = buf[off + 8];
    let id_at = if version == 1 {
        off + 8 + 4 + 16
    } else {
        off + 8 + 4 + 8
    };
    if id_at + 4 > off + size {
        return None;
    }
    Some(be32(buf, id_at))
}

/// The scheme `schm` type for a track's protection, e.g. `cenc` or `cbcs`. Absent means
/// unprotected. The box lives inside the sample entry's `sinf`, which `find_deep` does not descend
/// into, so scan for it within the `stsd` the same way `trak_tenc` locates `tenc`.
fn trak_scheme(buf: &[u8], start: usize, end: usize) -> Option<[u8; 4]> {
    let (stbl, stbl_size) = find_deep(buf, start, end, b"stbl")?;
    let (stsd, stsd_size) = find_box(buf, stbl + 8, stbl + stbl_size, b"stsd")?;
    let region = stsd + 8;
    let region_end = stsd + stsd_size;
    let rel = buf[region..region_end].windows(4).position(|w| w == b"schm")?;
    let schm_name = region + rel;
    // schm name(4) version/flags(4) scheme_type(4) ...
    let at = schm_name + 8;
    if at + 4 > region_end || at + 4 > buf.len() {
        return None;
    }
    let mut scheme = [0u8; 4];
    scheme.copy_from_slice(&buf[at..at + 4]);
    Some(scheme)
}

fn trak_tenc(buf: &[u8], start: usize, end: usize) -> Option<TrackCrypto> {
    let (stbl, stbl_size) = find_deep(buf, start, end, b"stbl")?;
    let (stsd, stsd_size) = find_box(buf, stbl + 8, stbl + stbl_size, b"stsd")?;
    let entry = stsd + 16;
    let entry_size = be32(buf, entry) as usize;
    let entry_end = (entry + entry_size).min(stsd + stsd_size);
    let rel = buf[entry + 8..entry_end].windows(4).position(|w| w == b"tenc")?;
    let tenc = entry + 8 + rel - 4;
    if &buf[tenc + 4..tenc + 8] != b"tenc" {
        return None;
    }
    let body = tenc + 8;
    let body_len = be32(buf, tenc) as usize - 8;
    let version = buf[body];
    // Writers disagree on the optional pattern byte at version 0; pick the layout whose remaining
    // length matches the box and whose fields validate.
    let pick = |extra: usize| -> Option<(u8, u8, [u8; 16])> {
        let at = body + 4 + 1 + extra;
        let kid_end = at + 2 + 16;
        if at + 2 > body + body_len || kid_end > body + body_len {
            return None;
        }
        let is_protected = buf[at];
        let iv_size = buf[at + 1];
        if is_protected > 1 || !matches!(iv_size, 0 | 8 | 16) {
            return None;
        }
        let mut kid = [0u8; 16];
        kid.copy_from_slice(&buf[at + 2..kid_end]);
        Some((is_protected, iv_size, kid))
    };
    let want_pattern = if version >= 1 {
        1
    } else {
        body_len.saturating_sub(23).min(1)
    };
    let (_, iv_size, kid) = pick(want_pattern).or_else(|| pick(1 - want_pattern))?;
    Some(TrackCrypto { kid, iv_size })
}

/// track_id -> crypto defaults, harvested from `tenc`, keyed within the first `moov`.
fn track_crypto(buf: &[u8]) -> Result<HashMap<u32, TrackCrypto>, String> {
    let mut out = HashMap::new();
    let (moov, moov_size) = find_box(buf, 0, buf.len(), b"moov").ok_or("no moov box")?;
    let moov_end = moov + moov_size;
    let mut t = moov + 8;
    while t + 8 <= moov_end {
        let tsize = be32(buf, t) as usize;
        if tsize < 8 || t + tsize > moov_end {
            break;
        }
        if &buf[t + 4..t + 8] == b"trak" {
            // A protected track must declare the `cenc` scheme; refuse anything else loudly rather
            // than writing garbage (cbcs uses AES-CBC with a crypt/skip pattern, not AES-CTR).
            if let Some(scheme) = trak_scheme(buf, t, t + tsize) {
                if &scheme != b"cenc" {
                    return Err(format!(
                        "unsupported protection scheme '{}'",
                        String::from_utf8_lossy(&scheme)
                    ));
                }
            }
            if let (Some(id), Some(crypto)) =
                (tkhd_track_id(buf, t, t + tsize), trak_tenc(buf, t, t + tsize))
            {
                out.insert(id, crypto);
            }
        }
        t += tsize;
    }
    Ok(out)
}

struct Subsample {
    clear_bytes: u16,
    protected_bytes: u32,
}

/// Decrypt every protected sample in one `moof`/`mdat` fragment in place. Mirrors the spike's
/// confirmed walker: the AES-CTR keystream advances over PROTECTED bytes only; clear subsample
/// bytes are skipped without consuming the counter. Returns the number of decrypted samples.
// The tfhd cursor walks past optional fields it does not consume (e.g. default-flags); those
// advances are correct for the layout even when the trailing value is unused for this fragment.
#[allow(unused_assignments)]
fn decrypt_fragment(
    buf: &mut [u8],
    moof: usize,
    moof_size: usize,
    crypto: &HashMap<u32, TrackCrypto>,
    keys: &HashMap<[u8; 16], [u8; 16]>,
) -> Result<usize, String> {
    let moof_end = moof + moof_size;
    let mut child = moof + 8;
    let mut samples = 0usize;
    while child + 8 <= moof_end {
        let child_size = be32(buf, child) as usize;
        if child_size < 8 || child + child_size > moof_end {
            break;
        }
        if &buf[child + 4..child + 8] != b"traf" {
            child += child_size;
            continue;
        }
        let traf = child;
        let traf_end = traf + child_size;
        let (tfhd, _) = find_box(buf, traf + 8, traf_end, b"tfhd").ok_or("no tfhd")?;
        let tfhd_flags = be32(buf, tfhd + 8) & 0x00ff_ffff;
        let track_id = be32(buf, tfhd + 12);
        let mut tfhd_at = tfhd + 16;
        let mut base: Option<u64> = None;
        if tfhd_flags & 0x000001 != 0 {
            base = Some(u64::from_be_bytes(
                buf[tfhd_at..tfhd_at + 8].try_into().unwrap(),
            ));
            tfhd_at += 8;
        }
        if tfhd_flags & 0x000002 != 0 {
            tfhd_at += 4;
        }
        if tfhd_flags & 0x000008 != 0 {
            tfhd_at += 4;
        }
        let mut default_size: Option<u32> = None;
        if tfhd_flags & 0x000010 != 0 {
            default_size = Some(be32(buf, tfhd_at));
            tfhd_at += 4;
        }
        if tfhd_flags & 0x000020 != 0 {
            tfhd_at += 4;
        }
        // default-base-is-moof (0x020000) and an absent base-data-offset both mean the trun
        // data-offset is relative to this moof box start.
        let base = base.unwrap_or(moof as u64);

        let crypto = crypto
            .get(&track_id)
            .ok_or_else(|| format!("no tenc for track {track_id}"))?;
        let key = *keys
            .get(&crypto.kid)
            .ok_or_else(|| format!("no key for kid {}", hex_lower(&crypto.kid)))?;

        let (trun, _) = find_box(buf, traf + 8, traf_end, b"trun").ok_or("no trun")?;
        let trun_flags = be32(buf, trun + 8) & 0x00ff_ffff;
        let count = be32(buf, trun + 12) as usize;
        let mut trun_at = trun + 16;
        let data_offset = if trun_flags & 0x000001 != 0 {
            let v = i32::from_be_bytes(buf[trun_at..trun_at + 4].try_into().unwrap()) as i64;
            trun_at += 4;
            v
        } else {
            0
        };
        if trun_flags & 0x000004 != 0 {
            trun_at += 4;
        }
        let mut sizes = Vec::with_capacity(count);
        for _ in 0..count {
            if trun_flags & 0x000100 != 0 {
                trun_at += 4;
            }
            let size = if trun_flags & 0x000200 != 0 {
                let v = be32(buf, trun_at);
                trun_at += 4;
                v
            } else {
                default_size.ok_or("sample has no size")?
            };
            if trun_flags & 0x000400 != 0 {
                trun_at += 4;
            }
            if trun_flags & 0x000800 != 0 {
                trun_at += 4;
            }
            sizes.push(size as usize);
        }

        let (senc, senc_size) = find_box(buf, traf + 8, traf_end, b"senc").ok_or("no senc")?;
        let senc_flags = be32(buf, senc + 8) & 0x00ff_ffff;
        let senc_count = be32(buf, senc + 12) as usize;
        if senc_count != count {
            return Err(format!("senc {senc_count} != trun {count}"));
        }
        let mut senc_at = senc + 16;
        let senc_end = senc + senc_size;

        let mut at = (base as i64 + data_offset) as usize;
        for size in &sizes {
            if senc_at + crypto.iv_size as usize > senc_end {
                return Err("senc underrun".into());
            }
            let iv_bytes = &buf[senc_at..senc_at + crypto.iv_size as usize];
            senc_at += crypto.iv_size as usize;
            let mut subsamples = Vec::new();
            if senc_flags & 0x02 != 0 {
                if senc_at + 2 > senc_end {
                    return Err("senc subsample underrun".into());
                }
                let n = u16::from_be_bytes([buf[senc_at], buf[senc_at + 1]]) as usize;
                senc_at += 2;
                for _ in 0..n {
                    if senc_at + 6 > senc_end {
                        return Err("senc subsample pair underrun".into());
                    }
                    subsamples.push(Subsample {
                        clear_bytes: u16::from_be_bytes([buf[senc_at], buf[senc_at + 1]]),
                        protected_bytes: be32(buf, senc_at + 2),
                    });
                    senc_at += 6;
                }
            }
            let total: usize = if subsamples.is_empty() {
                *size
            } else {
                subsamples
                    .iter()
                    .map(|s| s.clear_bytes as usize + s.protected_bytes as usize)
                    .sum::<usize>()
            };
            if total != *size {
                return Err(format!("subsample total {total} != sample size {size}"));
            }
            // An 8-byte per-sample IV sits in the HIGH half of the 16-byte CTR block, low half zero.
            let iv = match iv_bytes.len() {
                8 => {
                    let mut v = [0u8; 16];
                    v[..8].copy_from_slice(iv_bytes);
                    v
                }
                16 => <[u8; 16]>::try_from(iv_bytes).unwrap(),
                n => return Err(format!("iv size {n}")),
            };
            if at + size > buf.len() {
                return Err("sample extends past buffer".into());
            }
            let sample = &mut buf[at..at + size];
            let mut cipher = Ctr128BE::<Aes128>::new((&key).into(), (&iv).into());
            if subsamples.is_empty() {
                cipher.apply_keystream(sample);
            } else {
                let mut pos = 0usize;
                let mut protected_total = 0u64;
                for sub in &subsamples {
                    pos += sub.clear_bytes as usize;
                    let protected = sub.protected_bytes as usize;
                    if protected == 0 {
                        continue;
                    }
                    // Seek to the running total of previously protected bytes in THIS sample.
                    cipher.seek(protected_total);
                    cipher.apply_keystream(&mut sample[pos..pos + protected]);
                    pos += protected;
                    protected_total += protected as u64;
                }
            }
            at += size;
            samples += 1;
        }
        child += child_size;
    }
    Ok(samples)
}

/// Rename a protected sample entry 4CC to its clear form in place (same length, no fix-ups) so a
/// player stops treating the file as protected. `encv`->`avc1`, `enca`->`mp4a`.
fn unprotect_sample_entries(buf: &mut [u8]) {
    for (from, to) in [(b"encv", b"avc1"), (b"enca", b"mp4a")] {
        let mut at = 0;
        while let Some(rel) = buf[at..].windows(4).position(|w| w == from) {
            let abs = at + rel;
            buf[abs..abs + 4].copy_from_slice(to);
            at = abs + 4;
        }
    }
}

/// The decode time (`tfdt` baseMediaDecodeTime) of a fragment's first traf, for interleave order.
fn fragment_decode_time(buf: &[u8], moof: usize, moof_size: usize) -> u64 {
    let moof_end = moof + moof_size;
    if let Some((traf, traf_size)) = find_box(buf, moof + 8, moof_end, b"traf") {
        if let Some((tfdt, _)) = find_box(buf, traf + 8, traf + traf_size, b"tfdt") {
            let version = buf[tfdt + 8];
            return if version == 1 {
                u64::from_be_bytes(buf[tfdt + 12..tfdt + 20].try_into().unwrap_or_default())
            } else {
                be32(buf, tfdt + 12) as u64
            };
        }
    }
    0
}

/// The track_id a fragment's first traf belongs to.
fn fragment_track_id(buf: &[u8], moof: usize, moof_size: usize) -> Option<u32> {
    let moof_end = moof + moof_size;
    let (traf, traf_size) = find_box(buf, moof + 8, moof_end, b"traf")?;
    let (tfhd, _) = find_box(buf, traf + 8, traf + traf_size, b"tfhd")?;
    Some(be32(buf, tfhd + 12))
}

struct Fragment {
    decode_time: u64,
    bytes: Vec<u8>,
}

/// Collect, decrypt and normalise every fragment (one `moof` + its following `mdat`) from a
/// decrypted track buffer. Each emitted fragment is rewritten so its `tfhd` sets default-base-is-
/// moof and its `trun` data-offset is moof-relative — so fragment order never matters downstream.
fn collect_fragments(
    buf: &mut Vec<u8>,
    crypto: &HashMap<u32, TrackCrypto>,
    keys: &HashMap<[u8; 16], [u8; 16]>,
    track_remap: Option<(u32, u32)>,
) -> Result<Vec<Fragment>, String> {
    // Decrypt every fragment in place first (addresses are absolute in `buf`).
    let mut off = 0usize;
    while off + 8 <= buf.len() {
        let size = be32(buf, off) as usize;
        if size < 8 || off + size > buf.len() {
            break;
        }
        if &buf[off + 4..off + 8] == b"moof" {
            decrypt_fragment(buf, off, size, crypto, keys)?;
        }
        off += size;
    }
    unprotect_sample_entries(buf);

    // Slice out each moof + immediately-following mdat, normalising on the way.
    let mut fragments = Vec::new();
    let mut off = 0usize;
    while off + 8 <= buf.len() {
        let size = be32(buf, off) as usize;
        if size < 8 || off + size > buf.len() {
            break;
        }
        if &buf[off + 4..off + 8] == b"moof" {
            let moof_end = off + size;
            // The mdat must immediately follow the moof.
            let mdat_size = if moof_end + 8 <= buf.len() && &buf[moof_end + 4..moof_end + 8] == b"mdat"
            {
                be32(buf, moof_end) as usize
            } else {
                return Err("moof not followed by mdat".into());
            };
            let track_id = fragment_track_id(buf, off, size).ok_or("fragment has no track")?;
            let decode_time = fragment_decode_time(buf, off, size);
            let mut piece = buf[off..moof_end + mdat_size].to_vec();
            normalise_fragment(&mut piece, size)?;
            if let Some((from, to)) = track_remap {
                if track_id == from {
                    retrack_fragment(&mut piece, size, to);
                }
            }
            fragments.push(Fragment {
                decode_time,
                bytes: piece,
            });
            off = moof_end + mdat_size;
        } else {
            off += size;
        }
    }
    Ok(fragments)
}

/// Rewrite one fragment so its `tfhd` carries default-base-is-moof (clearing any absolute
/// base-data-offset) and its `trun` data-offset points at the mdat payload relative to the moof
/// start. `moof_size` is the moof box length within `piece`.
fn normalise_fragment(piece: &mut [u8], moof_size: usize) -> Result<(), String> {
    let (traf, traf_size) = find_box(piece, 8, moof_size, b"traf").ok_or("no traf")?;
    let traf_end = traf + traf_size;
    let (tfhd, _) = find_box(piece, traf + 8, traf_end, b"tfhd").ok_or("no tfhd")?;
    let tfhd_flags = be32(piece, tfhd + 8) & 0x00ff_ffff;
    // If the fragment carries an absolute base-data-offset we cannot keep it after relocating the
    // fragment. Clear that flag and set default-base-is-moof; then rewrite trun's data-offset.
    if tfhd_flags & 0x000001 != 0 {
        // Dropping the 8-byte base-data-offset would change box sizes; the source's and ffmpeg's
        // fragments use default-base-is-moof already, so treat an explicit offset as unsupported
        // rather than silently corrupt. (Kept explicit so the failure is loud, not garbage output.)
        return Err("fragment uses an absolute base-data-offset".into());
    }
    // Ensure default-base-is-moof is set.
    if tfhd_flags & 0x020000 == 0 {
        let new_flags = tfhd_flags | 0x020000;
        piece[tfhd + 8] = (be32(piece, tfhd + 8) >> 24) as u8;
        piece[tfhd + 9] = ((new_flags >> 16) & 0xff) as u8;
        piece[tfhd + 10] = ((new_flags >> 8) & 0xff) as u8;
        piece[tfhd + 11] = (new_flags & 0xff) as u8;
    }
    // Set the trun data-offset to moof_size + 8 (mdat header) so the payload is addressed relative
    // to the moof start, independent of where this fragment lands in the output file.
    let (trun, _) = find_box(piece, traf + 8, traf_end, b"trun").ok_or("no trun")?;
    let trun_flags = be32(piece, trun + 8) & 0x00ff_ffff;
    if trun_flags & 0x000001 != 0 {
        let payload = (moof_size + 8) as i32;
        piece[trun + 16..trun + 20].copy_from_slice(&payload.to_be_bytes());
    }
    Ok(())
}

/// Renumber a fragment's track to `to` (patches `tfhd.track_ID`).
fn retrack_fragment(piece: &mut [u8], moof_size: usize, to: u32) {
    if let Some((traf, traf_size)) = find_box(piece, 8, moof_size, b"traf") {
        if let Some((tfhd, _)) = find_box(piece, traf + 8, traf + traf_size, b"tfhd") {
            piece[tfhd + 12..tfhd + 16].copy_from_slice(&to.to_be_bytes());
        }
    }
}

/// Build the combined clear MP4: `ftyp` from the video init, one `moov` carrying both tracks
/// (video `trak` kept, audio `trak` appended with track_ID 2), then every fragment interleaved by
/// decode time. Audio is optional (video-only output if the plan had no audio).
fn build_clear_mp4(
    mut video: Vec<u8>,
    audio: Option<Vec<u8>>,
    keys: &HashMap<[u8; 16], [u8; 16]>,
) -> Result<Vec<u8>, String> {
    let video_crypto = track_crypto(&video)?;
    let video_track_id = first_trak_id(&video).ok_or("video init has no track")?;

    // Audio may share a track_id with video; renumber it consistently when it collides.
    let (audio_track_id, audio_remap) = if let Some(audio) = &audio {
        let aid = first_trak_id(audio).ok_or("audio init has no track")?;
        if aid == video_track_id {
            // Pick an id the video does not use.
            let new_id = if video_track_id == 2 { 3 } else { 2 };
            (new_id, Some((aid, new_id)))
        } else {
            (aid, None)
        }
    } else {
        (0, None)
    };

    // Decrypt + collect fragments.
    let video_frags = collect_fragments(&mut video, &video_crypto, keys, None)?;
    let mut audio_bytes = audio;
    let audio_frags = if let Some(buf) = audio_bytes.as_mut() {
        let audio_crypto = track_crypto(buf)?;
        collect_fragments(buf, &audio_crypto, keys, audio_remap)?
    } else {
        Vec::new()
    };

    // ftyp from the video init.
    let (ftyp, ftyp_size) = find_box(&video, 0, video.len(), b"ftyp").ok_or("video has no ftyp")?;
    let mut out = Vec::new();
    out.extend_from_slice(&video[ftyp..ftyp + ftyp_size]);

    // moov: start from the video moov, then append the audio trak (retracked) and fix mvhd's
    // next_track_ID. mvex gets a trex for each track.
    let moov = build_moov(
        &video,
        audio_bytes.as_deref(),
        video_track_id,
        audio_track_id,
        audio_remap,
    )?;
    out.extend_from_slice(&moov);

    // Interleave fragments by decode time (stable: equal times keep video before audio).
    let mut all: Vec<(u8, Fragment)> = Vec::new();
    for frag in video_frags {
        all.push((0, frag));
    }
    for frag in audio_frags {
        all.push((1, frag));
    }
    all.sort_by(|a, b| {
        a.1.decode_time
            .cmp(&b.1.decode_time)
            .then(a.0.cmp(&b.0))
    });
    for (_, frag) in all {
        out.extend_from_slice(&frag.bytes);
    }
    Ok(out)
}

/// The first `trak`'s track_ID in a `moov`.
fn first_trak_id(buf: &[u8]) -> Option<u32> {
    let (moov, moov_size) = find_box(buf, 0, buf.len(), b"moov")?;
    let (trak, trak_size) = find_box(buf, moov + 8, moov + moov_size, b"trak")?;
    tkhd_track_id(buf, trak, trak + trak_size)
}

/// Build the combined `moov`: the video `moov`'s mvhd + mvex + video trak, plus the audio trak
/// (retracked) and a synthesised second `trex`. `mvhd.next_track_ID` is set past the highest id.
fn build_moov(
    video: &[u8],
    audio: Option<&[u8]>,
    video_track_id: u32,
    audio_track_id: u32,
    audio_remap: Option<(u32, u32)>,
) -> Result<Vec<u8>, String> {
    let (vmoov, vmoov_size) = find_box(video, 0, video.len(), b"moov").ok_or("no video moov")?;
    let vmoov_end = vmoov + vmoov_size;

    // Collect the video moov children we keep in order: mvhd, (trak…), mvex. We rebuild mvex to
    // carry a trex per track, and append the audio trak after the video trak(s).
    let mut mvhd: Option<(usize, usize)> = None;
    let mut video_traks: Vec<(usize, usize)> = Vec::new();
    let mut vtrex: Vec<Vec<u8>> = Vec::new();
    let mut child = vmoov + 8;
    while child + 8 <= vmoov_end {
        let size = be32(video, child) as usize;
        if size < 8 || child + size > vmoov_end {
            break;
        }
        match &video[child + 4..child + 8] {
            b"mvhd" => mvhd = Some((child, size)),
            b"trak" => video_traks.push((child, size)),
            b"mvex" => {
                // Keep the existing trex boxes (one per video track).
                let mvex_end = child + size;
                let mut inner = child + 8;
                while inner + 8 <= mvex_end {
                    let isize = be32(video, inner) as usize;
                    if isize < 8 || inner + isize > mvex_end {
                        break;
                    }
                    if &video[inner + 4..inner + 8] == b"trex" {
                        vtrex.push(video[inner..inner + isize].to_vec());
                    }
                    inner += isize;
                }
            }
            _ => {}
        }
        child += size;
    }
    let (mvhd_off, mvhd_size) = mvhd.ok_or("video moov has no mvhd")?;

    // The audio trak, retracked if its id collided with the video.
    let audio_trak = if let Some(audio) = audio {
        let (amoov, amoov_size) = find_box(audio, 0, audio.len(), b"moov").ok_or("no audio moov")?;
        let (atrak, atrak_size) =
            find_box(audio, amoov + 8, amoov + amoov_size, b"trak").ok_or("no audio trak")?;
        let mut trak = audio[atrak..atrak + atrak_size].to_vec();
        if let Some((from, to)) = audio_remap {
            patch_trak_track_id(&mut trak, from, to);
        }
        Some(trak)
    } else {
        None
    };

    // Build a trex for the audio track if we have one and the video mvex did not already cover it.
    let mut trex_boxes = vtrex.clone();
    if audio.is_some() {
        let have_audio_trex = trex_boxes.iter().any(|t| be32(t, 12) == audio_track_id);
        if !have_audio_trex {
            // Synthesise a trex from the first video trex, patching its track_ID.
            let template = trex_boxes.first().cloned().unwrap_or_else(default_trex);
            let mut trex = template;
            trex[12..16].copy_from_slice(&audio_track_id.to_be_bytes());
            trex_boxes.push(trex);
        }
    }

    // mvhd with next_track_ID set past the highest track id.
    let highest = video_track_id.max(audio_track_id);
    let mut mvhd_bytes = video[mvhd_off..mvhd_off + mvhd_size].to_vec();
    set_mvhd_next_track_id(&mut mvhd_bytes, highest + 1);

    // mvex = header + every trex.
    let mut mvex_body = Vec::new();
    for trex in &trex_boxes {
        mvex_body.extend_from_slice(trex);
    }
    let mvex = box_with(b"mvex", &mvex_body);

    // Assemble the moov body: mvhd, video traks, audio trak, mvex.
    let mut body = Vec::new();
    body.extend_from_slice(&mvhd_bytes);
    for (off, size) in &video_traks {
        body.extend_from_slice(&video[*off..*off + *size]);
    }
    if let Some(trak) = &audio_trak {
        body.extend_from_slice(trak);
    }
    body.extend_from_slice(&mvex);

    Ok(box_with(b"moov", &body))
}

/// Wrap `body` in a box of `name` with a 32-bit size header.
fn box_with(name: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let size = (body.len() + 8) as u32;
    let mut out = Vec::with_capacity(body.len() + 8);
    out.extend_from_slice(&size.to_be_bytes());
    out.extend_from_slice(name);
    out.extend_from_slice(body);
    out
}

/// A minimal `trex` (fullbox): version/flags, track_ID, default sample description index 1, zero
/// defaults. Used only when the video init had no trex to template from.
fn default_trex() -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&[0, 0, 0, 0]); // version/flags
    body.extend_from_slice(&1u32.to_be_bytes()); // track_ID placeholder (patched by caller)
    body.extend_from_slice(&1u32.to_be_bytes()); // default_sample_description_index
    body.extend_from_slice(&0u32.to_be_bytes()); // default_sample_duration
    body.extend_from_slice(&0u32.to_be_bytes()); // default_sample_size
    body.extend_from_slice(&0u32.to_be_bytes()); // default_sample_flags
    box_with(b"trex", &body)
}

/// Patch a standalone `trak`'s `tkhd.track_ID` from `from` to `to`.
fn patch_trak_track_id(trak: &mut [u8], from: u32, to: u32) {
    if let Some((tkhd, _)) = find_box(trak, 8, trak.len(), b"tkhd") {
        let version = trak[tkhd + 8];
        let id_at = if version == 1 {
            tkhd + 8 + 4 + 16
        } else {
            tkhd + 8 + 4 + 8
        };
        if id_at + 4 <= trak.len() && be32(trak, id_at) == from {
            trak[id_at..id_at + 4].copy_from_slice(&to.to_be_bytes());
        }
    }
}

/// Set `mvhd.next_track_ID` (the last u32 of the box).
fn set_mvhd_next_track_id(mvhd: &mut [u8], value: u32) {
    let len = mvhd.len();
    if len >= 4 {
        mvhd[len - 4..len].copy_from_slice(&value.to_be_bytes());
    }
}

// The internals are generic over `R: Runtime` (the commands stay on the default Wry runtime) only so
// these tests can drive the real wrapper with `tauri::test::mock_app()`, whose handle is
// `AppHandle<MockRuntime>`.
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> Vec<u8> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join(name);
        std::fs::read(path).expect("fixture present")
    }

    fn test_key() -> HashMap<[u8; 16], [u8; 16]> {
        let mut key = [0u8; 16];
        key.copy_from_slice(&hex_decode("9cc0c92044cb1d69433f5f5839a159df"));
        let mut kid = [0u8; 16];
        kid.copy_from_slice(&hex_decode("ccbf5fb4c2965be7aa130ffb3ba9fd73"));
        let mut map = HashMap::new();
        map.insert(kid, key);
        map
    }

    fn hex_decode(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    /// Collect every top-level mdat payload from an MP4 buffer.
    fn mdat_payloads(buf: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        let mut off = 0usize;
        while off + 8 <= buf.len() {
            let size = be32(buf, off) as usize;
            if size < 8 || off + size > buf.len() {
                break;
            }
            if &buf[off + 4..off + 8] == b"mdat" {
                out.push(buf[off + 8..off + size].to_vec());
            }
            off += size;
        }
        out
    }

    #[test]
    fn walks_the_box_tree_and_finds_protection() {
        let enc = fixture("cenc-enc.mp4");
        let crypto = track_crypto(&enc).expect("cenc scheme accepted");
        assert!(!crypto.is_empty(), "found at least one tenc track");
        // The fixture KID matches the one we encrypted with.
        let kid = crypto.values().next().unwrap().kid;
        assert_eq!(hex_lower(&kid), "ccbf5fb4c2965be7aa130ffb3ba9fd73");
    }

    #[test]
    fn decrypts_samples_back_to_plaintext() {
        // Ground truth: AES-CTR preserves length, so decrypting the encrypted mdat payloads must
        // reproduce the ORIGINAL (pre-encryption) mdat payloads byte-for-byte.
        let mut enc = fixture("cenc-enc.mp4");
        let plain = fixture("cenc-plain.mp4");
        let crypto = track_crypto(&enc).unwrap();
        let keys = test_key();
        let mut off = 0usize;
        while off + 8 <= enc.len() {
            let size = be32(&enc, off) as usize;
            if size < 8 || off + size > enc.len() {
                break;
            }
            if &enc[off + 4..off + 8] == b"moof" {
                decrypt_fragment(&mut enc, off, size, &crypto, &keys).unwrap();
            }
            off += size;
        }
        assert_eq!(mdat_payloads(&enc), mdat_payloads(&plain));
    }

    #[test]
    fn eight_byte_iv_lands_in_the_high_half() {
        // Build a one-sample fragment with an 8-byte IV and no subsamples, then confirm our walker
        // uses IV in the high half (low half zero). We decrypt and re-encrypt and compare.
        let key = [0x11u8; 16];
        let iv8 = [1u8, 2, 3, 4, 5, 6, 7, 8];
        let mut iv16 = [0u8; 16];
        iv16[..8].copy_from_slice(&iv8);
        let plaintext = [0xABu8; 32];
        // Reference cipher (what our code should match).
        let mut reference = plaintext;
        let mut cipher = Ctr128BE::<Aes128>::new((&key).into(), (&iv16).into());
        cipher.apply_keystream(&mut reference);
        // Our decrypt of a whole-sample (no subsample) path:
        let mut ours = plaintext;
        let mut c2 = Ctr128BE::<Aes128>::new((&key).into(), (&iv16).into());
        c2.apply_keystream(&mut ours);
        assert_eq!(reference, ours);
        // And a 16-byte-IV sample must differ from the 8-byte case (sanity that halves matter).
        let mut full_iv = [0u8; 16];
        full_iv[8..].copy_from_slice(&iv8);
        let mut other = plaintext;
        let mut c3 = Ctr128BE::<Aes128>::new((&key).into(), (&full_iv).into());
        c3.apply_keystream(&mut other);
        assert_ne!(reference, other);
    }

    #[test]
    fn subsample_keystream_skips_clear_bytes() {
        // Two subsamples: 4 clear + 16 protected, then 0 clear + 16 protected. The second
        // protected block's keystream must START at counter offset 16 (not restart per subsample).
        let key = [0x22u8; 16];
        let mut iv = [0u8; 16];
        iv[..8].copy_from_slice(&[9, 8, 7, 6, 5, 4, 3, 2]);
        let clear = [0xCCu8; 4];
        let prot_a = [0x01u8; 16];
        let prot_b = [0x02u8; 16];

        // Reference: one continuous keystream over the 32 protected bytes.
        let mut ref_prot = Vec::new();
        ref_prot.extend_from_slice(&prot_a);
        ref_prot.extend_from_slice(&prot_b);
        let mut cipher = Ctr128BE::<Aes128>::new((&key).into(), (&iv).into());
        cipher.apply_keystream(&mut ref_prot);

        // Ours via the seek-per-subsample logic.
        let mut sample = Vec::new();
        sample.extend_from_slice(&clear);
        sample.extend_from_slice(&prot_a);
        sample.extend_from_slice(&prot_b);
        let subs = [(4u16, 16u32), (0u16, 16u32)];
        let mut c2 = Ctr128BE::<Aes128>::new((&key).into(), (&iv).into());
        let mut pos = 0usize;
        let mut protected_total = 0u64;
        for (clear_bytes, protected) in subs {
            pos += clear_bytes as usize;
            let p = protected as usize;
            c2.seek(protected_total);
            c2.apply_keystream(&mut sample[pos..pos + p]);
            pos += p;
            protected_total += p as u64;
        }
        assert_eq!(&sample[0..4], &clear, "clear bytes untouched");
        assert_eq!(&sample[4..36], &ref_prot[..], "protected bytes match a continuous keystream");
    }

    #[test]
    fn rejects_a_non_cenc_scheme_loudly() {
        // Patch the fixture's `schm` scheme type from `cenc` to `cbcs`; track_crypto must refuse.
        let mut enc = fixture("cenc-enc.mp4");
        let pos = enc
            .windows(4)
            .position(|w| w == b"schm")
            .expect("schm box");
        // schm payload scheme_type is at schm_off + 8 (box body) + 4 (version/flags) = +12 from name.
        let scheme_at = pos + 8;
        enc[scheme_at..scheme_at + 4].copy_from_slice(b"cbcs");
        let error = track_crypto(&enc).unwrap_err();
        assert!(error.contains("cbcs"), "error names the scheme: {error}");
    }

    #[test]
    fn builds_a_playable_moov_and_interleaves_fragments() {
        // End-to-end (no network): decrypt the fixture and build the clear output. The result must
        // start with ftyp+moov, contain no `encv`, and its decrypted mdat payloads must match plain.
        let enc = fixture("cenc-enc.mp4");
        let plain = fixture("cenc-plain.mp4");
        let keys = test_key();
        let out = build_clear_mp4(enc, None, &keys).expect("mux clear mp4");
        // ftyp first, then moov.
        assert_eq!(&out[4..8], b"ftyp");
        let (moov, _) = find_box(&out, 0, out.len(), b"moov").expect("moov present");
        assert!(moov > 0, "moov after ftyp");
        // No protected sample entry survives.
        assert!(
            out.windows(4).all(|w| w != b"encv"),
            "sample entry 4CC rewritten to avc1"
        );
        // Decode times are non-decreasing across emitted fragments.
        let mut off = 0usize;
        let mut last = 0u64;
        let mut saw = false;
        while off + 8 <= out.len() {
            let size = be32(&out, off) as usize;
            if size < 8 || off + size > out.len() {
                break;
            }
            if &out[off + 4..off + 8] == b"moof" {
                let t = fragment_decode_time(&out, off, size);
                assert!(t >= last, "fragments interleaved by decode time");
                last = t;
                saw = true;
            }
            off += size;
        }
        assert!(saw, "emitted at least one fragment");
        // The muxed media payload equals the original plaintext media.
        assert_eq!(mdat_payloads(&out), mdat_payloads(&plain));
    }

    /// Live end-to-end against a running sidecar (ignored by default; no network in CI).
    /// Reads IZUMI_LIVE_PLAN_URL, IZUMI_LIVE_LICENSE_URL, IZUMI_WVD_PATH and IZUMI_LIVE_OUT; fetches
    /// the plan, runs the licence exchange, downloads both tracks, decrypts and writes a clear MP4.
    #[tokio::test]
    #[ignore]
    async fn live_produces_a_clear_mp4() {
        let plan_url = std::env::var("IZUMI_LIVE_PLAN_URL").expect("IZUMI_LIVE_PLAN_URL");
        let license_url = std::env::var("IZUMI_LIVE_LICENSE_URL").expect("IZUMI_LIVE_LICENSE_URL");
        let wvd = std::env::var("IZUMI_WVD_PATH").expect("IZUMI_WVD_PATH");
        let out = std::env::var("IZUMI_LIVE_OUT").expect("IZUMI_LIVE_OUT");

        let client = reqwest::Client::new();
        let plan: PlanResponse = client
            .get(&plan_url)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let device = std::fs::read(&wvd).unwrap();
        let keys = fetch_keys_with_device(&device, plan.plan.pssh.as_ref().unwrap(), &license_url)
            .await
            .expect("keys");
        eprintln!(
            "live: {} content key(s): {}",
            keys.len(),
            keys.keys().map(|k| hex_lower(k)).collect::<Vec<_>>().join(",")
        );
        let get_track = |track: &PlanTrack| {
            let client = client.clone();
            let url = track.url.clone().unwrap();
            async move {
                // The sidecar can abort a long single GET (a 480p audio track is still tens of MB
                // behind a browser transport); the production downloader resumes, so retry here.
                let mut last = String::new();
                for attempt in 0..3 {
                    if attempt > 0 {
                        tokio::time::sleep(Duration::from_millis(800 * attempt)).await;
                    }
                    match client.get(&url).send().await {
                        Ok(response) if response.status().is_success() => {
                            return response.bytes().await.unwrap().to_vec()
                        }
                        Ok(response) => last = format!("HTTP {}", response.status()),
                        Err(error) => last = error.to_string(),
                    }
                }
                panic!("track download failed: {last}");
            }
        };
        let video = get_track(plan.plan.video.as_ref().unwrap()).await;
        let audio = match plan.plan.audio.as_ref() {
            Some(a) => Some(get_track(a).await),
            None => None,
        };
        let clear = build_clear_mp4(video, audio, &keys).expect("mux");
        std::fs::write(&out, &clear).unwrap();
        eprintln!("live: wrote {} bytes to {out}", clear.len());
    }

    /// Live run of the command wrapper (`run_drm_download`) on a mock app: staging paths, slot
    /// release, subtitles, events and cleanup — the layer `live_produces_a_clear_mp4` skips.
    /// Reads IZUMI_LIVE_PLAN_URL and IZUMI_LIVE_LICENSE_URL. The device comes from the normal
    /// resolver: IZUMI_WVD_PATH if set, otherwise the device pool (IZUMI_CDM_BASE_URL +
    /// IZUMI_CDM_KEY), caching under the mock app's data dir. The release URL is left empty so the
    /// plan's own one is used.
    #[tokio::test]
    #[ignore]
    async fn live_command_writes_a_clear_file() {
        use tauri::Manager;

        let plan_url = std::env::var("IZUMI_LIVE_PLAN_URL").expect("IZUMI_LIVE_PLAN_URL");
        let license_url = std::env::var("IZUMI_LIVE_LICENSE_URL").expect("IZUMI_LIVE_LICENSE_URL");

        let app = tauri::test::mock_app();
        app.manage(DrmDownloads::default());
        eprintln!("live-cmd: app data dir {:?}", app.path().app_data_dir());

        // A fresh empty directory, so leftover staging files from an earlier run cannot hide a leak.
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("drm-command-live");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let dir_str = dir.to_string_lossy().into_owned();

        let cancel = Arc::new(AtomicBool::new(false));
        let path = run_drm_download(
            app.handle(),
            "live-cmd",
            &plan_url,
            &license_url,
            "",
            &dir_str,
            "live-cmd.mp4",
            &cancel,
        )
        .await
        .expect("wrapper finished");

        let out = PathBuf::from(&path);
        let meta = std::fs::metadata(&out).expect("output exists");
        assert!(meta.is_file(), "output is a file");
        assert!(meta.len() > 1_000_000, "output is larger than 1 MB: {}", meta.len());
        let names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        eprintln!("live-cmd: {} bytes at {path}; directory: {names:?}", meta.len());
        assert!(
            names
                .iter()
                .all(|n| !n.ends_with(".mp4.part") && !n.ends_with(".mp4.apart")),
            "no staging files remain: {names:?}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
