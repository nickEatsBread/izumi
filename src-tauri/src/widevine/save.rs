//! Protected episodes saved for offline use. The two files the player reads (one video rendition,
//! one audio rendition) are written to a folder exactly as the source sends them, still encrypted,
//! with `drm.json` beside them once both are complete. Playing the folder licenses it online again
//! and decrypts in memory like a stream (`session.rs`); nothing decrypted is ever written to disk.
use anyhow::{anyhow, bail, Context, Result};
use base64::Engine;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

use super::mpd;

pub const SAVED_INFO: &str = "drm.json";

/// What a saved episode records beside its files.
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
    /// The manifest's Widevine licence data (base64); the files carry their own otherwise.
    #[serde(default)]
    pub pssh: Option<String>,
}

impl Saved {
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

    pub fn pssh(&self) -> Option<Vec<u8>> {
        self.pssh.as_deref().and_then(|p| base64::engine::general_purpose::STANDARD.decode(p).ok())
    }
}

/// The folder behind a `file://` URL the player was given, when it holds a saved episode.
pub fn saved_dir(url: &str) -> Option<PathBuf> {
    let dir = PathBuf::from(url.strip_prefix("file://")?);
    dir.join(SAVED_INFO).is_file().then_some(dir)
}

/// `<downloads>/<name>` with the name made safe for a folder (its extension dropped).
pub fn folder_for(downloads: &Path, name: &str) -> PathBuf {
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let mut safe: String = stem
        .chars()
        .map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
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

/// Downloads `url` into `path`, continuing a `.part` left by a pause. `done` counts bytes already
/// saved by earlier files; `report` gets the running total.
async fn fetch_to(url: &str, path: &Path, total: u64, done: u64, cancel: &AtomicBool, report: &mut impl FnMut(u64)) -> Result<u64> {
    let part = path.with_extension("part");
    let mut have = tokio::fs::metadata(&part).await.map(|m| m.len()).unwrap_or(0);
    let mut request = client().get(url);
    if have > 0 {
        request = request.header("Range", format!("bytes={have}-"));
    }
    let mut res = request.send().await?.error_for_status().context("the media server refused the download")?;
    let mut file = if have > 0 && res.status().as_u16() == 206 {
        tokio::fs::OpenOptions::new().append(true).open(&part).await?
    } else {
        have = 0;
        tokio::fs::File::create(&part).await?
    };
    while let Some(chunk) = res.chunk().await? {
        if cancel.load(Ordering::SeqCst) {
            file.flush().await?;
            bail!("paused");
        }
        file.write_all(&chunk).await?;
        have += chunk.len() as u64;
        report(done + have);
    }
    file.flush().await?;
    drop(file);
    if have != total {
        bail!("the download stopped early ({have} of {total} bytes)");
    }
    tokio::fs::rename(&part, path).await?;
    Ok(have)
}

/// Saves the rendition the player would pick for `max_height` (H.264 first, as the module decodes
/// it) and the default audio. `progress(received, total, bytes_per_second)`.
pub async fn save(id: &str, manifest_url: &str, dir: &Path, max_height: Option<u32>, progress: impl Fn(u64, u64, f64)) -> Result<SaveResult> {
    let flag = Arc::new(AtomicBool::new(false));
    cancels().lock().map_err(|_| anyhow!("download registry poisoned"))?.insert(id.to_string(), flag.clone());
    let result = save_inner(manifest_url, dir, max_height, &flag, progress).await;
    if let Ok(mut all) = cancels().lock() {
        all.remove(id);
    }
    result
}

async fn save_inner(manifest_url: &str, dir: &Path, max_height: Option<u32>, cancel: &AtomicBool, progress: impl Fn(u64, u64, f64)) -> Result<SaveResult> {
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
    let video = manifest
        .video(max_height, Some("avc1"))
        .or_else(|| manifest.video(max_height, None))
        .context("the manifest has no video")?
        .clone();
    let audio = manifest.audio(None).context("the manifest has no audio")?.clone();
    let (video_size, audio_size) = tokio::try_join!(size_of(&video.url), size_of(&audio.url))?;
    let total = video_size + audio_size;
    tokio::fs::create_dir_all(dir).await.with_context(|| format!("{} could not be created", dir.display()))?;

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
    fetch_to(&video.url, &dir.join("video.mp4"), video_size, 0, cancel, &mut report).await?;
    fetch_to(&audio.url, &dir.join("audio.mp4"), audio_size, video_size, cancel, &mut report).await?;

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
    };
    // Written last: a folder without it is an unfinished download.
    tokio::fs::write(dir.join(SAVED_INFO), serde_json::to_vec_pretty(&saved)?).await?;
    Ok(SaveResult { bytes: total, height: video.height })
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

    #[test]
    fn a_saved_record_round_trips_and_stays_in_its_folder() {
        let dir = std::env::temp_dir().join(format!("izumi-saved-{}", std::process::id()));
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
        };
        std::fs::write(dir.join(SAVED_INFO), serde_json::to_vec(&saved).unwrap()).unwrap();
        assert_eq!(Saved::read(&dir).unwrap(), saved);
        assert_eq!(saved.pssh(), Some(vec![1, 2, 3]));
        assert_eq!(saved_dir(&format!("file://{}", dir.display())), Some(dir.clone()));
        assert_eq!(saved_dir("https://example.test/manifest.mpd"), None);

        let escaping = Saved { video: "../secret".into(), ..saved };
        std::fs::write(dir.join(SAVED_INFO), serde_json::to_vec(&escaping).unwrap()).unwrap();
        assert!(Saved::read(&dir).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
