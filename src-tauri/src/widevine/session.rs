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
use super::save::{self, Saved};

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
    /// Where mpv opens the stream: the asked start, moved to the start of its fragment on the
    /// module path.
    #[serde(skip)]
    pub start: Option<f64>,
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
            // A source whose proxy stops sending must not freeze playback for long: a stalled
            // read fails after 15 s and Remote::range retries on a fresh request.
            .read_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
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
    // The player's own request (the fallback after a refusal) beats the diagnostic override.
    let wanted = req.video_mode.clone().filter(|m| m != "auto").or_else(|| std::env::var("IZUMI_WIDEVINE_VIDEO").ok());
    match wanted.as_deref() {
        Some("module") => Some(VideoMode::Module),
        Some("hardware") => Some(VideoMode::Hardware),
        _ => None,
    }
}

/// Starts a licence session for `init_data` and applies the server's answer.
async fn license(cdm: Arc<Cdm>, req: &Request, init_data: Vec<u8>) -> Result<cdm::KeyReport> {
    let begun = std::time::Instant::now();
    let c = cdm.clone();
    let challenge = blocking(move || c.licence_request(init_data)).await?;
    let (challenge_ms, challenge_bytes) = (ms(begun), challenge.len());
    let licence = post_licence(req, challenge).await?;
    let posted_ms = ms(begun);
    let keys = blocking(move || cdm.update(licence)).await;
    // The first licence of a run took about three times as long as later ones; this says which step.
    eprintln!("[widevine] licence: request {challenge_ms} ms ({challenge_bytes} bytes), server {} ms, applied {} ms", posted_ms - challenge_ms, ms(begun) - posted_ms);
    keys
}

/// The fragment holding `start` seconds: the first one without a start.
fn fragment_at(head: &super::fmp4::Head, start: Option<f64>) -> usize {
    let Some(start) = start.filter(|s| *s > 0.0) else { return 0 };
    let target = (start * head.timescale as f64) as u64;
    let mut begins = 0u64;
    for (index, duration) in head.fragment_durations.iter().enumerate() {
        if begins + duration > target {
            return index;
        }
        begins += duration;
    }
    head.fragment_durations.len().saturating_sub(1)
}

/// Milliseconds since `since`, for the one-line timing report.
fn ms(since: std::time::Instant) -> u128 {
    since.elapsed().as_millis()
}

/// Licenses `manifest_url` and registers its streams. The returned URLs are what mpv loads, from
/// `Prepared::start` (playback opens at the start of the fragment holding `start`, so the module's
/// first picture needs one decode instead of up to a fragment's worth). `on_refused` runs if the
/// module later refuses a sample on the hardware-decoding path.
///
/// Opening used to run every step after the one before it. Now what does not depend on the stream
/// (the module and its instance) gets ready while the manifest downloads, the licence goes out while
/// the file heads download, and the fragment playback starts in downloads while the licence is out:
/// encrypted bytes need no key.
pub async fn prepare(data: &std::path::Path, manifest_url: &str, req: &Request, start: Option<f64>, on_refused: OnRefused) -> Result<Prepared> {
    let begun = std::time::Instant::now();
    if let Some(ks) = req.key_system.as_deref() {
        ensure!(ks == "com.widevine.alpha", "{ks} is not supported on this device");
    }
    let data = data.to_path_buf();
    // Updates are the module worker's job (`crate::modules`).
    let installed = fetch::installed(&data).ok_or_else(|| anyhow!("{}", super::NOT_INSTALLED))?;
    let forced = requested_mode(req);

    let (renewals_tx, mut renewals_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    let module = {
        let library = installed.library.clone();
        let interface = installed.interface;
        let certificate_url = req.server_certificate_url.clone().filter(|u| !u.is_empty());
        async move {
            let version = blocking(move || cdm::load_module(&library)).await?;
            let cdm = Arc::new(blocking(move || Cdm::open(interface, renewals_tx)).await?);
            if let Some(url) = certificate_url {
                let certificate = http().get(&url).send().await?.error_for_status()?.bytes().await?.to_vec();
                let c = cdm.clone();
                blocking(move || c.set_server_certificate(certificate)).await?;
            }
            Ok::<_, anyhow::Error>((version, cdm, ms(begun)))
        }
    };
    let media = media_files(manifest_url, req.max_height, forced);
    let (module, media) = tokio::join!(module, media);
    let (version, cdm, module_ms) = module?;
    let (video_remote, audio_remote, manifest_pssh, video_rep, audio_lang, heights) = media?;
    let manifest_ms = ms(begun);
    if version == installed.version {
        let (data, keep) = (data.clone(), version.clone());
        std::thread::spawn(move || fetch::prune_old(&data, &keep));
    }

    // The module's decoder starts on the fragment playback opens in (the hardware path reads its own).
    let first_fragment = |head: &super::fmp4::Head| (forced != Some(VideoMode::Hardware)).then(|| fragment_at(head, start));
    let fetch_first = |head: super::fmp4::Head, index: Option<usize>| {
        let remote = video_remote.clone();
        async move {
            let first = match index {
                Some(index) => {
                    let (offset, size) = head.fragments[index];
                    Some((index, remote.range(offset, offset + size - 1).await.context("the video could not be read")?.0))
                }
                None => None,
            };
            Ok::<_, anyhow::Error>((head, first, ms(begun)))
        }
    };
    let heads = async {
        let (video, audio) = tokio::join!(video_remote.head(), audio_remote.head());
        Ok::<_, anyhow::Error>((video.context("the video file could not be read")?, audio.context("the audio file could not be read")?, ms(begun)))
    };
    let licensed = |init_data: Vec<u8>| {
        let cdm = cdm.clone();
        async move { license(cdm, req, init_data).await.map(|keys| (keys, ms(begun))) }
    };
    let ((video_head, first, fragment_ms), video_total, (audio_head, audio_total), heads_ms, (keys, licence_ms)) = match manifest_pssh {
        // The manifest's own init data: the licence goes out at once, beside the heads and the fragment.
        Some(init_data) => {
            let media = async {
                let ((video_head, video_total), audio, heads_ms) = heads.await?;
                let index = first_fragment(&video_head);
                Ok::<_, anyhow::Error>((fetch_first(video_head, index).await?, video_total, audio, heads_ms))
            };
            let (keys, media) = tokio::join!(licensed(init_data), media);
            let (video, video_total, audio, heads_ms) = media?;
            (video, video_total, audio, heads_ms, keys?)
        }
        // Init data from the file heads: the licence and the fragment go out together once they are in.
        None => {
            let ((video_head, video_total), audio, heads_ms) = heads.await?;
            let init_data = Some(video_head.pssh.clone())
                .filter(|p| !p.is_empty())
                .or_else(|| Some(audio.0.pssh.clone()).filter(|p| !p.is_empty()))
                .context("the stream carries no Widevine licence data")?;
            let index = first_fragment(&video_head);
            let (keys, video) = tokio::join!(licensed(init_data), fetch_first(video_head, index));
            (video?, video_total, audio, heads_ms, keys?)
        }
    };
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
    let mut opens_at = start;
    let video = match mode {
        VideoMode::Module => {
            let raw = RawVideo::open(video_remote, video_head, cdm.clone(), first).await?;
            opens_at = start.filter(|s| *s > 0.0).map(|s| raw.snap_to_fragment(s));
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
    eprintln!(
        "[widevine] ready in {} ms: module {module_ms} ms, manifest {manifest_ms} ms, file heads {heads_ms} ms, licence {licence_ms} ms, first fragment {fragment_ms} ms (all from the start)",
        ms(begun)
    );

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
        audio_lang,
        mode,
        height: video_rep.height,
        heights,
        start: opens_at,
        file_options,
    })
}

type MediaFiles = (Remote, Remote, Option<Vec<u8>>, mpd::Representation, Option<String>, Vec<u32>);

/// The two files to play (and what the manifest says about them): a download's saved pair, or the
/// manifest's best H.264 rung (any codec on the hardware path).
async fn media_files(manifest_url: &str, max_height: Option<u32>, forced: Option<VideoMode>) -> Result<MediaFiles> {
    // A download (`file://<folder>`): its two saved files instead of the manifest's, still licensed
    // online through the fresh licence URL the player resolved for it.
    Ok(if let Some(dir) = save::saved_dir(manifest_url) {
        let saved = Saved::read(&dir)?;
        let rep = mpd::Representation {
            kind: mpd::Kind::Video,
            id: saved.video_id.clone(),
            url: String::new(),
            bandwidth: saved.bandwidth,
            width: saved.width,
            height: saved.height,
            codecs: saved.codecs.clone(),
            lang: None,
        };
        (
            Remote::local(http().clone(), dir.join(&saved.video)),
            Remote::local(http().clone(), dir.join(&saved.audio)),
            saved.pssh(),
            rep,
            saved.audio_lang.clone(),
            vec![saved.height],
        )
    } else {
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
        // The module only decodes H.264; the hardware path takes whatever the manifest offers.
        let codec = if forced == Some(VideoMode::Hardware) { None } else { Some("avc1") };
        let video_rep = manifest
            .video(max_height, codec)
            .or_else(|| manifest.video(max_height, None))
            .context("the manifest has no video")?
            .clone();
        let audio_rep = manifest.audio(None).context("the manifest has no audio")?.clone();
        (
            Remote::new(http().clone(), video_rep.url.clone()),
            Remote::new(http().clone(), audio_rep.url.clone()),
            manifest.pssh.clone(),
            video_rep,
            audio_rep.lang.clone(),
            manifest.heights(codec),
        )
    })
}
