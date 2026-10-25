//! One protected playback: licence, decrypt-only probe, the two streams mpv reads, and the
//! registry `izcr://` looks them up in. Only the newest session is kept; starting another (or any
//! other file) drops the previous one, which closes its CDM instance once mpv lets go of it.
use anyhow::{anyhow, bail, ensure, Context, Result};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use super::cdm::{self, Cdm};
use super::fetch;
use super::media::{Cancel, OnRefused, RawVideo, Remote, Track};
use super::mpd;
use super::protocol::SCHEME;

/// Settings a source's `StreamDrm` carries, plus the player's choices.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    #[serde(default)]
    pub key_system: Option<String>,
    pub license_url: String,
    #[serde(default)]
    pub license_headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub server_certificate_url: Option<String>,
    /// Highest video rung to pick; none = the best the manifest offers.
    #[serde(default)]
    pub max_height: Option<u32>,
    /// "auto" (probe), "module" or "hardware".
    #[serde(default)]
    pub video_mode: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoMode {
    /// The module decrypts and decodes video (software); mpv shows raw pictures.
    Module,
    /// The module decrypts only; mpv's own (hardware) decoder decodes.
    Hardware,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub video_url: String,
    pub audio_url: String,
    pub audio_lang: Option<String>,
    pub mode: VideoMode,
    pub height: u32,
    pub heights: Vec<u32>,
    #[serde(skip)]
    pub file_options: Vec<(String, String)>,
}

#[derive(Clone)]
pub enum Source {
    Track(Arc<Track>, &'static str),
    Raw(Arc<RawVideo>),
}

impl Source {
    pub fn name(&self) -> &'static str {
        match self {
            Source::Track(_, name) => name,
            Source::Raw(_) => "video",
        }
    }
    pub fn total(&self) -> u64 {
        match self {
            Source::Track(t, _) => t.total,
            Source::Raw(v) => v.total,
        }
    }
    pub fn read_at(&self, pos: u64, out: &mut [u8], cancel: &Cancel) -> Result<usize> {
        match self {
            Source::Track(t, _) => t.read_at(pos, out, cancel),
            Source::Raw(v) => v.read_at(pos, out, cancel),
        }
    }
}

struct Session {
    video: Source,
    audio: Source,
    renewals: tauri::async_runtime::JoinHandle<()>,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.renewals.abort();
    }
}

fn sessions() -> &'static Mutex<HashMap<String, Arc<Session>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<Session>>>> = OnceLock::new();
    SESSIONS.get_or_init(Default::default)
}

/// The stream behind `izcr://<session>/<track>`, if that session is still current.
pub fn source(uri: &str) -> Option<Source> {
    let rest = uri.strip_prefix(SCHEME)?.strip_prefix("://")?;
    let (id, track) = rest.split_once('/')?;
    let session = sessions().lock().ok()?.get(id)?.clone();
    match track {
        "video" => Some(session.video.clone()),
        "audio" => Some(session.audio.clone()),
        _ => None,
    }
}

pub fn is_protected_url(url: &str) -> bool {
    url.starts_with(&format!("{SCHEME}://"))
}

/// Drops every session. Streams mpv still holds keep working until it closes them.
pub fn end_all() {
    if let Ok(mut all) = sessions().lock() {
        all.clear();
    }
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(90))
            .build()
            .expect("HTTP client")
    })
}


fn session_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn getrandom(out: &mut [u8]) {
    // SAFETY: getrandom(2) writes at most `out.len()` bytes into `out`.
    let n = unsafe { libc::getrandom(out.as_mut_ptr() as *mut libc::c_void, out.len(), 0) };
    if n != out.len() as isize {
        // Uniqueness, not secrecy, is what matters here; fall back to the clock.
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        for (i, b) in out.iter_mut().enumerate() {
            *b = (t >> ((i % 16) * 8)) as u8;
        }
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| anyhow!("{e}"))?
}

async fn post_licence(req: &Request, body: Vec<u8>) -> Result<Vec<u8>> {
    let mut post = http().post(&req.license_url).body(body);
    for (k, v) in req.license_headers.iter().flatten() {
        post = post.header(k, v);
    }
    let res = post.send().await.context("the licence server could not be reached")?;
    let status = res.status();
    if !status.is_success() {
        let detail = res.text().await.unwrap_or_default();
        let detail: String = detail.chars().take(160).collect();
        bail!("the licence server refused this device (HTTP {status}){}", if detail.is_empty() { String::new() } else { format!(": {detail}") });
    }
    Ok(res.bytes().await?.to_vec())
}

fn requested_mode(req: &Request) -> Option<VideoMode> {
    let wanted = std::env::var("IZUMI_WIDEVINE_VIDEO").ok().or_else(|| req.video_mode.clone());
    match wanted.as_deref() {
        Some("module") => Some(VideoMode::Module),
        Some("hardware") => Some(VideoMode::Hardware),
        _ => None,
    }
}

/// Licenses `manifest_url` and registers its streams. The returned URLs are what mpv loads.
/// `on_refused` runs if the module later refuses a sample on the hardware-decoding path.
pub async fn prepare(data: &std::path::Path, manifest_url: &str, req: &Request, on_refused: OnRefused) -> Result<Prepared> {
    if let Some(ks) = req.key_system.as_deref() {
        ensure!(ks == "com.widevine.alpha", "{ks} is not supported on this device");
    }
    let data = data.to_path_buf();
    let installed = fetch::installed(&data).ok_or_else(|| anyhow!("{}", super::NOT_INSTALLED))?;
    {
        let data = data.clone();
        tauri::async_runtime::spawn(async move {
            match fetch::update_if_due(http(), &data).await {
                Ok(Some(v)) => eprintln!("[widevine] module {v} installed; it is used from the next start"),
                Ok(None) => {}
                Err(e) => eprintln!("[widevine] module update check failed: {e:#}"),
            }
        });
    }
    let library = installed.library.clone();
    let version = blocking(move || cdm::load_module(&library)).await?;
    if version == installed.version {
        let (data, keep) = (data.clone(), version.clone());
        std::thread::spawn(move || fetch::prune_old(&data, &keep));
    }

    let text = http()
        .get(manifest_url)
        .send()
        .await
        .context("the manifest could not be fetched")?
        .error_for_status()
        .context("the manifest could not be fetched")?
        .text()
        .await?;
    let manifest = mpd::parse(&text, manifest_url)?;
    let forced = requested_mode(req);
    // The module only decodes H.264; the hardware path takes whatever the manifest offers.
    let codec = if forced == Some(VideoMode::Hardware) { None } else { Some("avc1") };
    let video_rep = manifest
        .video(req.max_height, codec)
        .or_else(|| manifest.video(req.max_height, None))
        .context("the manifest has no video")?
        .clone();
    let audio_rep = manifest.audio(None).context("the manifest has no audio")?.clone();
    let heights = manifest.heights(codec);

    let video_remote = Remote::new(http().clone(), video_rep.url.clone());
    let audio_remote = Remote::new(http().clone(), audio_rep.url.clone());
    let (video_head, audio_head) = tokio::join!(video_remote.head(), audio_remote.head());
    let (video_head, video_total) = video_head.context("the video file could not be read")?;
    let (audio_head, audio_total) = audio_head.context("the audio file could not be read")?;
    let init_data = manifest
        .pssh
        .clone()
        .or_else(|| Some(video_head.pssh.clone()).filter(|p| !p.is_empty()))
        .or_else(|| Some(audio_head.pssh.clone()).filter(|p| !p.is_empty()))
        .context("the stream carries no Widevine licence data")?;

    let (renewals_tx, mut renewals_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    let interface = installed.interface;
    let cdm = Arc::new(blocking(move || Cdm::open(interface, renewals_tx)).await?);
    if let Some(url) = req.server_certificate_url.as_deref().filter(|u| !u.is_empty()) {
        let certificate = http().get(url).send().await?.error_for_status()?.bytes().await?.to_vec();
        let c = cdm.clone();
        blocking(move || c.set_server_certificate(certificate)).await?;
    }
    let c = cdm.clone();
    let challenge = blocking(move || c.licence_request(init_data)).await?;
    let licence = post_licence(req, challenge).await?;
    let c = cdm.clone();
    let keys = blocking(move || c.update(licence)).await?;
    ensure!(
        keys.usable > 0,
        "the licence gave this device no usable keys{}",
        if keys.other.is_empty() { String::new() } else { format!(" (key status {:?})", keys.other) }
    );

    let c = cdm.clone();
    let kid = video_head.default_kid;
    let decrypt_only = blocking(move || Ok(c.allows_decrypt_only_video(kid))).await?;
    let mode = forced.unwrap_or(if decrypt_only { VideoMode::Hardware } else { VideoMode::Module });
    eprintln!(
        "[widevine] module {version}: {}/{} keys usable, decrypt-only video {}, video {} {}x{} at {} kb/s via {}",
        keys.usable,
        keys.total,
        if decrypt_only { "allowed" } else { "refused" },
        video_rep.id,
        video_rep.width,
        video_rep.height,
        video_rep.bandwidth / 1000,
        if mode == VideoMode::Module { "the module's decoder" } else { "mpv's decoder" }
    );

    let id = session_id();
    let mut file_options = vec![
        ("cache-secs".to_string(), "20".to_string()),
        ("cache-on-disk".to_string(), "no".to_string()),
    ];
    let video = match mode {
        VideoMode::Module => {
            let raw = RawVideo::open(video_remote, video_head, cdm.clone()).await?;
            file_options.extend([
                ("demuxer".into(), "rawvideo".into()),
                ("demuxer-rawvideo-w".into(), raw.width.to_string()),
                ("demuxer-rawvideo-h".into(), raw.height.to_string()),
                ("demuxer-rawvideo-fps".into(), format!("{:.9}", raw.fps)),
                ("demuxer-rawvideo-mp-format".into(), "yuv420p".into()),
                ("hwdec".into(), "no".into()),
                // Raw pictures are 3 MB each at 1080p, so mpv's byte-sized caches hold seconds, not
                // minutes. The module decodes several times faster than real time, so about a
                // second of pictures ahead is enough; seeking back re-decodes from the fragment.
                ("demuxer-max-bytes".into(), (std::env::var("IZUMI_WIDEVINE_AHEAD_MB").ok().and_then(|v| v.parse::<u64>().ok()).unwrap_or(64) << 20).to_string()),
                ("demuxer-max-back-bytes".into(), (16u64 << 20).to_string()),
            ]);
            Source::Raw(raw)
        }
        VideoMode::Hardware => Source::Track(Track::new(video_remote, video_head, video_total, cdm.clone(), Some(on_refused)), "video"),
    };
    let audio = Source::Track(Track::new(audio_remote, audio_head, audio_total, cdm.clone(), None), "audio");

    // Licence renewals the module asks for while this session is current. The task ends with the
    // session (Drop aborts it), so it never keeps an old CDM instance alive.
    let licence_req = req.clone();
    let renew_cdm = cdm;
    let renewals = tauri::async_runtime::spawn(async move {
        while let Some(message) = renewals_rx.recv().await {
            let result = match post_licence(&licence_req, message).await {
                Ok(response) => {
                    let c = renew_cdm.clone();
                    blocking(move || c.update(response)).await.map(|_| ())
                }
                Err(e) => Err(e),
            };
            match result {
                Ok(()) => eprintln!("[widevine] licence renewed"),
                Err(e) => eprintln!("[widevine] licence renewal failed: {e:#}"),
            }
        }
    });
    let session = Arc::new(Session { video, audio, renewals });
    {
        let mut all = sessions().lock().map_err(|_| anyhow!("session registry poisoned"))?;
        all.clear();
        all.insert(id.clone(), session);
    }
    Ok(Prepared {
        video_url: format!("{SCHEME}://{id}/video"),
        audio_url: format!("{SCHEME}://{id}/audio"),
        audio_lang: audio_rep.lang,
        mode,
        height: video_rep.height,
        heights,
        file_options,
    })
}
