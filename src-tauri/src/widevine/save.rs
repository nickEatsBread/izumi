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
async fn license(interface: i32, licence: &Licence, init_data: Vec<u8>) -> Result<(Arc<Cdm>, Vec<[u8; 16]>)> {
    if let Some(ks) = licence.key_system.as_deref() {
        anyhow::ensure!(ks == "com.widevine.alpha", "{ks} is not supported for saving");
    }
    // The CDM lives on its own thread; its calls are blocking, so they run off the async runtime.
    let (renewals_tx, _renewals_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    let cdm = Arc::new(blocking(move || Cdm::open(interface, renewals_tx)).await?);
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
    let installed = fetch::installed(data_dir).ok_or_else(|| anyhow!("{}", super::NOT_INSTALLED))?;
    let version = blocking({
        let library = installed.library.clone();
        move || cdm::load_module(&library)
    })
    .await?;
    eprintln!("[widevine] saving with module {version} (interface {})", installed.interface);
    let (cdm, usable_kids) = license(installed.interface, licence, init_data).await?;
    let audio_kids = candidate_kids(audio_head.default_kid, &usable_kids);
    let video_kids = candidate_kids(video_head.default_kid, &usable_kids);

    // Diagnostic: time N back-to-back Decrypt calls on one instance with the sample already in memory
    // and nothing else running, to confirm whether the per-call cost is the module or our pump.
    if let Ok(mode) = std::env::var("IZUMI_WIDEVINE_BENCH") {
        // Fetch a few fragments up front so distinct samples (distinct IVs) are in memory.
        let mut whole: Vec<u8> = Vec::new();
        let mut planned: Vec<(usize, usize, fmp4::Sample)> = Vec::new(); // (base, len, sample)
        for &(o, s) in audio_head.fragments.iter().take(8) {
            let mut frag = range(&audio.url, o, o + s - 1).await?;
            let samples = fmp4::plan_fragment(&mut frag, audio_head.iv_size)?;
            let base = whole.len();
            for sm in &samples {
                planned.push((base + sm.offset, sm.size, sm.clone()));
            }
            whole.extend_from_slice(&frag);
        }
        // mode "same" repeats sample 0 (lets the module fast-path an identical decrypt); default
        // walks distinct samples with distinct IVs, which is the real workload.
        let same = mode == "same";
        let n = planned.len().max(1);
        let t = Instant::now();
        for i in 0..n {
            let (b, len, sm) = &planned[if same { 0 } else { i }];
            let bytes = whole[*b..*b + *len].to_vec();
            let one = vec![fmp4::Sample { offset: 0, ..sm.clone() }];
            let (mut back, r) = cdm.decrypt(bytes, audio_kids.clone(), one);
            back.fill(0);
            r?;
        }
        let per = t.elapsed().as_secs_f64() * 1e6 / n as f64;
        eprintln!("[widevine] BENCH ({}): {n} back-to-back Decrypt calls, {per:.0} us/call ({:.2}s total)", if same { "same sample" } else { "distinct samples" }, t.elapsed().as_secs_f64());
        bail!("bench done");
    }

    let started = Instant::now();
    let mut last_report = Instant::now() - Duration::from_secs(1);
    let mut report = |received: u64| {
        if last_report.elapsed() < Duration::from_millis(250) && received < total {
            return;
        }
        last_report = Instant::now();
        let speed = received as f64 / started.elapsed().as_secs_f64().max(0.001);
        progress(received, total, speed);
    };
    // Audio is decrypted straight through the module (lossless, exact bytes) to a clear mp4.
    let audio_bytes = decrypt_to_file(&audio.url, &dir.join("audio.mp4"), audio_head, audio_kids, &cdm, audio_size, 0, cancel, &mut report).await?;
    // Video is decoded through the module and re-encoded to clear H.264: the Windows module refuses
    // decrypt-only output for some non-reference frames, so the decode path is the only complete one.
    encode_video(&video.url, &dir.join("video.mp4"), video_head, video_kids, &cdm, video_size, audio_bytes, cancel, &mut report).await?;

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

/// Fetches `url`, decrypts every fragment through `cdm` and writes one clear fMP4 to `path`, byte
/// layout preserved. `done` counts bytes already saved by earlier files; `report` gets the running
/// total so progress follows the original (encrypted) byte counts the player showed.
async fn decrypt_to_file(
    url: &str,
    path: &Path,
    head: Head,
    kids: Vec<[u8; 16]>,
    cdm: &Arc<Cdm>,
    total: u64,
    done: u64,
    cancel: &Arc<AtomicBool>,
    report: &mut impl FnMut(u64),
) -> Result<u64> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string();
    // Any leading gap before the first fragment (a nonzero sidx first_offset) is copied unchanged.
    let header_end = head.header.len() as u64;
    let first_offset = head.fragments.first().map(|(o, _)| *o).unwrap_or(header_end);
    let gap = if first_offset > header_end { range(url, header_end, first_offset - 1).await? } else { Vec::new() };
    // Any trailing bytes past the last fragment are copied unchanged.
    let last_end = head.fragments.last().map(|(o, s)| o + s).unwrap_or(header_end);
    let tail = if last_end < total { range(url, last_end, total - 1).await? } else { Vec::new() };

    // Fragments are prefetched (async) and decrypted on a dedicated thread. The decrypt loop makes its
    // Decrypt calls back-to-back with no await between them: the per-call cost is only ~60us that way,
    // versus milliseconds when the loop yields to the async runtime between calls. Fetch and write
    // overlap the decrypt, and progress is reported from the blocking thread through a channel.
    let rx = spawn_prefetch(url.to_string(), head.fragments.clone(), prefetch_depth(), cancel.clone());
    let (prog_tx, mut prog_rx) = tokio::sync::mpsc::unbounded_channel::<u64>();
    let cdm = cdm.clone();
    let path_owned = path.to_path_buf();
    let cancel = cancel.clone();
    let worker = tauri::async_runtime::spawn_blocking(move || -> Result<u64> {
        use std::io::Write;
        let mut file = std::fs::File::create(&path_owned).with_context(|| format!("{} could not be created", path_owned.display()))?;
        let mut rx = rx;
        let iv_size = head.iv_size;
        file.write_all(&head.header)?; // cleared ftyp + moov (encv→avc1/enca→mp4a) + sidx
        file.write_all(&gap)?;
        let mut written = header_end + gap.len() as u64;
        let _ = prog_tx.send(written);
        let prof = std::env::var_os("IZUMI_WIDEVINE_PROFILE").is_some();
        let (mut t_recv, mut t_dec, mut t_wr) = (Duration::ZERO, Duration::ZERO, Duration::ZERO);
        let wall = Instant::now();
        loop {
            let t = Instant::now();
            let next = rx.blocking_recv();
            t_recv += t.elapsed();
            let Some(item) = next else { break };
            if cancel.load(Ordering::SeqCst) {
                bail!("paused");
            }
            let (_idx, mut frag) = item.with_context(|| format!("{name} fragment could not be fetched"))?;
            let size = frag.len() as u64;
            let samples = match fmp4::plan_fragment(&mut frag, iv_size) {
                Ok(s) => s,
                Err(e) => {
                    frag.fill(0);
                    return Err(e);
                }
            };
            let t = Instant::now();
            let (mut clear, result) = cdm.decrypt(frag, kids.clone(), samples);
            t_dec += t.elapsed();
            if let Err(e) = result {
                clear.fill(0);
                return Err(e).with_context(|| format!("{name} could not be decrypted"));
            }
            let t = Instant::now();
            file.write_all(&clear)?;
            t_wr += t.elapsed();
            clear.fill(0); // the clear fragment is on disk now; don't leave it in memory
            written += size;
            let _ = prog_tx.send(written);
        }
        if prof {
            eprintln!("[widevine] {name}: {:.1}s total | blocking_recv {:.1}s decrypt {:.1}s write {:.1}s", wall.elapsed().as_secs_f64(), t_recv.as_secs_f64(), t_dec.as_secs_f64(), t_wr.as_secs_f64());
        }
        file.write_all(&tail)?;
        written += tail.len() as u64;
        file.flush()?;
        anyhow::ensure!(written == total, "wrote {written} of {total} bytes");
        Ok(written)
    });
    // Relay progress while the blocking worker runs.
    while let Some(w) = prog_rx.recv().await {
        report(done + w);
    }
    worker.await.map_err(|e| anyhow!("decrypt task failed: {e}"))?
}

/// How many fragments to fetch ahead of the module. The module decrypts/decodes far faster than one
/// fragment downloads, and — crucially — it slows down badly if it is left idle between calls, so the
/// next fragment must always be in hand when the current one finishes.
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

/// The ffmpeg encoder arguments for the video re-encode. Defaults to libx264 at a fast preset and a
/// near-lossless CRF; both are overridable, and a hardware encoder can be selected explicitly. A
/// re-encode is unavoidable (the module only hands back decoded frames for the samples it refuses
/// decrypt-only), so this biases to a quick encode at a quality the eye cannot tell from the source.
fn encoder_args() -> Vec<String> {
    // IZUMI_WIDEVINE_ENCODER lets a user force a hardware encoder (h264_nvenc, h264_qsv, h264_vaapi)
    // or any ffmpeg -c:v value; the rate-control args differ between software and hardware encoders.
    let codec = std::env::var("IZUMI_WIDEVINE_ENCODER").unwrap_or_else(|_| "libx264".into());
    let crf = std::env::var("IZUMI_WIDEVINE_CRF").ok();
    let preset = std::env::var("IZUMI_WIDEVINE_PRESET").ok();
    let mut args = vec!["-c:v".to_string(), codec.clone()];
    if codec.starts_with("libx26") {
        // Software x264/x265: superfast is a large speed win over veryfast at a tiny size cost; CRF 16
        // stays visually lossless for anime. CRF's perceptual meaning is preset-independent.
        args.extend(["-preset".into(), preset.unwrap_or_else(|| "superfast".into())]);
        args.extend(["-crf".into(), crf.unwrap_or_else(|| "16".into())]);
    } else if codec.contains("nvenc") {
        args.extend(["-preset".into(), preset.unwrap_or_else(|| "p4".into())]);
        args.extend(["-rc".into(), "vbr".into(), "-cq".into(), crf.unwrap_or_else(|| "19".into())]);
    } else if codec.contains("qsv") {
        args.extend(["-preset".into(), preset.unwrap_or_else(|| "faster".into())]);
        args.extend(["-global_quality".into(), crf.unwrap_or_else(|| "19".into())]);
    } else if codec.contains("vaapi") {
        args.extend(["-qp".into(), crf.unwrap_or_else(|| "19".into())]);
    } else {
        // Unknown encoder: pass preset/CRF through if given, else trust its defaults.
        if let Some(p) = preset { args.extend(["-preset".into(), p]); }
        if let Some(c) = crf { args.extend(["-crf".into(), c]); }
    }
    args
}

/// Decodes every video sample through the module and re-encodes the I420 pictures to clear H.264 at
/// `path`, muxing nothing else. The module refuses decrypt-only output for some non-reference frames,
/// so decoding (which always works) is the only way to a complete clear video.
///
/// The pipeline runs three stages concurrently so the module — the one scarce thread, which slows
/// sharply if left idle between calls — is kept fed back-to-back: a prefetcher downloads fragments
/// ahead, this loop decodes them on the module, and a writer task pipes the I420 pictures into ffmpeg
/// (which runs its own threaded encoder) so a slow encode never stalls the decoder.
#[allow(clippy::too_many_arguments)]
async fn encode_video(url: &str, path: &Path, head: Head, kids: Vec<[u8; 16]>, cdm: &Arc<Cdm>, total: u64, done: u64, cancel: &Arc<AtomicBool>, report: &mut impl FnMut(u64)) -> Result<u64> {
    use tokio::process::Command;
    let avcc = head.avcc.clone().context("the video track has no avcC")?;
    let (profile, param_sets) = fmp4::param_sets(&avcc)?;
    let (width, height) = (head.width, head.height);
    anyhow::ensure!(width > 0 && height > 0 && head.timescale > 0, "the video track is missing its size or timescale");
    let frame_dur = {
        // The first fragment's first sample gives the frame duration (timescale units per frame).
        let (o, s) = head.fragments.first().copied().context("the video has no fragments")?;
        let mut frag = range(url, o, o + s - 1).await?;
        let samples = fmp4::plan_fragment(&mut frag, head.iv_size)?;
        samples.first().map(|s| s.duration as u64).filter(|d| *d > 0).context("the video has no sample duration")?
    };
    let fps = head.timescale as f64 / frame_dur as f64;
    let frame_size = width as usize * height as usize + 2 * (width as usize).div_ceil(2) * (height as usize).div_ceil(2);

    // Initialise the module's decoder once.
    {
        let c = cdm.clone();
        let (w, h, avcc2) = (width as i32, height as i32, avcc.clone());
        blocking(move || c.video_init(profile, w, h, avcc2)).await.context("the module could not initialise its H.264 decoder")?;
    }

    // ffmpeg reads tightly packed yuv420p frames from stdin and writes H.264.
    let mut command = Command::new(ffmpeg_path());
    command
        .arg("-hide_banner").arg("-loglevel").arg("error").arg("-y")
        .arg("-f").arg("rawvideo").arg("-pix_fmt").arg("yuv420p")
        .arg("-s").arg(format!("{width}x{height}")).arg("-r").arg(format!("{fps:.6}"))
        .arg("-i").arg("-")
        .args(encoder_args())
        .arg("-pix_fmt").arg("yuv420p").arg("-movflags").arg("+faststart")
        .arg(path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = command.spawn().map_err(|e| anyhow!("the video re-encoder (ffmpeg) could not be started: {e}. Install ffmpeg or set IZUMI_FFMPEG_PATH."))?;
    let mut stdin = child.stdin.take().context("ffmpeg has no stdin")?;
    let stderr = child.stderr.take();

    // A writer task drains decoded frames into ffmpeg so the decode loop never blocks on the encoder.
    let (frame_tx, mut frame_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(prefetch_depth().max(4));
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(pixels) = frame_rx.recv().await {
            if let Err(e) = stdin.write_all(&pixels).await {
                return Err(anyhow!("writing a frame to ffmpeg failed: {e}"));
            }
        }
        drop(stdin); // close ffmpeg's input so it finishes encoding
        Ok::<(), anyhow::Error>(())
    });

    let mut fresh = true; // after init the decoder needs SPS/PPS before the first IDR
    let mut consumed = done; // original bytes processed so far (for progress)
    let mut result: Result<()> = Ok(());
    let mut frame_no = 0usize;
    let wall = Instant::now();
    let max_frags: usize = std::env::var("IZUMI_WIDEVINE_MAX_FRAGS").ok().and_then(|v| v.parse().ok()).unwrap_or(usize::MAX);
    let want = head.fragments.iter().take(max_frags).copied().collect::<Vec<_>>();
    let mut rx = spawn_prefetch(url.to_string(), want.clone(), prefetch_depth(), cancel.clone());
    'frags: while let Some(item) = rx.recv().await {
        let (frag_i, mut frag) = match item {
            Ok(v) => v,
            Err(e) => {
                result = Err(e);
                break;
            }
        };
        let size = frag.len() as u64;
        let samples = match fmp4::plan_fragment(&mut frag, head.iv_size) {
            Ok(s) => s,
            Err(e) => {
                frag.fill(0);
                result = Err(e);
                break;
            }
        };
        for s in &samples {
            // Decode one access unit: decrypt+decode happens inside the module; it wants Annex B.
            let mut data = frag[s.offset..s.offset + s.size].to_vec();
            let mut subs = s.subsamples.clone();
            if let Err(e) = fmp4::to_annex_b(&mut data, &subs) {
                result = Err(e);
                break 'frags;
            }
            if fresh {
                let prefix = param_sets.len() as u32;
                data.splice(0..0, param_sets.iter().copied());
                if let Some(first) = subs.first_mut() {
                    first.0 += prefix;
                }
                fresh = false;
            }
            match decode_frame(cdm, &head, &kids, s, subs, data, frame_size).await {
                Ok(Some(pixels)) => {
                    if frame_tx.send(pixels).await.is_err() {
                        result = Err(anyhow!("the video encoder stopped early"));
                        break 'frags;
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    result = Err(e).with_context(|| format!("video frame {frame_no} (fragment {frag_i}, sample size {})", s.size));
                    break 'frags;
                }
            }
            frame_no += 1;
        }
        frag.fill(0);
        consumed += size;
        report(consumed.min(done + total));
    }
    // Drain the decoder so reordered frames at the end are emitted.
    if result.is_ok() {
        loop {
            match drain_frame(cdm, &head, frame_size).await {
                Ok(Some(pixels)) => {
                    if frame_tx.send(pixels).await.is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    result = Err(e);
                    break;
                }
            }
        }
    }
    drop(frame_tx); // signal the writer to close ffmpeg's stdin
    let write_result = writer.await.map_err(|e| anyhow!("video writer task failed: {e}"))?;
    let status = child.wait().await.context("waiting for ffmpeg failed")?;
    let secs = frame_no as f64 / fps.max(0.001);
    let wall_s = wall.elapsed().as_secs_f64().max(0.001);
    eprintln!(
        "[widevine] video: {frame_no} frames ({secs:.1}s media) in {wall_s:.1}s = {:.2}x realtime, {:.1} fps",
        secs / wall_s, frame_no as f64 / wall_s
    );
    result?;
    write_result?;
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
    report((done + total).min(u64::MAX));
    Ok(done + total)
}

/// Decrypts and decodes one video sample through the module, returning its I420 pixels (None when the
/// decoder needs more input before it can emit a frame).
async fn decode_frame(cdm: &Arc<Cdm>, head: &Head, kids: &[[u8; 16]], sample: &fmp4::Sample, subsamples: Vec<(u32, u32)>, data: Vec<u8>, frame_size: usize) -> Result<Option<Vec<u8>>> {
    let kid = kids.first().copied().context("no content key for the video")?;
    let iv = sample.iv.clone();
    let ts_us = ((sample.dts as i64 + sample.cto) as i128 * 1_000_000 / head.timescale as i128) as i64;
    let out = vec![0u8; frame_size];
    let c = cdm.clone();
    let (mut buf, pic) = blocking(move || Ok(c.video_decode(kid, iv, subsamples, Some(data), ts_us, out))).await?;
    match pic {
        Ok(Some(_)) => {
            let frame = std::mem::take(&mut buf);
            Ok(Some(frame))
        }
        Ok(None) => {
            buf.fill(0);
            Ok(None)
        }
        Err(e) => {
            buf.fill(0);
            Err(e)
        }
    }
}

/// Drains one reordered picture from the decoder at end of stream.
async fn drain_frame(cdm: &Arc<Cdm>, head: &Head, frame_size: usize) -> Result<Option<Vec<u8>>> {
    let out = vec![0u8; frame_size];
    let kid = head.default_kid;
    let c = cdm.clone();
    let (mut buf, pic) = blocking(move || Ok(c.video_decode(kid, vec![0u8; 8], Vec::new(), None, 0, out))).await?;
    match pic {
        Ok(Some(_)) => Ok(Some(std::mem::take(&mut buf))),
        Ok(None) => {
            buf.fill(0);
            Ok(None)
        }
        Err(e) => {
            buf.fill(0);
            Err(e)
        }
    }
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
