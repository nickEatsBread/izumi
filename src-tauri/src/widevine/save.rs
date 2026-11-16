//! Protected episodes saved for offline use as *clear* media. The source's two renditions (one
//! video, one audio) are fetched, each fragment's samples are decrypted through the Widevine module
//! as they arrive, and the result is written to the same byte layout the source used — only the
//! `encv`/`enca` sample entries are rewritten to `avc1`/`mp4a` and the per-fragment encryption boxes
//! are hidden (`fmp4.rs`). The saved folder is therefore an ordinary clear fMP4 pair that plays with
//! no module, no licence and no network. `drm.json` is kept beside them for reference only.
use anyhow::{anyhow, bail, Context, Result};
use base64::Engine;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

use super::cdm::{self, Cdm};
use super::fetch;
use super::fmp4::{self, Head};
use super::mpd;

pub const SAVED_INFO: &str = "drm.json";

/// The source's Widevine licence request: where to ask and with what, so the module can obtain the
/// content keys for a save. Mirrors the player's `Request` but needs only the licence fields.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Licence {
    #[serde(default)]
    pub key_system: Option<String>,
    pub license_url: String,
    #[serde(default)]
    pub license_headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub server_certificate_url: Option<String>,
}

/// What a saved episode records beside its files. The files are already clear, so this is only for
/// reference: the pssh that licensed them and the video's codec/dimensions.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub video: String,
    pub audio: String,
    pub video_id: String,
    pub codecs: String,
    pub width: u32,
    pub height: u32,
    pub bandwidth: u64,
    #[serde(default)]
    pub audio_lang: Option<String>,
    /// The Widevine pssh that licensed the save (base64), kept for reference only.
    #[serde(default)]
    pub pssh: Option<String>,
    /// The saved files are already decrypted and need no online licence to play.
    #[serde(default)]
    pub clear: bool,
}

impl Saved {
    // Read back and used by the Linux streaming player (session.rs); Windows plays the folder itself.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fn read(dir: &Path) -> Result<Saved> {
        let text = std::fs::read(dir.join(SAVED_INFO)).context("this download is incomplete")?;
        let saved: Saved = serde_json::from_slice(&text).context("this download's record is damaged")?;
        // The record names files inside its own folder, never a path elsewhere.
        for name in [&saved.video, &saved.audio] {
            if name.contains(['/', '\\']) || name.starts_with('.') {
                bail!("this download's record is damaged");
            }
        }
        Ok(saved)
    }

    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fn pssh(&self) -> Option<Vec<u8>> {
        self.pssh.as_deref().and_then(|p| base64::engine::general_purpose::STANDARD.decode(p).ok())
    }
}

/// The folder behind a `file://` URL the player was given, when it holds a saved episode. Used by
/// the Linux streaming player to recognise a saved folder; Windows plays the folder directly.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn saved_dir(url: &str) -> Option<PathBuf> {
    let parsed = url::Url::parse(url).ok()?;
    if parsed.scheme() != "file" {
        return None;
    }
    let dir = parsed.to_file_path().ok()?;
    dir.join(SAVED_INFO).is_file().then_some(dir)
}

/// `<downloads>/<name>` with the name made safe for a folder (its extension dropped). The name is
/// sanitised first and the extension dropped after, so the result is the same on every OS (Windows
/// `Path::file_stem` would otherwise treat a `:` as a drive separator).
pub fn folder_for(downloads: &Path, name: &str) -> PathBuf {
    // Keep only the last path component, then replace every character a folder name must not hold.
    let leaf = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let mut safe: String = leaf
        .chars()
        .map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    // Drop a trailing extension (the part after the last dot), if any.
    if let Some(dot) = safe.rfind('.') {
        if dot > 0 {
            safe.truncate(dot);
        }
    }
    safe = safe.trim().trim_matches('.').to_string();
    if safe.is_empty() {
        safe = "episode".into();
    }
    downloads.join(format!("{safe}.protected"))
}

fn cancels() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static CANCELS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    CANCELS.get_or_init(Default::default)
}

pub fn cancel(id: &str) {
    if let Some(flag) = cancels().lock().ok().and_then(|all| all.get(id).cloned()) {
        flag.store(true, Ordering::SeqCst);
    }
}

fn client() -> &'static reqwest::Client {
    // No overall timeout: a whole episode takes as long as it takes. A stalled read still fails.
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(30))
            .build()
            .expect("HTTP client")
    })
}

pub struct SaveResult {
    pub bytes: u64,
    pub height: u32,
}

/// The size of the file at `url`, from a one-byte range read.
async fn size_of(url: &str) -> Result<u64> {
    let res = client().get(url).header("Range", "bytes=0-0").send().await?.error_for_status()?;
    if let Some(total) = res
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit('/').next())
        .and_then(|v| v.parse().ok())
    {
        return Ok(total);
    }
    res.content_length().context("the media server sent no file size")
}

/// Bytes `from..=to` of a media file, with a couple of retries on transient failures.
async fn range(url: &str, from: u64, to: u64) -> Result<Vec<u8>> {
    let mut last = anyhow!("not fetched");
    for attempt in 0..3u64 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(250 * attempt)).await;
        }
        let res = match client().get(url).header("Range", format!("bytes={from}-{to}")).send().await {
            Ok(r) => r,
            Err(e) => {
                last = e.into();
                continue;
            }
        };
        let status = res.status();
        if status.is_client_error() && status.as_u16() != 408 && status.as_u16() != 429 {
            bail!("media request failed with HTTP {status}");
        }
        if !status.is_success() {
            last = anyhow!("media request failed with HTTP {status}");
            continue;
        }
        match res.bytes().await {
            Ok(body) => return Ok(body.to_vec()),
            Err(e) => last = e.into(),
        }
    }
    Err(last)
}

/// Opens and licenses one CDM instance for `licence`, resolving `init_data` (the pssh) into usable
/// content keys. Returns the instance and the KIDs the licence marked usable. The same device, the
/// same licence URL and headers the player would use.
async fn license(lane: usize, interface: i32, licence: &Licence, init_data: Vec<u8>) -> Result<(Arc<Cdm>, Vec<[u8; 16]>)> {
    if let Some(ks) = licence.key_system.as_deref() {
        anyhow::ensure!(ks == "com.widevine.alpha", "{ks} is not supported for saving");
    }
    // The CDM lives on its own thread; its calls are blocking, so they run off the async runtime.
    let (renewals_tx, _renewals_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    let cdm = Arc::new(blocking(move || Cdm::open_on(lane, interface, renewals_tx)).await?);
    if let Some(url) = licence.server_certificate_url.as_deref().filter(|u| !u.is_empty()) {
        let certificate = client().get(url).send().await?.error_for_status()?.bytes().await?.to_vec();
        let c = cdm.clone();
        blocking(move || c.set_server_certificate(certificate)).await?;
    }
    let c = cdm.clone();
    let challenge = blocking(move || c.licence_request(init_data)).await?;
    let response = post_licence(licence, challenge).await?;
    let c = cdm.clone();
    let keys = blocking(move || c.update(response)).await?;
    anyhow::ensure!(
        keys.usable > 0,
        "the licence gave this device no usable keys{}",
        if keys.other.is_empty() { String::new() } else { format!(" (key status {:?})", keys.other) }
    );
    Ok((cdm, keys.usable_kids))
}

/// How a save spreads over module instances: `total` lanes (each one instance on its own module
/// thread), `video` of them decoding video and `audio` decrypting audio. With one lane in all, that
/// lane does audio and then video (`audio == 0`).
#[derive(Debug, PartialEq)]
struct LanePlan {
    total: usize,
    audio: usize,
    video: usize,
}

/// Module time per second of media, measured on a throttled instance (docs/widevine-module-host.md):
/// audio ~47 Decrypt calls/s at ~2ms each, video ~24 decodes/s at ~3ms each.
const AUDIO_MS_PER_SECOND: f64 = 94.0;
const VIDEO_MS_PER_SECOND: f64 = 72.0;
/// The one ffmpeg encoder's time per second of 854x480 media (libx264 superfast measured ~1,100 fps,
/// so ~22ms per 24 frames). It scales with picture area. More video lanes than keep the encoder busy
/// only cost memory, so the plan stops adding them there.
const ENCODER_MS_PER_SECOND_480P: f64 = 22.0;

/// Splits `total` lanes between audio and video so neither track keeps the other waiting: the split
/// that minimises the slower track's time, where video can go no faster than its encoder, with video
/// held to `video_cap` lanes (its reorder memory). Ties go to fewer video lanes (less memory).
fn lane_plan(total: usize, video_cap: usize, pixels: u64) -> LanePlan {
    let total = total.max(1);
    if total == 1 {
        return LanePlan { total, audio: 0, video: 1 };
    }
    let encoder = ENCODER_MS_PER_SECOND_480P * pixels.max(1) as f64 / (854.0 * 480.0);
    let mut best = LanePlan { total, audio: total - 1, video: 1 };
    let mut best_time = f64::MAX;
    for video in 1..=video_cap.clamp(1, total - 1) {
        let audio = total - video;
        let time = (AUDIO_MS_PER_SECOND / audio as f64).max((VIDEO_MS_PER_SECOND / video as f64).max(encoder));
        if time < best_time - 1e-9 {
            best_time = time;
            best = LanePlan { total, audio, video };
        }
    }
    best
}
/// Opens and licenses one instance per lane in `lanes`, concurrently. A lane whose instance cannot be
/// opened or licensed is logged and left out rather than failing the save.
async fn open_lanes(lanes: std::ops::Range<usize>, interface: i32, licence: &Licence, init_data: &[u8]) -> Vec<(usize, Arc<Cdm>)> {
    let jobs = lanes.map(|lane| async move {
        let t = Instant::now();
        match license(lane, interface, licence, init_data.to_vec()).await {
            Ok((cdm, _)) => {
                eprintln!("[widevine] lane {lane} licensed in {} ms", t.elapsed().as_millis());
                Some((lane, cdm))
            }
            Err(e) => {
                eprintln!("[widevine] lane {lane} dropped: {e:#}");
                None
            }
        }
    });
    futures_util::future::join_all(jobs).await.into_iter().flatten().collect()
}

/// The KIDs to try for a track, in order: its tenc default KID first (the usual case), then every
/// other usable KID. A stream can key several KIDs and a sample is not always encrypted with the
/// tenc default, so the decrypt falls through to the others on kNoKey.
fn candidate_kids(default_kid: [u8; 16], usable: &[[u8; 16]]) -> Vec<[u8; 16]> {
    let mut kids = vec![default_kid];
    for k in usable {
        if *k != default_kid {
            kids.push(*k);
        }
    }
    kids
}

/// Posts a licence challenge to the source's licence server and returns its answer.
async fn post_licence(licence: &Licence, body: Vec<u8>) -> Result<Vec<u8>> {
    let mut post = client().post(&licence.license_url).body(body);
    for (k, v) in licence.license_headers.iter().flatten() {
        post = post.header(k, v);
    }
    let res = post.send().await.context("the licence server could not be reached")?;
    let status = res.status();
    if !status.is_success() {
        let detail: String = res.text().await.unwrap_or_default().chars().take(160).collect();
        bail!("the licence server refused this device (HTTP {status}){}", if detail.is_empty() { String::new() } else { format!(": {detail}") });
    }
    Ok(res.bytes().await?.to_vec())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| anyhow!("{e}"))?
}

/// Saves the rendition the player would pick for `max_height` (H.264 first) and the default audio,
/// decrypting both to clear files. `data_dir` is where the module is installed.
/// `progress(received, total, bytes_per_second)`.
pub async fn save(id: &str, manifest_url: &str, dir: &Path, max_height: Option<u32>, licence: &Licence, data_dir: &Path, progress: impl Fn(u64, u64, f64)) -> Result<SaveResult> {
    let flag = Arc::new(AtomicBool::new(false));
    cancels().lock().map_err(|_| anyhow!("download registry poisoned"))?.insert(id.to_string(), flag.clone());
    let result = save_inner(manifest_url, dir, max_height, licence, data_dir, &flag, progress).await;
    if let Ok(mut all) = cancels().lock() {
        all.remove(id);
    }
    result
}

async fn save_inner(manifest_url: &str, dir: &Path, max_height: Option<u32>, licence: &Licence, data_dir: &Path, cancel: &Arc<AtomicBool>, progress: impl Fn(u64, u64, f64)) -> Result<SaveResult> {
    // Checked first, before any network or disk work, so a machine without the module can fall back
    // to another way of saving (the frontend recognises this error) with nothing to clean up.
    let installed = fetch::installed(data_dir).ok_or_else(|| anyhow!("{}", super::NOT_INSTALLED))?;
    let text = client()
        .get(manifest_url)
        .send()
        .await
        .context("the manifest could not be fetched")?
        .error_for_status()
        .context("the manifest could not be fetched")?
        .text()
        .await?;
    let manifest = mpd::parse(&text, manifest_url)?;
    // The saved file plays in an ordinary decoder, so only H.264 video is written.
    let video = manifest
        .video(max_height, Some("avc1"))
        .context("the manifest has no H.264 video to save")?
        .clone();
    let audio = manifest.audio(None).context("the manifest has no audio")?.clone();
    let (video_size, audio_size) = tokio::try_join!(size_of(&video.url), size_of(&audio.url))?;
    let total = video_size + audio_size;
    tokio::fs::create_dir_all(dir).await.with_context(|| format!("{} could not be created", dir.display()))?;

    // The file heads carry the pssh unless the manifest does; both are tried as licence init data.
    let (video_head, _) = head(&video.url).await.context("the video file could not be read")?;
    let (audio_head, _) = head(&audio.url).await.context("the audio file could not be read")?;
    let init_data = manifest
        .pssh
        .clone()
        .or_else(|| Some(video_head.pssh.clone()).filter(|p| !p.is_empty()))
        .or_else(|| Some(audio_head.pssh.clone()).filter(|p| !p.is_empty()))
        .context("the stream carries no Widevine licence data")?;
    let version = blocking({
        let library = installed.library.clone();
        move || cdm::load_module(&library)
    })
    .await?;
    eprintln!("[widevine] saving with module {version} (interface {})", installed.interface);
    let (cdm, usable_kids) = license(0, installed.interface, licence, init_data.clone()).await?;
    let audio_kids = candidate_kids(audio_head.default_kid, &usable_kids);
    let video_kids = candidate_kids(video_head.default_kid, &usable_kids);

    // The module throttles each instance after its first ~2,000 Decrypt calls (to ~2ms a call, measured;
    // see docs/widevine-module-host.md), and audio is tens of thousands of samples. So audio is spread
    // over extra instances on their own lanes while video decodes on the first one, concurrently. A
    // lane that cannot be licensed is dropped; with none, audio shares the first instance.
    let plan = lane_plan(cdm::max_lanes(), video_lane_cap(&video_head), video_head.width as u64 * video_head.height as u64);
    // Lane 0 holds the instance licensed above and decodes video; the other video lanes follow it, then
    // the audio lanes. Every extra lane is optional: one that cannot be licensed is dropped.
    let mut extra = open_lanes(1..plan.total, installed.interface, licence, &init_data).await;
    extra.sort_by_key(|(lane, _)| *lane);
    let mut video_cdms = vec![cdm.clone()];
    let mut audio_cdms = Vec::new();
    for (lane, c) in extra {
        if lane < plan.video { video_cdms.push(c) } else { audio_cdms.push(c) }
    }
    if audio_cdms.is_empty() {
        if plan.audio > 0 {
            eprintln!("[widevine] no audio lane could be licensed; audio shares lane 0");
        }
        audio_cdms.push(cdm.clone());
    }
    eprintln!("[widevine] lanes: audio {} + video {} (planned {} + {})", audio_cdms.len(), video_cdms.len(), plan.audio, plan.video);
    let started = Instant::now();
    // Both tracks report into one progress figure. Atomics and a mutex rather than cells: the save is
    // a Tauri command future, which must be Send.
    let (audio_done, video_done) = (std::sync::atomic::AtomicU64::new(0), std::sync::atomic::AtomicU64::new(0));
    let last_report = Mutex::new(Instant::now() - Duration::from_secs(1));
    let emit = || {
        let received = audio_done.load(Ordering::Relaxed) + video_done.load(Ordering::Relaxed);
        let Ok(mut last) = last_report.lock() else { return };
        if last.elapsed() < Duration::from_millis(250) && received < total {
            return;
        }
        *last = Instant::now();
        drop(last);
        progress(received, total, received as f64 / started.elapsed().as_secs_f64().max(0.001));
    };
    let mut audio_report = |w: u64| {
        audio_done.store(w, Ordering::Relaxed);
        emit();
    };
    let mut video_report = |w: u64| {
        video_done.store(w, Ordering::Relaxed);
        emit();
    };
    let audio_path = dir.join("audio.mp4");
    let video_path = dir.join("video.mp4");
    // Audio is decrypted straight through the module (lossless, exact bytes) to a clear mp4. Video is
    // decoded through the module and re-encoded to clear H.264: the Windows module refuses decrypt-only
    // output for some non-reference frames, so the decode path is the only complete one.
    let audio_job = decrypt_to_file(&audio.url, &audio_path, audio_head, audio_kids, audio_cdms, audio_size, cancel, &mut audio_report);
    let video_job = encode_video(&video.url, &video_path, video_head, video_kids, video_cdms, video_size, cancel, &mut video_report);
    if plan.total == 1 {
        // One lane (IZUMI_WIDEVINE_LANES=1, for weak machines): one instance, one track at a time.
        audio_job.await?;
        video_job.await?;
    } else if let Err(e) = tokio::try_join!(audio_job, video_job) {
        // One track failed; stop the other's lanes (they watch the same flag) rather than let them
        // run on detached.
        cancel.store(true, Ordering::SeqCst);
        return Err(e);
    }
    eprintln!("[widevine] saved in {:.1}s", started.elapsed().as_secs_f64());
    let saved = Saved {
        video: "video.mp4".into(),
        audio: "audio.mp4".into(),
        video_id: video.id.clone(),
        codecs: video.codecs.clone(),
        width: video.width,
        height: video.height,
        bandwidth: video.bandwidth,
        audio_lang: audio.lang.clone(),
        pssh: manifest.pssh.as_ref().map(|p| base64::engine::general_purpose::STANDARD.encode(p)),
        clear: true,
    };
    // Written last: a folder without it is an unfinished download.
    tokio::fs::write(dir.join(SAVED_INFO), serde_json::to_vec_pretty(&saved)?).await?;
    Ok(SaveResult { bytes: total, height: video.height })
}

/// The file head (ftyp + moov + sidx), parsed and with encryption removed, plus the file size.
async fn head(url: &str) -> Result<(Head, u64)> {
    const HEAD_BYTES: u64 = 64 * 1024;
    const HEAD_BYTES_MAX: u64 = 1024 * 1024;
    let mut want = HEAD_BYTES;
    loop {
        let bytes = range(url, 0, want - 1).await?;
        match fmp4::parse_head(&bytes) {
            Ok(head) => return Ok((head, bytes.len() as u64)),
            // The index may sit further in than the first read reached.
            Err(_) if want < HEAD_BYTES_MAX && bytes.len() as u64 == want => want *= 4,
            Err(e) => return Err(e),
        }
    }
}

/// Fetches `url`, decrypts every fragment and writes one clear fMP4 to `path`, byte layout preserved.
/// `report` gets the running byte count on the original (encrypted) scale the player showed.
///
/// Fragments are prefetched in order and handed to whichever of `cdms` is free; each lane is a
/// blocking thread making its Decrypt calls back-to-back (no async yield between them) and writing
/// its clear fragment at the fragment's own offset, which the clear layout keeps. So lanes may finish
/// out of order without a reorder buffer. A lane whose instance fails hands its fragment back and
/// drops out; the rest carry on, and the save fails only when no lane is left.
#[allow(clippy::too_many_arguments)]
async fn decrypt_to_file(
    url: &str,
    path: &Path,
    head: Head,
    kids: Vec<[u8; 16]>,
    cdms: Vec<Arc<Cdm>>,
    total: u64,
    cancel: &Arc<AtomicBool>,
    report: &mut impl FnMut(u64),
) -> Result<u64> {
    anyhow::ensure!(!cdms.is_empty(), "no module instance to decrypt with");
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string();
    // Any leading gap before the first fragment (a nonzero sidx first_offset) is copied unchanged.
    let header_end = head.header.len() as u64;
    let first_offset = head.fragments.first().map(|(o, _)| *o).unwrap_or(header_end);
    let gap = if first_offset > header_end { range(url, header_end, first_offset - 1).await? } else { Vec::new() };
    // Any trailing bytes past the last fragment are copied unchanged.
    let last_end = head.fragments.last().map(|(o, s)| o + s).unwrap_or(header_end);
    let tail = if last_end < total { range(url, last_end, total - 1).await? } else { Vec::new() };

    let file = std::fs::File::create(path).with_context(|| format!("{} could not be created", path.display()))?;
    write_at(&file, &head.header, 0)?; // cleared ftyp + moov (encv→avc1/enca→mp4a) + sidx
    write_at(&file, &gap, header_end)?;
    write_at(&file, &tail, last_end)?;
    let file = Arc::new(file);
    let fixed = header_end + gap.len() as u64 + tail.len() as u64;

    let lanes = cdms.len();
    let rx = spawn_prefetch(url.to_string(), head.fragments.clone(), prefetch_depth().max(2 * lanes + 2), cancel.clone());
    let rx = Arc::new(Mutex::new(rx));
    let (prog_tx, mut prog_rx) = tokio::sync::mpsc::unbounded_channel::<u64>();
    let _ = prog_tx.send(fixed);
    // Fragments a failed lane could not finish, still encrypted, for the surviving lanes.
    let orphans: Arc<Mutex<Vec<(usize, Vec<u8>)>>> = Arc::default();
    let started = Instant::now();
    let mut workers = Vec::new();
    for (lane, cdm) in cdms.iter().cloned().enumerate() {
        let (rx, file, orphans, prog_tx, cancel, kids, name) = (rx.clone(), file.clone(), orphans.clone(), prog_tx.clone(), cancel.clone(), kids.clone(), name.clone());
        let offsets: Vec<u64> = head.fragments.iter().map(|(o, _)| *o).collect();
        let iv_size = head.iv_size;
        workers.push(tauri::async_runtime::spawn_blocking(move || -> Result<(usize, usize)> {
            cdm::full_speed_thread();
            let (mut frags, mut calls) = (0usize, 0usize);
            loop {
                if cancel.load(Ordering::SeqCst) {
                    bail!("paused");
                }
                let orphan = orphans.lock().map_err(|_| anyhow!("decrypt queue poisoned"))?.pop();
                let (idx, frag) = match orphan {
                    Some(o) => o,
                    None => {
                        // Hold the queue only to take the next fragment; the decrypt runs unlocked.
                        let next = rx.lock().map_err(|_| anyhow!("decrypt queue poisoned"))?.blocking_recv();
                        match next {
                            Some(item) => item.with_context(|| format!("{name} fragment could not be fetched"))?,
                            None => break,
                        }
                    }
                };
                let mut work = frag.clone();
                let samples = fmp4::plan_fragment(&mut work, iv_size)?;
                let count = samples.len();
                let (mut clear, result) = cdm.decrypt(work, kids.clone(), samples);
                if let Err(e) = result {
                    clear.fill(0);
                    if lanes > 1 {
                        eprintln!("[widevine] {name} lane {lane} dropped after {frags} fragments: {e:#}");
                        orphans.lock().map_err(|_| anyhow!("decrypt queue poisoned"))?.push((idx, frag));
                        return Err(e).with_context(|| format!("{name} lane {lane} could not decrypt"));
                    }
                    return Err(e).with_context(|| format!("{name} could not be decrypted"));
                }
                write_at(&file, &clear, offsets[idx])?;
                clear.fill(0); // the clear fragment is on disk now; don't leave it in memory
                frags += 1;
                calls += count;
                let _ = prog_tx.send(clear.len() as u64);
            }
            Ok((frags, calls))
        }));
    }
    drop(prog_tx);
    let mut written = 0u64;
    while let Some(n) = prog_rx.recv().await {
        written += n;
        report(written);
    }
    let mut first_error = None;
    let mut survivors = Vec::new();
    for (lane, w) in workers.into_iter().enumerate() {
        match w.await.map_err(|e| anyhow!("decrypt task failed: {e}")).and_then(|r| r) {
            Ok((frags, calls)) => {
                eprintln!("[widevine] {name} lane {lane}: {frags} fragments, {calls} samples");
                survivors.push(lane);
            }
            Err(e) => {
                if e.to_string() == "paused" {
                    bail!("paused");
                }
                first_error.get_or_insert(e);
            }
        }
    }
    // A lane that dropped out after the others finished leaves its fragment for a survivor.
    let left: Vec<(usize, Vec<u8>)> = std::mem::take(&mut *orphans.lock().map_err(|_| anyhow!("decrypt queue poisoned"))?);
    if !left.is_empty() {
        let Some(&lane) = survivors.first() else {
            return Err(first_error.unwrap_or_else(|| anyhow!("{name} could not be decrypted")));
        };
        for (idx, mut frag) in left {
            let samples = fmp4::plan_fragment(&mut frag, head.iv_size)?;
            let cdm = cdms[lane].clone();
            let kids = kids.clone();
            let (mut clear, result) = blocking(move || Ok(cdm.decrypt(frag, kids, samples))).await?;
            if let Err(e) = result {
                clear.fill(0);
                return Err(e).with_context(|| format!("{name} could not be decrypted"));
            }
            write_at(&file, &clear, head.fragments[idx].0)?;
            written += clear.len() as u64;
            clear.fill(0);
        }
    }
    if survivors.is_empty() || written != total {
        if let Some(e) = first_error {
            return Err(e);
        }
    }
    file.sync_all().ok();
    eprintln!("[widevine] {name}: {} lanes ({} finished), {:.1}s", lanes, survivors.len(), started.elapsed().as_secs_f64());
    anyhow::ensure!(written == total, "wrote {written} of {total} bytes");
    report(written);
    Ok(written)
}

/// Writes all of `buf` at byte `offset` of `file`, without moving a shared cursor, so several lanes can
/// fill one file concurrently.
fn write_at(file: &std::fs::File, buf: &[u8], offset: u64) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        file.write_all_at(buf, offset)?;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut done = 0usize;
        while done < buf.len() {
            let n = file.seek_write(&buf[done..], offset + done as u64)?;
            anyhow::ensure!(n > 0, "the disk refused a write");
            done += n;
        }
    }
    Ok(())
}
/// How many fragments to fetch ahead of the module (`IZUMI_WIDEVINE_PREFETCH`, default 6), so the next
/// fragment is always in hand when a lane finishes one: measured, the lanes then wait well under a
/// second on the network across a whole episode.
fn prefetch_depth() -> usize {
    std::env::var("IZUMI_WIDEVINE_PREFETCH").ok().and_then(|v| v.parse().ok()).filter(|d| *d > 0).unwrap_or(6)
}

/// Fetches a track's fragments ahead of the consumer and delivers them in order. Up to `depth`
/// range requests are in flight at once, so fetch overlaps the module work and the consumer never
/// waits on the network — keeping the module fed back-to-back. Each item is `(index, bytes)` or an
/// error that ends the stream.
fn spawn_prefetch(url: String, fragments: Vec<(u64, u64)>, depth: usize, cancel: Arc<AtomicBool>) -> tokio::sync::mpsc::Receiver<Result<(usize, Vec<u8>)>> {
    // One extra slot so a fetch can complete while the consumer holds one.
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<(usize, Vec<u8>)>>(depth + 1);
    tauri::async_runtime::spawn(async move {
        use std::collections::VecDeque;
        let mut inflight: VecDeque<(usize, _)> = VecDeque::new();
        let mut next = 0usize;
        loop {
            // Keep the window full.
            while inflight.len() < depth && next < fragments.len() {
                let (offset, size) = fragments[next];
                let u = url.clone();
                inflight.push_back((next, tauri::async_runtime::spawn(async move {
                    let frag = range(&u, offset, offset + size - 1).await?;
                    anyhow::ensure!(frag.len() as u64 == size, "short fragment read ({} of {size})", frag.len());
                    Ok::<Vec<u8>, anyhow::Error>(frag)
                })));
                next += 1;
            }
            let Some((idx, handle)) = inflight.pop_front() else { break };
            if cancel.load(Ordering::SeqCst) {
                handle.abort();
                let _ = tx.send(Err(anyhow!("paused"))).await;
                return;
            }
            let item = match handle.await {
                Ok(Ok(bytes)) => Ok((idx, bytes)),
                Ok(Err(e)) => Err(e),
                Err(e) => Err(anyhow!("fragment fetch task failed: {e}")),
            };
            let is_err = item.is_err();
            if tx.send(item).await.is_err() || is_err {
                return; // consumer gone, or the error ends the stream
            }
        }
    });
    rx
}

/// The ffmpeg the app ships or the user has, for the video re-encode. `IZUMI_FFMPEG_PATH` wins.
fn ffmpeg_path() -> std::path::PathBuf {
    std::env::var_os("IZUMI_FFMPEG_PATH").map(Into::into).unwrap_or_else(|| "ffmpeg".into())
}

/// The ffmpeg output arguments for the video re-encode with `codec`. libx264 (the default) runs at a
/// fast preset and a near-lossless CRF; `IZUMI_WIDEVINE_CRF` and `IZUMI_WIDEVINE_PRESET` override
/// them, and map onto each hardware encoder's own constant-quality control. A re-encode is unavoidable
/// (the module only hands back decoded frames for the samples it refuses decrypt-only), so this biases
/// to a quick encode at a quality the eye cannot tell from the source.
fn encoder_args(codec: &str) -> Vec<String> {
    let crf = std::env::var("IZUMI_WIDEVINE_CRF").ok();
    let preset = std::env::var("IZUMI_WIDEVINE_PRESET").ok();
    let mut args: Vec<String> = Vec::new();
    // The frames arrive as yuv420p; QSV wants NV12 and VAAPI wants them uploaded to the GPU.
    let pix_fmt = if codec.contains("qsv") {
        Some("nv12")
    } else if codec.contains("vaapi") {
        args.extend(["-vaapi_device".into(), "/dev/dri/renderD128".into(), "-vf".into(), "format=nv12,hwupload".into()]);
        None
    } else {
        Some("yuv420p")
    };
    args.extend(["-c:v".into(), codec.to_string()]);
    if codec.starts_with("libx26") {
        // Software x264/x265: superfast is a large speed win over veryfast at a tiny size cost; CRF 16
        // stays visually lossless for anime. CRF's perceptual meaning is preset-independent.
        args.extend(["-preset".into(), preset.unwrap_or_else(|| "superfast".into())]);
        args.extend(["-crf".into(), crf.unwrap_or_else(|| "16".into())]);
    } else if codec.contains("nvenc") {
        args.extend(["-preset".into(), preset.unwrap_or_else(|| "p4".into())]);
        args.extend(["-rc".into(), "vbr".into(), "-cq".into(), crf.unwrap_or_else(|| "19".into()), "-b:v".into(), "0".into()]);
    } else if codec.contains("qsv") {
        args.extend(["-preset".into(), preset.unwrap_or_else(|| "faster".into())]);
        args.extend(["-global_quality".into(), crf.unwrap_or_else(|| "19".into())]);
    } else if codec.contains("vaapi") {
        args.extend(["-qp".into(), crf.unwrap_or_else(|| "19".into())]);
    } else if codec.contains("amf") {
        args.extend(["-rc".into(), "cqp".into()]);
        let q = crf.unwrap_or_else(|| "19".into());
        args.extend(["-qp_i".into(), q.clone(), "-qp_p".into(), q]);
    } else {
        // Unknown encoder: pass preset/CRF through if given, else trust its defaults.
        if let Some(p) = preset {
            args.extend(["-preset".into(), p]);
        }
        if let Some(c) = crf {
            args.extend(["-crf".into(), c]);
        }
    }
    if let Some(f) = pix_fmt {
        args.extend(["-pix_fmt".into(), f.into()]);
    }
    args
}
/// Video facts the decode lanes and the encoder share.
#[derive(Clone)]
struct VideoSetup {
    profile: u32,
    avcc: Vec<u8>,
    param_sets: Vec<u8>,
    width: u32,
    height: u32,
    fps: f64,
    frame_size: usize,
    kid: [u8; 16],
    iv_size: u8,
    timescale: u32,
}

/// The video could not be split by fragment (a fragment does not open on an IDR, or decoding one on
/// its own did not give back every picture); the caller redoes the video on one lane.
#[derive(Debug)]
struct NotSplittable(String);
impl std::fmt::Display for NotSplittable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "the video cannot be split by fragment: {}", self.0)
    }
}
impl std::error::Error for NotSplittable {}

/// How much decoded video may wait in memory for its turn at the encoder when video is split across
/// lanes. Order is not free: there is one encoder and it must see pictures in presentation order, but
/// lanes finish fragments out of order. So `decode_lanes` hands each lane's whole decoded fragment to
/// an orderer that releases fragments strictly by index, and a lane may not start a fragment more than
/// one window (its lane count) ahead of the last one the encoder took. In the worst case every lane
/// but the one holding the oldest fragment sits on a complete decoded fragment, so the pictures in
/// memory are about (lanes - 1) x frames per fragment x picture size. Pictures are large (a 1080p
/// I420 frame is ~3 MB, a 4s fragment ~300 MB), so this budget caps the video lane count rather than
/// letting the reorder buffer grow with the lane count on a small device.
const VIDEO_REORDER_BUDGET: u64 = 512 * 1024 * 1024;

/// How many video lanes fit the reorder budget: each lane beyond the first may hold one whole decoded
/// fragment that is waiting for an earlier one (854x480 at 4s fragments: 7; 1080p: 1).
fn video_lane_cap(head: &Head) -> usize {
    let frame = head.width as u64 * head.height as u64 * 3 / 2;
    let secs = head.fragment_durations.iter().copied().max().unwrap_or(0) as f64 / head.timescale.max(1) as f64;
    // 30 fps bounds anime and most TV; a higher rate only means the cap is a little generous.
    let per_fragment = (frame as f64 * (secs * 30.0).max(1.0)) as u64;
    if per_fragment == 0 {
        return 1;
    }
    (VIDEO_REORDER_BUDGET / per_fragment).clamp(1, 8) as usize
}

/// Decodes every video sample through the module and re-encodes the I420 pictures to clear H.264 at
/// `path`, muxing nothing else. The module refuses decrypt-only output for some non-reference frames,
/// so decoding (which always works) is the only way to a complete clear video.
///
/// With several `cdms` the fragments are spread over them (each fragment opens on an IDR, so it
/// decodes on its own) and the pictures are put back in order before the one encoder. With one, the
/// fragments go through one decoder back-to-back. Either way a prefetcher fetches ahead and a writer
/// task feeds ffmpeg, so neither the network nor the encoder stalls the module.
#[allow(clippy::too_many_arguments)]
async fn encode_video(url: &str, path: &Path, head: Head, kids: Vec<[u8; 16]>, cdms: Vec<Arc<Cdm>>, total: u64, cancel: &Arc<AtomicBool>, report: &mut impl FnMut(u64)) -> Result<u64> {
    anyhow::ensure!(!cdms.is_empty(), "no module instance to decode with");
    let avcc = head.avcc.clone().context("the video track has no avcC")?;
    let (profile, param_sets) = fmp4::param_sets(&avcc)?;
    let (width, height) = (head.width, head.height);
    anyhow::ensure!(width > 0 && height > 0 && head.timescale > 0, "the video track is missing its size or timescale");
    let (frame_dur, opens_on_idr) = {
        // The first fragment's first sample gives the frame duration (timescale units per frame).
        let (o, s) = head.fragments.first().copied().context("the video has no fragments")?;
        let mut frag = range(url, o, o + s - 1).await?;
        let samples = fmp4::plan_fragment(&mut frag, head.iv_size)?;
        let first = samples.first().context("the video has no samples")?;
        let idr = fmp4::has_idr(&frag[first.offset..first.offset + first.size]);
        frag.fill(0);
        (first.duration as u64, idr)
    };
    anyhow::ensure!(frame_dur > 0, "the video has no sample duration");
    let setup = VideoSetup {
        profile,
        avcc,
        param_sets,
        width,
        height,
        fps: head.timescale as f64 / frame_dur as f64,
        frame_size: width as usize * height as usize + 2 * (width as usize).div_ceil(2) * (height as usize).div_ceil(2),
        kid: kids.first().copied().context("no content key for the video")?,
        iv_size: head.iv_size,
        timescale: head.timescale,
    };
    let encoder = select_encoder().await;

    // Initialise each lane's decoder; a lane whose decoder will not start is dropped.
    let mut lanes = Vec::new();
    for c in cdms {
        let (s, c2) = (setup.clone(), c.clone());
        match blocking(move || c2.video_init(s.profile, s.width as i32, s.height as i32, s.avcc)).await {
            Ok(()) => lanes.push(c),
            Err(e) if lanes.is_empty() => return Err(e).context("the module could not initialise its H.264 decoder"),
            Err(e) => eprintln!("[widevine] video lane dropped: {e:#}"),
        }
    }
    if lanes.len() > 1 && !opens_on_idr {
        eprintln!("[widevine] video fragments do not open on an IDR; decoding on one lane");
        lanes.truncate(1);
    }
    let first = lanes[0].clone();
    let fragments = head.fragments.clone();
    let mut result = run_video(url, path, &setup, &encoder, &fragments, lanes, total, cancel, report).await;
    if let Err(e) = &result {
        if let Some(why) = e.downcast_ref::<NotSplittable>() {
            eprintln!("[widevine] {why}; redoing the video on one lane");
            let c = first.clone();
            blocking(move || c.video_reset()).await?;
            result = run_video(url, path, &setup, &encoder, &fragments, vec![first], total, cancel, report).await;
        }
    }
    result
}

/// One attempt at the video: starts ffmpeg, decodes on `lanes`, and waits for the encoder.
#[allow(clippy::too_many_arguments)]
async fn run_video(url: &str, path: &Path, setup: &VideoSetup, encoder: &[String], fragments: &[(u64, u64)], lanes: Vec<Arc<Cdm>>, total: u64, cancel: &Arc<AtomicBool>, report: &mut impl FnMut(u64)) -> Result<u64> {
    use tokio::process::Command;
    // ffmpeg reads tightly packed yuv420p frames from stdin and writes H.264.
    let mut command = Command::new(ffmpeg_path());
    command
        .arg("-hide_banner").arg("-loglevel").arg("error").arg("-y")
        .arg("-f").arg("rawvideo").arg("-pix_fmt").arg("yuv420p")
        .arg("-s").arg(format!("{}x{}", setup.width, setup.height)).arg("-r").arg(format!("{:.6}", setup.fps))
        .arg("-i").arg("-")
        .args(encoder)
        .arg("-movflags").arg("+faststart")
        .arg(path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = command.spawn().map_err(|e| anyhow!("the video re-encoder (ffmpeg) could not be started: {e}. Install ffmpeg or set IZUMI_FFMPEG_PATH."))?;
    #[cfg(windows)]
    if let Some(handle) = child.raw_handle() {
        // The encoder is part of the save the user is waiting on: keep it out of EcoQoS too.
        use windows::Win32::System::Threading::{SetProcessInformation, ProcessPowerThrottling, PROCESS_POWER_THROTTLING_CURRENT_VERSION, PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE};
        let state = PROCESS_POWER_THROTTLING_STATE { Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION, ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED, StateMask: 0 };
        // SAFETY: the child's live process handle and a correctly sized state struct.
        let _ = unsafe { SetProcessInformation(windows::Win32::Foundation::HANDLE(handle), ProcessPowerThrottling, &state as *const _ as *const std::ffi::c_void, std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32) };
    }
    let mut stdin = child.stdin.take().context("ffmpeg has no stdin")?;
    let stderr = child.stderr.take();

    // A writer task drains decoded frames into ffmpeg so the decoders never block on the encoder; the
    // emptied frame buffers come back (zeroed) for reuse instead of a fresh allocation per frame.
    let (frame_tx, mut frame_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(prefetch_depth().max(4));
    let (pool_tx, pool_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let pool_rx = Arc::new(Mutex::new(pool_rx));
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(mut pixels) = frame_rx.recv().await {
            let written = stdin.write_all(&pixels).await;
            pixels.fill(0);
            let _ = pool_tx.send(pixels);
            if let Err(e) = written {
                return Err(anyhow!("writing a frame to ffmpeg failed: {e}"));
            }
        }
        drop(stdin); // close ffmpeg's input so it finishes encoding
        Ok::<(), anyhow::Error>(())
    });

    let wall = Instant::now();
    let lane_count = lanes.len();
    let decoded = if lane_count == 1 {
        decode_one_lane(url, setup, fragments, lanes[0].clone(), frame_tx, pool_rx, cancel, report).await
    } else {
        decode_lanes(url, setup, fragments, lanes, frame_tx, pool_rx, cancel, report).await
    };
    // The decoders owned the frame sender, so the writer now closes ffmpeg's stdin.
    let write_result = writer.await.map_err(|e| anyhow!("video writer task failed: {e}"))?;
    if decoded.is_err() {
        let _ = child.start_kill();
    }
    let status = child.wait().await.context("waiting for ffmpeg failed")?;
    let (frames, [t_fetch, t_module, t_encoder]) = decoded?;
    if !status.success() {
        let detail = match stderr {
            Some(mut e) => {
                use tokio::io::AsyncReadExt;
                let mut s = String::new();
                let _ = e.read_to_string(&mut s).await;
                s.lines().last().unwrap_or("").to_string()
            }
            None => String::new(),
        };
        bail!("ffmpeg failed to encode the video{}", if detail.is_empty() { String::new() } else { format!(": {detail}") });
    }
    write_result?;
    let secs = frames as f64 / setup.fps.max(0.001);
    let wall_s = wall.elapsed().as_secs_f64().max(0.001);
    eprintln!(
        "[widevine] video: {frames} frames ({secs:.1}s media) on {lane_count} lane(s) in {wall_s:.1}s = {:.2}x realtime, {:.1} fps | waiting on fetch {:.1}s, in module {:.1}s (summed over lanes), on encoder {:.1}s",
        secs / wall_s,
        frames as f64 / wall_s,
        t_fetch.as_secs_f64(),
        t_module.as_secs_f64(),
        t_encoder.as_secs_f64()
    );
    report(total);
    Ok(total)
}

/// Seconds spent waiting for a fragment, inside the module, and waiting on the encoder.
type VideoTimes = [Duration; 3];

/// The whole video through one decoder, fragments back-to-back on one blocking thread.
#[allow(clippy::too_many_arguments)]
async fn decode_one_lane(
    url: &str,
    setup: &VideoSetup,
    fragments: &[(u64, u64)],
    cdm: Arc<Cdm>,
    frame_tx: tokio::sync::mpsc::Sender<Vec<u8>>,
    pool: Arc<Mutex<std::sync::mpsc::Receiver<Vec<u8>>>>,
    cancel: &Arc<AtomicBool>,
    report: &mut impl FnMut(u64),
) -> Result<(usize, VideoTimes)> {
    let rx = spawn_prefetch(url.to_string(), fragments.to_vec(), prefetch_depth(), cancel.clone());
    let (prog_tx, mut prog_rx) = tokio::sync::mpsc::unbounded_channel::<u64>();
    let setup = setup.clone();
    let decoder = tauri::async_runtime::spawn_blocking(move || -> Result<(usize, VideoTimes)> {
        cdm::full_speed_thread();
        let mut rx = rx;
        let mut fresh = true; // after init the decoder needs SPS/PPS before the first IDR
        let mut frames = 0usize;
        let (mut t_fetch, mut t_module, mut t_encoder) = (Duration::ZERO, Duration::ZERO, Duration::ZERO);
        let buffer = || pool.lock().ok().and_then(|p| p.try_recv().ok()).unwrap_or_else(|| vec![0u8; setup.frame_size]);
        let emit = |pixels: Vec<u8>, t_encoder: &mut Duration| -> Result<()> {
            let t = Instant::now();
            frame_tx.blocking_send(pixels).map_err(|_| anyhow!("the video encoder stopped early"))?;
            *t_encoder += t.elapsed();
            Ok(())
        };
        loop {
            let t = Instant::now();
            let next = rx.blocking_recv();
            t_fetch += t.elapsed();
            let Some(item) = next else { break };
            let (frag_i, mut frag) = item?;
            let size = frag.len() as u64;
            let samples = fmp4::plan_fragment(&mut frag, setup.iv_size)?;
            for s in &samples {
                let (data, subs) = access_unit(&frag, s, &setup, fresh)?;
                fresh = false;
                let t = Instant::now();
                let (mut buf, pic) = cdm.video_decode(setup.kid, s.iv.clone(), subs, Some(data), ts_us(s, setup.timescale), buffer());
                t_module += t.elapsed();
                match pic {
                    Ok(Some(_)) => {
                        emit(buf, &mut t_encoder)?;
                        frames += 1;
                    }
                    Ok(None) => buf.fill(0),
                    Err(e) => {
                        buf.fill(0);
                        return Err(e).with_context(|| format!("video fragment {frag_i}, sample size {}", s.size));
                    }
                }
            }
            frag.fill(0);
            let _ = prog_tx.send(size);
        }
        // Drain the decoder so reordered frames at the end are emitted.
        loop {
            let t = Instant::now();
            let (mut buf, pic) = cdm.video_decode(setup.kid, vec![0u8; 8], Vec::new(), None, 0, buffer());
            t_module += t.elapsed();
            match pic? {
                Some(_) => {
                    emit(buf, &mut t_encoder)?;
                    frames += 1;
                }
                None => {
                    buf.fill(0);
                    break;
                }
            }
        }
        Ok((frames, [t_fetch, t_module, t_encoder]))
    });
    let mut consumed = 0u64;
    while let Some(n) = prog_rx.recv().await {
        consumed += n;
        report(consumed);
    }
    decoder.await.map_err(|e| anyhow!("video decode task failed: {e}"))?
}

/// One video sample as the module's decoder wants it: Annex B, with the SPS/PPS in front when `fresh`.
fn access_unit(frag: &[u8], s: &fmp4::Sample, setup: &VideoSetup, fresh: bool) -> Result<(Vec<u8>, Vec<(u32, u32)>)> {
    let mut data = frag[s.offset..s.offset + s.size].to_vec();
    let mut subs = s.subsamples.clone();
    fmp4::to_annex_b(&mut data, &subs)?;
    if fresh {
        let prefix = setup.param_sets.len() as u32;
        data.splice(0..0, setup.param_sets.iter().copied());
        if let Some(first) = subs.first_mut() {
            first.0 += prefix;
        }
    }
    Ok((data, subs))
}

fn ts_us(s: &fmp4::Sample, timescale: u32) -> i64 {
    ((s.dts as i64 + s.cto) as i128 * 1_000_000 / timescale.max(1) as i128) as i64
}

/// Decodes one whole fragment on `cdm` from a fresh decoder state and returns its pictures in
/// presentation order: every sample, then a drain, then a reset so the next fragment starts clean.
fn decode_fragment(cdm: &Cdm, setup: &VideoSetup, idx: usize, frag: &[u8], pool: &Mutex<std::sync::mpsc::Receiver<Vec<u8>>>) -> Result<(Vec<Vec<u8>>, Duration)> {
    let mut frag = frag.to_vec();
    let samples = fmp4::plan_fragment(&mut frag, setup.iv_size)?;
    let first = samples.first().ok_or_else(|| NotSplittable(format!("fragment {idx} has no samples")))?;
    if !fmp4::has_idr(&frag[first.offset..first.offset + first.size]) {
        frag.fill(0);
        return Err(NotSplittable(format!("fragment {idx} does not open on an IDR")).into());
    }
    let buffer = || pool.lock().ok().and_then(|p| p.try_recv().ok()).unwrap_or_else(|| vec![0u8; setup.frame_size]);
    let mut pictures = Vec::with_capacity(samples.len());
    let mut t_module = Duration::ZERO;
    let result = (|| -> Result<()> {
        for (n, s) in samples.iter().enumerate() {
            let (data, subs) = access_unit(&frag, s, setup, n == 0)?;
            let t = Instant::now();
            let (mut buf, pic) = cdm.video_decode(setup.kid, s.iv.clone(), subs, Some(data), ts_us(s, setup.timescale), buffer());
            t_module += t.elapsed();
            match pic {
                Ok(Some(_)) => pictures.push(buf),
                Ok(None) => buf.fill(0),
                Err(e) => {
                    buf.fill(0);
                    return Err(e).with_context(|| format!("video fragment {idx}, sample size {}", s.size));
                }
            }
        }
        loop {
            let t = Instant::now();
            let (mut buf, pic) = cdm.video_decode(setup.kid, vec![0u8; 8], Vec::new(), None, 0, buffer());
            t_module += t.elapsed();
            match pic? {
                Some(_) => pictures.push(buf),
                None => {
                    buf.fill(0);
                    break;
                }
            }
        }
        cdm.video_reset()?;
        Ok(())
    })();
    frag.fill(0);
    if let Err(e) = result {
        for p in &mut pictures {
            p.fill(0);
        }
        return Err(e);
    }
    if pictures.len() != samples.len() {
        for p in &mut pictures {
            p.fill(0);
        }
        return Err(NotSplittable(format!("fragment {idx} gave {} pictures for {} samples", pictures.len(), samples.len())).into());
    }
    Ok((pictures, t_module))
}

/// The video spread over several lanes by fragment. Each lane takes the next fetched fragment,
/// decodes it on its own instance and hands the pictures to an orderer that feeds the encoder in
/// fragment order. A lane may run at most `window` fragments ahead of the encoder, which bounds the
/// pictures waiting in memory. A lane whose instance fails hands its fragment back and drops out.
#[allow(clippy::too_many_arguments)]
async fn decode_lanes(
    url: &str,
    setup: &VideoSetup,
    fragments: &[(u64, u64)],
    lanes: Vec<Arc<Cdm>>,
    frame_tx: tokio::sync::mpsc::Sender<Vec<u8>>,
    pool: Arc<Mutex<std::sync::mpsc::Receiver<Vec<u8>>>>,
    cancel: &Arc<AtomicBool>,
    report: &mut impl FnMut(u64),
) -> Result<(usize, VideoTimes)> {
    let count = fragments.len();
    let window = lanes.len();
    let rx = Arc::new(Mutex::new(spawn_prefetch(url.to_string(), fragments.to_vec(), prefetch_depth().max(2 * window + 2), cancel.clone())));
    let orphans: Arc<Mutex<Vec<(usize, Vec<u8>)>>> = Arc::default();
    let next_write = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    // Set when splitting turns out not to work, so every lane stops.
    let abort = Arc::new(AtomicBool::new(false));
    let (done_tx, mut done_rx) = tokio::sync::mpsc::unbounded_channel::<(usize, Vec<Vec<u8>>, u64)>();
    let mut workers = Vec::new();
    for (lane, cdm) in lanes.iter().cloned().enumerate() {
        let (rx, orphans, next_write, abort, done_tx, pool, cancel, setup) = (rx.clone(), orphans.clone(), next_write.clone(), abort.clone(), done_tx.clone(), pool.clone(), cancel.clone(), setup.clone());
        workers.push(tauri::async_runtime::spawn_blocking(move || -> Result<(usize, Duration, Duration)> {
            cdm::full_speed_thread();
            let (mut frags, mut t_module, mut t_fetch) = (0usize, Duration::ZERO, Duration::ZERO);
            loop {
                if cancel.load(Ordering::SeqCst) {
                    bail!("paused");
                }
                if abort.load(Ordering::SeqCst) {
                    return Ok((frags, t_module, t_fetch));
                }
                let orphan = orphans.lock().map_err(|_| anyhow!("video queue poisoned"))?.pop();
                let (idx, frag) = match orphan {
                    Some(o) => o,
                    None => {
                        let t = Instant::now();
                        let next = rx.lock().map_err(|_| anyhow!("video queue poisoned"))?.blocking_recv();
                        t_fetch += t.elapsed();
                        match next {
                            Some(item) => item?,
                            None => return Ok((frags, t_module, t_fetch)),
                        }
                    }
                };
                // Do not run more than `window` fragments ahead of the encoder.
                while idx >= next_write.load(Ordering::SeqCst) + window && !abort.load(Ordering::SeqCst) && !cancel.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(2));
                }
                let size = frag.len() as u64;
                match decode_fragment(&cdm, &setup, idx, &frag, &pool) {
                    Ok((pictures, t)) => {
                        t_module += t;
                        frags += 1;
                        if done_tx.send((idx, pictures, size)).is_err() {
                            return Ok((frags, t_module, t_fetch));
                        }
                    }
                    Err(e) if e.is::<NotSplittable>() => {
                        abort.store(true, Ordering::SeqCst);
                        return Err(e);
                    }
                    Err(e) => {
                        eprintln!("[widevine] video lane {lane} dropped after {frags} fragments: {e:#}");
                        let _ = cdm.video_reset();
                        orphans.lock().map_err(|_| anyhow!("video queue poisoned"))?.push((idx, frag));
                        return Err(e);
                    }
                }
            }
        }));
    }
    drop(done_tx);

    // The orderer: pictures go to the encoder strictly in fragment order.
    let (mut pending, mut written, mut frames, mut consumed) = (std::collections::BTreeMap::new(), 0usize, 0usize, 0u64);
    let mut t_encoder = Duration::ZERO;
    let place = |pending: &mut std::collections::BTreeMap<usize, (Vec<Vec<u8>>, u64)>, written: &mut usize| -> Vec<(Vec<Vec<u8>>, u64)> {
        let mut ready = Vec::new();
        while let Some(entry) = pending.remove(written) {
            ready.push(entry);
            *written += 1;
        }
        ready
    };
    while let Some((idx, pictures, size)) = done_rx.recv().await {
        pending.insert(idx, (pictures, size));
        for (pictures, size) in place(&mut pending, &mut written) {
            let t = Instant::now();
            for p in pictures {
                frame_tx.send(p).await.map_err(|_| anyhow!("the video encoder stopped early"))?;
                frames += 1;
            }
            t_encoder += t.elapsed();
            next_write.fetch_add(1, Ordering::SeqCst);
            consumed += size;
            report(consumed);
        }
    }
    let (mut t_module, mut t_fetch, mut first_error, mut survivor) = (Duration::ZERO, Duration::ZERO, None, None);
    for (lane, w) in workers.into_iter().enumerate() {
        match w.await.map_err(|e| anyhow!("video decode task failed: {e}")).and_then(|r| r) {
            Ok((frags, tm, tf)) => {
                eprintln!("[widevine] video lane {lane}: {frags} fragments");
                t_module += tm;
                t_fetch += tf;
                survivor.get_or_insert(lane);
            }
            Err(e) => {
                if e.is::<NotSplittable>() || e.to_string() == "paused" {
                    return Err(e);
                }
                first_error.get_or_insert(e);
            }
        }
    }
    // Fragments a lane dropped after the others finished go through a survivor, still in order.
    let left = std::mem::take(&mut *orphans.lock().map_err(|_| anyhow!("video queue poisoned"))?);
    for (idx, frag) in left {
        let Some(lane) = survivor else { break };
        let (cdm, setup, pool) = (lanes[lane].clone(), setup.clone(), pool.clone());
        let size = frag.len() as u64;
        let (pictures, t) = blocking(move || decode_fragment(&cdm, &setup, idx, &frag, &pool)).await?;
        t_module += t;
        pending.insert(idx, (pictures, size));
    }
    for (pictures, size) in place(&mut pending, &mut written) {
        for p in pictures {
            frame_tx.send(p).await.map_err(|_| anyhow!("the video encoder stopped early"))?;
            frames += 1;
        }
        consumed += size;
        report(consumed);
    }
    if written != count {
        return Err(first_error.unwrap_or_else(|| anyhow!("only {written} of {count} video fragments were decoded")));
    }
    Ok((frames, [t_fetch, t_module, t_encoder]))
}

/// The ffmpeg encoder arguments, with a requested hardware encoder checked first: if it is not there
/// (no GPU, no driver, an ffmpeg built without it) the save falls back to libx264 instead of failing.
async fn select_encoder() -> Vec<String> {
    let wanted = std::env::var("IZUMI_WIDEVINE_ENCODER").unwrap_or_else(|_| "libx264".into());
    let candidates: Vec<String> = if wanted == "auto" {
        ["h264_nvenc", "h264_qsv", "h264_amf", "h264_vaapi"].iter().map(|s| s.to_string()).collect()
    } else {
        vec![wanted]
    };
    for codec in candidates {
        if codec.starts_with("libx26") || encoder_works(&codec).await {
            eprintln!("[widevine] video encoder: {codec}");
            return encoder_args(&codec);
        }
        eprintln!("[widevine] video encoder {codec} is not available here; trying the next");
    }
    eprintln!("[widevine] video encoder: libx264");
    encoder_args("libx264")
}

/// Whether ffmpeg can actually encode with `codec` on this machine (a tiny test encode).
async fn encoder_works(codec: &str) -> bool {
    let mut command = tokio::process::Command::new(ffmpeg_path());
    command.args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=256x144:r=24:d=0.25"]);
    command.args(encoder_args(codec)).args(["-f", "null", "-"]).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    matches!(tokio::time::timeout(Duration::from_secs(15), command.status()).await, Ok(Ok(s)) if s.success())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_are_safe_and_named_after_the_episode() {
        let downloads = Path::new("/tmp/izumi-downloads");
        assert_eq!(folder_for(downloads, "Show - E01.mkv"), downloads.join("Show - E01.protected"));
        assert_eq!(folder_for(downloads, "../../etc/passwd"), downloads.join("passwd.protected"));
        assert_eq!(folder_for(downloads, "a:b?c"), downloads.join("a_b_c.protected"));
        assert_eq!(folder_for(downloads, "..."), downloads.join("episode.protected"));
    }

    // saved_dir/Saved::read are the Linux streaming player's; this exercises its temp-dir round trip.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_saved_record_round_trips_and_stays_in_its_folder() {
        let dir = std::env::temp_dir().join(format!("izumi saved - {}.protected", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let saved = Saved {
            video: "video.mp4".into(),
            audio: "audio.mp4".into(),
            video_id: "v1".into(),
            codecs: "avc1.640028".into(),
            width: 1920,
            height: 1080,
            bandwidth: 8_000_000,
            audio_lang: Some("ja-JP".into()),
            pssh: Some(base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3])),
            clear: true,
        };
        std::fs::write(dir.join(SAVED_INFO), serde_json::to_vec(&saved).unwrap()).unwrap();
        assert_eq!(Saved::read(&dir).unwrap(), saved);
        assert_eq!(saved.pssh(), Some(vec![1, 2, 3]));
        let url = url::Url::from_file_path(&dir).unwrap();
        assert_eq!(saved_dir(url.as_str()), Some(dir.clone()));
        assert_eq!(saved_dir(&format!("{url}?hard=en-US")), Some(dir.clone()));
        assert_eq!(saved_dir("https://example.test/manifest.mpd"), None);

        let escaping = Saved { video: "../secret".into(), ..saved };
        std::fs::write(dir.join(SAVED_INFO), serde_json::to_vec(&escaping).unwrap()).unwrap();
        assert!(Saved::read(&dir).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_licence_request_parses_from_the_frontend_shape() {
        let json = serde_json::json!({
            "keySystem": "com.widevine.alpha",
            "licenseUrl": "https://licence.test/acquire",
            "licenseHeaders": { "x-token": "abc" },
        });
        let licence: Licence = serde_json::from_value(json).unwrap();
        assert_eq!(licence.license_url, "https://licence.test/acquire");
        assert_eq!(licence.license_headers.unwrap().get("x-token").map(String::as_str), Some("abc"));
        assert!(licence.server_certificate_url.is_none());
    }

    #[test]
    fn a_missing_module_fails_first_with_nothing_fetched_or_written() {
        // The frontend falls back to another engine on this error, so it must come before any
        // network or disk work: the manifest URL here is unreachable and the folder must not appear.
        std::env::set_var("IZUMI_WIDEVINE_NO_SYSTEM", "1");
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target").join("test-tmp").join(format!("no-module-{}", std::process::id()));
        let (data, out) = (root.join("data"), root.join("out"));
        std::fs::create_dir_all(&data).unwrap();
        let licence = Licence { key_system: None, license_url: "http://127.0.0.1:9/licence".into(), license_headers: None, server_certificate_url: None };
        let err = tauri::async_runtime::block_on(save("no-module", "http://127.0.0.1:9/manifest.mpd", &out, None, &licence, &data, |_, _, _| {}))
            .err()
            .expect("a save without the module must fail");
        assert!(format!("{err:#}").contains(super::super::NOT_INSTALLED), "{err:#}");
        assert!(!out.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn lanes_split_so_neither_track_waits_long() {
        let sd = 854 * 480;
        // One lane: it does both tracks in turn.
        assert_eq!(lane_plan(1, 8, sd), LanePlan { total: 1, audio: 0, video: 1 });
        assert_eq!(lane_plan(2, 8, sd), LanePlan { total: 2, audio: 1, video: 1 });
        // Audio is the heavier track (~94 vs ~72 ms of module time per media second).
        assert_eq!(lane_plan(3, 8, sd), LanePlan { total: 3, audio: 2, video: 1 });
        assert_eq!(lane_plan(6, 8, sd), LanePlan { total: 6, audio: 3, video: 3 });
        // Past ~3 video lanes the 480p encoder is the limit, so the rest go to audio.
        assert_eq!(lane_plan(16, 8, sd), LanePlan { total: 16, audio: 12, video: 4 });
        // At 1080p the encoder is slower than one decoding lane: one video lane, the rest audio.
        assert_eq!(lane_plan(6, 8, 1920 * 1080), LanePlan { total: 6, audio: 5, video: 1 });
        // Video held to its reorder-memory cap.
        assert_eq!(lane_plan(8, 1, sd), LanePlan { total: 8, audio: 7, video: 1 });
        assert_eq!(lane_plan(0, 0, sd), LanePlan { total: 1, audio: 0, video: 1 });
    }
    #[test]
    fn candidate_kids_lists_the_tenc_kid_first_then_the_rest() {
        let a = [1u8; 16];
        let b = [2u8; 16];
        let c = [3u8; 16];
        // tenc KID first, then the other usable KIDs, no duplicate of the tenc KID.
        assert_eq!(candidate_kids(a, &[a, b]), vec![a, b]);
        // tenc KID not in the usable set: still tried first, then the usable ones.
        assert_eq!(candidate_kids(c, &[a, b]), vec![c, a, b]);
        // No key report at all: just the tenc KID.
        assert_eq!(candidate_kids(a, &[]), vec![a]);
    }

    // Measures the module's Decrypt cost and how it scales across instances, against a live source:
    // IZUMI_LIVE_SAVE_MANIFEST / _LICENSE / _DATA as for the live save below. IZUMI_BENCH_NS picks the
    // instance counts to try (default "1,2,3,4,6").
    #[test]
    #[ignore = "live: needs the module, a source and the network"]
    fn live_decrypt_bench() {
        tauri::async_runtime::block_on(async { decrypt_bench().await.expect("bench failed") });
    }

    async fn decrypt_bench() -> Result<()> {
        let manifest_url = std::env::var("IZUMI_LIVE_SAVE_MANIFEST")?;
        let licence = Licence { key_system: None, license_url: std::env::var("IZUMI_LIVE_SAVE_LICENSE")?, license_headers: None, server_certificate_url: None };
        let data = PathBuf::from(std::env::var("IZUMI_LIVE_SAVE_DATA")?);
        let text = client().get(&manifest_url).send().await?.text().await?;
        let manifest = mpd::parse(&text, &manifest_url)?;
        let audio = manifest.audio(None).context("no audio")?.clone();
        let (head, _) = head(&audio.url).await?;
        let init = manifest.pssh.clone().or_else(|| Some(head.pssh.clone()).filter(|p| !p.is_empty())).context("no pssh")?;
        let installed = fetch::installed(&data).context("module not installed")?;
        let lib = installed.library.clone();
        let version = blocking(move || cdm::load_module(&lib)).await?;
        eprintln!("[bench] module {version}");

        // Every audio fragment, fetched up front and concatenated so any run of samples can go to the
        // module as one job with nothing else running.
        let t = Instant::now();
        let mut rx = spawn_prefetch(audio.url.clone(), head.fragments.clone(), 12, Arc::new(AtomicBool::new(false)));
        let mut whole: Vec<u8> = Vec::new();
        let mut samples: Vec<fmp4::Sample> = Vec::new();
        let mut frag_ends: Vec<usize> = Vec::new(); // sample index where each fragment ends
        while let Some(item) = rx.recv().await {
            let (_, mut frag) = item?;
            let base = whole.len();
            for s in fmp4::plan_fragment(&mut frag, head.iv_size)? {
                samples.push(fmp4::Sample { offset: base + s.offset, ..s });
            }
            whole.extend_from_slice(&frag);
            frag_ends.push(samples.len());
        }
        eprintln!("[bench] audio: {} fragments, {} samples, {} bytes, fetched in {:.1}s", head.fragments.len(), samples.len(), whole.len(), t.elapsed().as_secs_f64());
        let whole = Arc::new(whole);
        let samples = Arc::new(samples);

        // One job decrypting samples[a..b] (rebased into a private copy). Returns the module time.
        fn job(cdm: &Cdm, whole: &[u8], samples: &[fmp4::Sample], kids: &[[u8; 16]], a: usize, b: usize) -> Result<Duration> {
            let lo = samples[a].offset;
            let hi = samples[b - 1].offset + samples[b - 1].size;
            let buf = whole[lo..hi].to_vec();
            let list: Vec<fmp4::Sample> = samples[a..b].iter().map(|s| fmp4::Sample { offset: s.offset - lo, ..s.clone() }).collect();
            let t = Instant::now();
            let (_back, r) = cdm.decrypt(buf, kids.to_vec(), list);
            let d = t.elapsed();
            r?;
            Ok(d)
        }

        let interface = installed.interface;
        let open = |lane: usize| {
            let licence = licence.clone();
            let init = init.clone();
            async move {
                let t = Instant::now();
                let (cdm, usable) = license(lane, interface, &licence, init).await?;
                Ok::<_, anyhow::Error>((cdm, candidate_kids(head.default_kid, &usable), t.elapsed()))
            }
        };

        if let Ok(frames) = std::env::var("IZUMI_BENCH_VIDEO") {
            let frames: usize = frames.parse()?;
            let video = manifest.video(Some(480), Some("avc1")).context("no video")?.clone();
            let (vh, _) = super::head(&video.url).await?;
            let avcc = vh.avcc.clone().context("no avcC")?;
            let (profile, param_sets) = fmp4::param_sets(&avcc)?;
            let frame_size = vh.width as usize * vh.height as usize + 2 * (vh.width as usize).div_ceil(2) * (vh.height as usize).div_ceil(2);
            let mut rx = spawn_prefetch(video.url.clone(), vh.fragments.clone(), 12, Arc::new(AtomicBool::new(false)));
            let mut au: Vec<(Vec<u8>, Vec<(u32, u32)>, Vec<u8>)> = Vec::new(); // (annex-b data, subsamples, iv)
            let mut frag_starts = Vec::new();
            while let Some(item) = rx.recv().await {
                let (_, mut frag) = item?;
                frag_starts.push(au.len());
                for s in fmp4::plan_fragment(&mut frag, vh.iv_size)? {
                    let mut d = frag[s.offset..s.offset + s.size].to_vec();
                    fmp4::to_annex_b(&mut d, &s.subsamples)?;
                    au.push((d, s.subsamples.clone(), s.iv.clone()));
                }
                if au.len() >= frames * 2 {
                    break;
                }
            }
            eprintln!("[bench] video {}x{}: {} AUs fetched, {} per fragment", vh.width, vh.height, au.len(), frag_starts.get(1).copied().unwrap_or(0));
            let au = Arc::new(au);
            let vkid = vh.default_kid;
            // Decodes AUs [from, to) on a fresh instance (param sets prepended to the first).
            let decode = |lane: usize, from: usize, to: usize| {
                let (lic, init, au, ps, avcc) = (licence.clone(), init.clone(), au.clone(), param_sets.clone(), avcc.clone());
                let (w, h) = (vh.width as i32, vh.height as i32);
                async move {
                    let (c, _, _) = license(lane, interface, &lic, init).await.map(|(c, k)| (c, k, ()))?;
                    blocking(move || {
                        c.video_init(profile, w, h, avcc)?;
                        let t = Instant::now();
                        let mut bucket = Instant::now();
                        for (n, i) in (from..to).enumerate() {
                            let (mut d, mut subs, iv) = au[i].clone();
                            if n == 0 {
                                d.splice(0..0, ps.iter().copied());
                                if let Some(f) = subs.first_mut() {
                                    f.0 += ps.len() as u32;
                                }
                            }
                            let (_, r) = c.video_decode(vkid, iv, subs, Some(d), i as i64 * 41_708, vec![0u8; frame_size]);
                            r?;
                            if (n + 1) % 500 == 0 && from == 0 {
                                eprintln!("[bench] 5. video lane {lane} frames {:>5}: {:.2} ms/frame", n + 1, bucket.elapsed().as_secs_f64() * 1e3 / 500.0);
                                bucket = Instant::now();
                            }
                        }
                        Ok((to - from, t.elapsed().as_secs_f64()))
                    })
                    .await
                }
            };
            let (n1, s1) = decode(0, 0, frames.min(au.len())).await?;
            eprintln!("[bench] 5. video one instance: {n1} frames in {s1:.1}s = {:.0} fps", n1 as f64 / s1);
            // Two instances on two halves starting at fragment boundaries, concurrently.
            let half = frag_starts.iter().copied().find(|&s| s >= frames.min(au.len()) / 2).unwrap_or(frames / 2);
            let end = frames.min(au.len());
            let t = Instant::now();
            let (a, b) = tokio::try_join!(decode(0, 0, half), decode(1, half, end))?;
            eprintln!("[bench] 5. video two instances: {} + {} frames in {:.1}s wall ({:.0} fps aggregate; slices {:.1}s/{:.1}s)", a.0, b.0, t.elapsed().as_secs_f64(), end as f64 / t.elapsed().as_secs_f64(), a.1, b.1);
            return Ok(());
        }

        // 1. 1,000 back-to-back Decrypt calls on one fresh instance, samples already in memory, as ONE job
        //    (no pump between calls) and as 1,000 jobs (one channel round trip per call).
        let (a, kids, lic) = open(0).await?;
        eprintln!("[bench] licence (instance A, lane 0): {:.0} ms", lic.as_secs_f64() * 1e3);
        let n = 1000.min(samples.len());
        let d = job(&a, &whole, &samples, &kids, 0, n)?;
        eprintln!("[bench] 1. one job, {n} calls: {:.1} us/call", d.as_secs_f64() * 1e6 / n as f64);
        let t = Instant::now();
        for i in n..2 * n {
            job(&a, &whole, &samples, &kids, i, i + 1)?;
        }
        eprintln!("[bench] 1. {n} jobs of 1 call: {:.1} us/call (incl. channel round trip)", t.elapsed().as_secs_f64() * 1e6 / n as f64);

        // 2. Sustained: the whole track on instance A, one fragment per job, per-call cost by bucket.
        let t = Instant::now();
        let (mut bucket_calls, mut bucket_time, mut prev) = (0usize, Duration::ZERO, 0usize);
        let mut total = 0usize;
        let cap: usize = std::env::var("IZUMI_BENCH_SUSTAIN").ok().and_then(|v| v.parse().ok()).unwrap_or(usize::MAX);
        for &end in frag_ends.iter().take(cap) {
            let d = job(&a, &whole, &samples, &kids, prev, end)?;
            bucket_calls += end - prev;
            total += end - prev;
            bucket_time += d;
            prev = end;
            if bucket_calls >= std::env::var("IZUMI_BENCH_BUCKET").ok().and_then(|v| v.parse().ok()).unwrap_or(8000) {
                eprintln!("[bench] 2. calls {:>6}: {:.1} us/call, t={:.1}s", total, bucket_time.as_secs_f64() * 1e6 / bucket_calls as f64, t.elapsed().as_secs_f64());
                bucket_calls = 0;
                bucket_time = Duration::ZERO;
            }
        }
        let sustained = t.elapsed();
        eprintln!("[bench] 2. whole track on one instance: {} calls in {:.1}s = {:.1} us/call", samples.len(), sustained.as_secs_f64(), sustained.as_secs_f64() * 1e6 / samples.len() as f64);

        // 3. Instance A again after a 5s rest, and a fresh instance B on another lane, 1,000 calls each.
        tokio::time::sleep(Duration::from_secs(5)).await;
        let d = job(&a, &whole, &samples, &kids, 0, n)?;
        eprintln!("[bench] 3. A after 5s idle, {n} calls: {:.1} us/call", d.as_secs_f64() * 1e6 / n as f64);
        let (b, kids_b, lic) = open(1).await?;
        eprintln!("[bench] licence (instance B, lane 1): {:.0} ms", lic.as_secs_f64() * 1e3);
        let d = job(&b, &whole, &samples, &kids_b, 0, n)?;
        eprintln!("[bench] 3. fresh B while A is open, {n} calls: {:.1} us/call", d.as_secs_f64() * 1e6 / n as f64);
        drop(a);
        drop(b);

        // 4. Scaling: N fresh instances on N lanes, the whole track split into N contiguous slices.
        let ns: Vec<usize> = std::env::var("IZUMI_BENCH_NS").unwrap_or_else(|_| "1,2,3,4,6".into()).split(',').filter_map(|s| s.trim().parse().ok()).collect();
        for &count in &ns {
            let mut cdms = Vec::new();
            let mut lic_ms = Vec::new();
            for lane in 0..count {
                let (c, k, lic) = open(lane).await?;
                lic_ms.push(lic.as_millis());
                cdms.push((c, k));
            }
            let per = frag_ends.len().div_ceil(count);
            let t = Instant::now();
            let mut threads = Vec::new();
            for (i, (c, k)) in cdms.iter().enumerate() {
                let (c, k, whole, samples) = (c.clone(), k.clone(), whole.clone(), samples.clone());
                let ends: Vec<usize> = frag_ends[(i * per).min(frag_ends.len())..((i + 1) * per).min(frag_ends.len())].to_vec();
                let start = if i * per == 0 { 0 } else { frag_ends[i * per - 1] };
                threads.push(std::thread::spawn(move || -> Result<(usize, f64)> {
                    let t = Instant::now();
                    let mut prev = start;
                    for end in ends {
                        job(&c, &whole, &samples, &k, prev, end)?;
                        prev = end;
                    }
                    Ok((prev - start, t.elapsed().as_secs_f64()))
                }));
            }
            let mut slices = Vec::new();
            for th in threads {
                slices.push(th.join().map_err(|_| anyhow!("bench thread panicked"))??);
            }
            let wall = t.elapsed().as_secs_f64();
            eprintln!(
                "[bench] 4. N={count}: licences {:?} ms | wall {:.1}s | {:.0} calls/s aggregate | slices {:?}",
                lic_ms,
                wall,
                samples.len() as f64 / wall,
                slices.iter().map(|(c, s)| format!("{c} in {s:.1}s")).collect::<Vec<_>>()
            );
        }
        Ok(())
    }

    // Installs the current module into IZUMI_LIVE_SAVE_DATA for the live tests on a machine that has
    // none (a fresh Linux box), recording consent as the player's prompt would.
    #[test]
    #[ignore = "live: downloads the module from Google's component service"]
    fn live_install_module() {
        let data = PathBuf::from(std::env::var("IZUMI_LIVE_SAVE_DATA").expect("IZUMI_LIVE_SAVE_DATA"));
        let staged = tauri::async_runtime::block_on(fetch::stage(&reqwest::Client::new(), &data, &|_, _| {})).expect("stage");
        let installed = fetch::accept(&data, &staged.version, "test").expect("accept");
        eprintln!("[live] installed module {} at {}", staged.version, installed.library.display());
    }

    // A real end-to-end save against a live licence server, driven by env vars so it only runs when
    // asked (it needs the module installed, a reachable source, and the network):
    //   IZUMI_LIVE_SAVE_MANIFEST  the manifest URL
    //   IZUMI_LIVE_SAVE_LICENSE   the licence URL
    //   IZUMI_LIVE_SAVE_DATA      a consented module data dir
    //   IZUMI_LIVE_SAVE_OUT       the output folder to write
    #[test]
    #[ignore = "live: needs the module, a source and the network"]
    fn live_save_writes_a_clear_file() {
        let manifest = std::env::var("IZUMI_LIVE_SAVE_MANIFEST").expect("IZUMI_LIVE_SAVE_MANIFEST");
        let licence = Licence {
            key_system: Some("com.widevine.alpha".into()),
            license_url: std::env::var("IZUMI_LIVE_SAVE_LICENSE").expect("IZUMI_LIVE_SAVE_LICENSE"),
            license_headers: None,
            server_certificate_url: None,
        };
        let data = PathBuf::from(std::env::var("IZUMI_LIVE_SAVE_DATA").expect("IZUMI_LIVE_SAVE_DATA"));
        let out = PathBuf::from(std::env::var("IZUMI_LIVE_SAVE_OUT").expect("IZUMI_LIVE_SAVE_OUT"));
        let result = tauri::async_runtime::block_on(save("live", &manifest, &out, Some(480), &licence, &data, |r, t, _| {
            if t > 0 {
                eprint!("\r[live] {r}/{t} bytes ({}%)   ", r * 100 / t);
            }
        }))
        .expect("save failed");
        eprintln!("\n[live] wrote {} bytes to {}", result.bytes, out.display());
        assert!(out.join("video.mp4").is_file() && out.join("audio.mp4").is_file());
    }
}
