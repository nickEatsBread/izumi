use std::{
    collections::{HashMap, HashSet},
    net::{Ipv4Addr, SocketAddr, TcpListener as StdTcpListener},
    num::NonZeroU32,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use librqbit::{
    api::TorrentIdOrHash, AddTorrent, AddTorrentOptions, AddTorrentResponse, Api,
    ConnectionOptions, DhtSessionConfig, ListenerMode, ListenerOptions, Magnet, ManagedTorrent,
    Session, SessionOptions, SessionPersistenceConfig,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    net::TcpListener,
    sync::{mpsc, oneshot, watch, Mutex, OnceCell},
    task::JoinHandle,
    time::{sleep, timeout, Instant},
};

use crate::direct_torrent_select::{
    select_file_by_index, select_file_for_title, select_subtitles, subtitle_language, TorrentFile,
};

const METADATA_TIMEOUT: Duration = Duration::from_secs(60);
const MIN_STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
const STARTUP_CANCEL_POLL: Duration = Duration::from_millis(50);
const STARTUP_CANCELED: &str = "Torrent startup canceled.";
const STARTUP_STREAM_PRIORITY_TIMEOUT: Duration = Duration::from_secs(15);
const METADATA_CACHE_ENTRIES: usize = 16;
const MAX_CACHED_TORRENT_BYTES: u64 = 16 * 1024 * 1024;
const METADATA_CACHE_DIR: &str = "torrent-metadata";
const DIRECT_PEER_PORTS: std::ops::Range<u16> = 42400..42500;
const POST_PLAYBACK_SEED_TIME: Duration = Duration::from_secs(30 * 60);
const SEED_CHECK_INTERVAL: Duration = Duration::from_secs(10);
const PLAYBACK_BUFFER_FLOOR_SECONDS: f64 = 60.0;
const AUTO_UPLOAD_MBPS: f64 = 1.0;
const USER_CAPACITY_FRACTION: f64 = 0.70;
const BUFFERING_UPLOAD_BPS: u32 = 64 * 1024;

fn peer_listener_enabled(
    has_proxy: bool,
    has_bound_interface: bool,
    native_binding_supported: bool,
) -> bool {
    !has_proxy && (!has_bound_interface || native_binding_supported)
}

fn upnp_enabled(is_android: bool, has_proxy: bool, has_bound_interface: bool) -> bool {
    // A VPN tunnel generally has no UPnP gateway to configure. More importantly, never let a
    // router mapping on the ordinary LAN undermine an explicitly selected privacy interface.
    !is_android && !has_proxy && !has_bound_interface
}

/// librqbit implements complete device binding on macOS (`IP_BOUND_IF` / `IPV6_BOUND_IF`) and
/// Linux (`SO_BINDTODEVICE`), covering peer TCP/uTP, DHT, trackers, listeners and LSD. Its Windows
/// implementation deliberately returns unsupported, so Windows retains Izumi's monitor-and-pause
/// guard without passing a device into the session.
pub(crate) fn native_bind_device_name(bind_interface: Option<&str>) -> Option<String> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        bind_interface.map(str::to_owned)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = bind_interface;
        None
    }
}

fn peer_listener_mode() -> ListenerMode {
    // Some swarms expose materially more uTP than TCP endpoints. librqbit 9 only creates its
    // outgoing uTP connector when the session owns a uTP listener socket, so TCP-only mode can
    // exhaust metadata discovery even when another client reaches the same swarm immediately.
    ListenerMode::TcpAndUtp
}

/// librqbit 9 accepts one listener address rather than a port range. Retain the old behavior by
/// selecting the first currently-free port from Izumi's existing range. Binding happens
/// immediately afterwards; if another process wins that tiny race, session startup fails safely.
fn available_peer_port() -> Option<u16> {
    let mut ports = DIRECT_PEER_PORTS;
    ports.find(|port| StdTcpListener::bind((Ipv4Addr::UNSPECIFIED, *port)).is_ok())
}

/// Windows can add a previously-random DHT port to an excluded Hyper-V/WinNAT range between
/// launches. Reusing that persisted port then fails with WSAEACCES (10013) before the engine can
/// start. Port zero keeps the persisted routing table while asking Winsock for a currently-usable
/// port; other platforms retain librqbit's stable persisted-port behavior.
fn dht_port_override(is_windows: bool) -> Option<u16> {
    is_windows.then_some(0)
}

/// Anime-oriented public trackers used by the client in addition to a torrent's own announce list.
/// DHT remains the primary decentralized source; these stop a bare info-hash from depending on a
/// single discovery mechanism. Dead/duplicate trackers are harmless because rqbit polls them in
/// parallel and de-duplicates URLs.
const PUBLIC_TRACKERS: [&str; 6] = [
    "udp://open.stealth.si:80/announce",
    "http://nyaa.tracker.wf:7777/announce",
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://exodus.desync.com:6969/announce",
    "http://open.acgnxtracker.com:80/announce",
    "https://tracker.nekobt.to/api/tracker/public/announce",
];

#[derive(Default)]
pub struct DirectTorrentState {
    engine: OnceCell<Arc<DirectTorrentEngine>>,
    active: Arc<Mutex<Option<ActivePlayback>>>,
    /// At most one different-infohash next episode may download beside the active torrent.
    prepared_next: Arc<Mutex<Option<PreparedTorrent>>>,
    /// Magnet metadata is immutable for an info hash. Keeping a small session-local copy avoids
    /// repeating the slow DHT/tracker metadata exchange for every episode in the same season pack.
    metadata_cache: Mutex<HashMap<String, CachedTorrentMetadata>>,
    next_playback_id: AtomicU64,
    /// Every new startup supersedes the previous one before it waits on metadata or the active
    /// torrent lock. The webview cannot abort a Tauri invoke directly, so this generation is the
    /// cancellation boundary shared by explicit Back/Cancel and replacement source attempts.
    active_startup_id: AtomicU64,
    /// The single speculative metadata lookup. Re-ranking cancels stale work; selecting the same
    /// hash joins this flight instead of starting a second DHT/tracker exchange beside it.
    prefetching: Mutex<Option<MetadataFlightEntry>>,
}

struct MetadataFlightEntry {
    info_hash: String,
    flight: Arc<MetadataFlight>,
}

struct MetadataFlight {
    cancel: watch::Sender<bool>,
    result: watch::Sender<MetadataFlightResult>,
}

#[derive(Clone)]
enum MetadataFlightResult {
    Pending,
    Ready(CachedTorrentMetadata),
    Failed,
}

impl MetadataFlight {
    fn new() -> Self {
        let (cancel, _) = watch::channel(false);
        let (result, _) = watch::channel(MetadataFlightResult::Pending);
        Self { cancel, result }
    }

    fn cancel(&self) {
        self.cancel.send_replace(true);
    }

    async fn wait(&self) -> Option<CachedTorrentMetadata> {
        let mut result = self.result.subscribe();
        loop {
            match result.borrow().clone() {
                MetadataFlightResult::Pending => {}
                MetadataFlightResult::Ready(metadata) => return Some(metadata),
                MetadataFlightResult::Failed => return None,
            }
            if result.changed().await.is_err() {
                return None;
            }
        }
    }
}

struct DirectTorrentEngine {
    session: Arc<Session>,
    port: u16,
    stream_diagnostics: crate::direct_torrent_stream::StreamDiagnostics,
    fastresume_folder: PathBuf,
    socks_proxy_url: Option<String>,
    bind_interface: Option<String>,
}

struct ActivePlayback {
    playback_id: u64,
    torrent_id: usize,
    handle: Arc<ManagedTorrent>,
    selected_file_index: usize,
    subtitle_indices: HashSet<usize>,
    selected_size: u64,
    uploaded_at_start: u64,
    upload_bps: NonZeroU32,
    upload_reduced: bool,
    download_bps: Option<NonZeroU32>,
    download_reduced: bool,
    first_frame: bool,
    /// Holds a zero-position FileStream open from before the torrent is unpaused until mpv has
    /// accepted the URL. librqbit schedules active stream ranges before ordinary selected-file
    /// pieces, so the first peer requests warm the media header instead of arbitrary payload.
    startup_stream_release: Option<oneshot::Sender<()>>,
    next_episode_preload: Option<NextEpisodePreload>,
    cleanup_task: Option<JoinHandle<()>>,
}

struct NextEpisodePreload {
    file_index: usize,
    size: u64,
    subtitle_indices: HashSet<usize>,
    /// Dropping/sending this releases the FileStream that prioritizes the next file's first 32 MiB.
    _stream_release: oneshot::Sender<()>,
}

struct PreparedTorrent {
    info_hash: String,
    handle: Arc<ManagedTorrent>,
    file_index: usize,
    size: u64,
}

#[derive(Clone)]
struct CachedTorrentMetadata {
    torrent_bytes: Vec<u8>,
    seen_peers: Vec<SocketAddr>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectTorrentPlayback {
    url: String,
    filename: String,
    file_index: usize,
    size: u64,
    torrent_size: u64,
    piece_count: usize,
    playback_id: u64,
    subtitles: Vec<DirectTorrentSubtitle>,
    engine_ready_ms: u64,
    metadata_ms: u64,
    active_lock_wait_ms: u64,
    initialization_ms: u64,
    total_ms: u64,
    reused_torrent: bool,
    metadata_peers: usize,
    metadata_cached: bool,
    metadata_cache: String,
    tracker_count: usize,
    incoming_peer_port: Option<u16>,
    fastresume_primed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectTorrentStreamStarted {
    playback_id: u64,
    file_index: usize,
    request_range: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectTorrentHealth {
    downloaded_bytes: u64,
    selected_size: u64,
    download_mbps: f64,
    live_peers: usize,
    /// Everything below is diagnostic only — the startup/stall watchdog uses the four fields
    /// above. `not_needed_peers` climbing while the player waits is the signature of the engine
    /// believing it has nothing left to fetch, which is why the selection must stay applied for
    /// the whole of playback (see `torrent_playback_url`).
    upload_mbps: f64,
    queued_peers: usize,
    connecting_peers: usize,
    dead_peers: usize,
    not_needed_peers: usize,
    seen_peers: usize,
    fetched_bytes: u64,
    /// librqbit's own view: "live" / "paused" / "initializing" / "error".
    state: String,
    /// True once every SELECTED piece is downloaded. During playback this must stay false, or the
    /// engine stops treating peers as needed.
    finished: bool,
    error: Option<String>,
    stream_request_count: u64,
    stream_file_index: Option<usize>,
    stream_request_range: Option<String>,
    stream_status: Option<u16>,
    stream_response_bytes: Option<u64>,
    stream_range_start: Option<u64>,
    stream_range_end: Option<u64>,
    stream_first_byte_ms: Option<u64>,
    stream_bytes_served: u64,
    stream_read_finished: bool,
    stream_read_failed: bool,
    next_preload_file_index: Option<usize>,
    next_preload_downloaded_bytes: u64,
    next_preload_size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectTorrentNextPreload {
    file_index: usize,
    filename: String,
    size: u64,
    downloaded_bytes: u64,
    same_torrent: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectTorrentSubtitle {
    file_index: usize,
    url: String,
    lang: String,
    title: String,
}

fn file_stem(name: &str) -> &str {
    let basename = name.rsplit(['/', '\\']).next().unwrap_or(name);
    basename
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(basename)
}

fn subtitle_title(video: &TorrentFile, subtitle: &TorrentFile) -> String {
    let video_stem = file_stem(&video.name);
    let subtitle_stem = file_stem(&subtitle.name);
    let suffix = subtitle_stem
        .strip_prefix(video_stem)
        .unwrap_or(subtitle_stem)
        .trim_matches(|c: char| matches!(c, '.' | '_' | '-' | ' ' | '[' | ']' | '(' | ')'));
    let words = suffix
        .split(|c: char| matches!(c, '.' | '_' | '-'))
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    let words = if words
        .first()
        .is_some_and(|word| subtitle_language(word) != "und")
    {
        &words[1..]
    } else {
        &words[..]
    };
    if words.is_empty() {
        "Subtitle".to_string()
    } else {
        words.join(" ")
    }
}

pub(crate) fn mbps_to_bps(value: f64) -> Option<NonZeroU32> {
    if !value.is_finite() || value <= 0.0 {
        return None;
    }
    let bytes_per_second = (value * 1_000_000.0 / 8.0)
        .round()
        .clamp(1.0, u32::MAX as f64) as u32;
    NonZeroU32::new(bytes_per_second)
}

pub(crate) fn upload_limit(upstream_capacity_mbps: Option<f64>) -> NonZeroU32 {
    mbps_to_bps(
        upstream_capacity_mbps
            .filter(|value| value.is_finite() && *value > 0.0)
            .map(|value| value * USER_CAPACITY_FRACTION)
            .unwrap_or(AUTO_UPLOAD_MBPS),
    )
    .expect("the automatic torrent upload limit is non-zero")
}

fn ratio_target_bytes(selected_size: u64) -> u64 {
    selected_size.saturating_add(3) / 4
}

/// `finished` means every currently selected piece is present, not necessarily that the episode
/// is complete. An empty/narrowed selection therefore looks successfully finished while an HTTP
/// reader can still be waiting for a missing byte range forever.
fn selection_needs_restoring(finished: bool, downloaded_bytes: u64, selected_size: u64) -> bool {
    selected_size > 0 && finished && downloaded_bytes < selected_size
}

/// `progress_bytes` means bytes checksum-scanned while librqbit is initializing and later means
/// aggregate selected progress. Neither is the selected episode's download count. During
/// initialization `file_progress` is deliberately empty, so report zero until the per-file value
/// exists instead of making a large batch look fully downloaded.
fn selected_file_downloaded_bytes(
    file_progress: &[u64],
    selected_file_index: usize,
    selected_size: u64,
) -> u64 {
    file_progress
        .get(selected_file_index)
        .copied()
        .unwrap_or(0)
        .min(selected_size)
}

fn managed_torrent_files(handle: &ManagedTorrent) -> Result<Vec<TorrentFile>, String> {
    handle
        .with_metadata(|metadata| {
            metadata
                .info
                .iter_file_details()
                .enumerate()
                .map(|(index, details)| TorrentFile {
                    index,
                    name: details.filename.to_string(),
                    length: details.len,
                })
                .collect::<Vec<_>>()
        })
        .map_err(|error| format!("Could not read the active torrent metadata: {error:#}"))
}

/// Empty/whitespace means "no binding". The value is an OS interface name picked from
/// `list_network_interfaces` and treated as opaque — existence is checked at session start.
pub(crate) fn normalized_bind_interface(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn normalized_socks_proxy(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let parsed =
        url::Url::parse(&value).map_err(|_| "The Direct P2P proxy URL is invalid.".to_string())?;
    if parsed.scheme() != "socks5" {
        return Err("Direct P2P currently supports SOCKS5 proxies only.".into());
    }
    if parsed.host_str().is_none() || parsed.port().is_none() {
        return Err("The SOCKS5 proxy URL needs a host and port.".into());
    }
    if (parsed.path() != "" && parsed.path() != "/")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("The SOCKS5 proxy URL cannot contain a path, query, or fragment.".into());
    }
    Ok(Some(parsed.to_string().trim_end_matches('/').to_string()))
}

/// SOCKS5 in librqbit covers HTTP(S) trackers and peer TCP, but not UDP. Remove UDP trackers from
/// proxy-mode magnets; DHT is disabled at the session level for the same reason. This turns the
/// setting into a kill switch rather than quietly leaking discovery traffic outside the proxy.
pub(crate) fn proxy_safe_magnet(magnet: &str, proxy_enabled: bool) -> Result<String, String> {
    if !proxy_enabled {
        return Ok(magnet.to_string());
    }
    let mut parsed = url::Url::parse(magnet)
        .map_err(|_| "Direct playback needs a valid magnet link.".to_string())?;
    let kept = parsed
        .query_pairs()
        .filter(|(key, value)| key != "tr" || !value.to_ascii_lowercase().starts_with("udp://"))
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    parsed.set_query(None);
    parsed.query_pairs_mut().extend_pairs(kept);
    Ok(parsed.into())
}

/// Add a compact, known-public announce set without rewriting the caller's magnet. Stremio
/// add-ons frequently provide only an info hash; the client compensates with application-level
/// trackers, while we previously left those torrents entirely at the mercy of a cold DHT table.
pub(crate) fn add_public_trackers(magnet: &str) -> Result<String, String> {
    let parsed = url::Url::parse(magnet)
        .map_err(|_| "Direct playback needs a valid magnet link.".to_string())?;
    let existing = parsed
        .query_pairs()
        .filter(|(key, _)| key == "tr")
        .map(|(_, value)| value.into_owned())
        .collect::<HashSet<_>>();
    let mut result = magnet.to_string();
    for tracker in PUBLIC_TRACKERS {
        if existing.contains(tracker) {
            continue;
        }
        if !result.ends_with('?') && !result.ends_with('&') {
            result.push('&');
        }
        result.push_str("tr=");
        result.extend(url::form_urlencoded::byte_serialize(tracker.as_bytes()));
    }
    Ok(result)
}

fn metadata_cache_path(app: &AppHandle, info_hash: &str) -> Result<PathBuf, String> {
    if info_hash.len() != 40 || !info_hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The torrent returned an invalid v1 info hash.".into());
    }
    Ok(crate::cache_gc::cache_root(app)?
        .join(METADATA_CACHE_DIR)
        .join(format!("{}.torrent", info_hash.to_ascii_lowercase())))
}

/// Resolve a metadata prefetch input without touching the network. Magnets keep their tracker
/// enrichment; an extension-provided HTTP(S) .torrent needs the independently reported hash so a
/// malicious or stale URL cannot populate another torrent's cache slot.
fn metadata_prefetch_source(
    value: &str,
    expected_info_hash: Option<&str>,
    proxy_enabled: bool,
) -> Result<Option<(String, String)>, String> {
    let value = value.trim();
    if value.to_ascii_lowercase().starts_with("magnet:?") {
        let magnet = add_public_trackers(value)?;
        let magnet = proxy_safe_magnet(&magnet, proxy_enabled)?;
        let parsed = Magnet::parse(&magnet)
            .map_err(|error| format!("Could not parse the magnet link: {error:#}"))?;
        let Some(info_hash) = parsed.as_id20() else {
            return Ok(None);
        };
        return Ok(Some((info_hash.as_string(), magnet)));
    }

    let Ok(url) = url::Url::parse(value) else {
        return Ok(None);
    };
    if !matches!(url.scheme(), "http" | "https") {
        return Ok(None);
    }
    let Some(expected) = expected_info_hash.map(str::trim) else {
        return Ok(None);
    };
    if expected.len() != 40 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Ok(None);
    }
    Ok(Some((expected.to_ascii_lowercase(), url.into())))
}

async fn read_disk_metadata(path: &Path) -> Option<Vec<u8>> {
    let metadata = tokio::fs::metadata(path).await.ok()?;
    if metadata.len() == 0 || metadata.len() > MAX_CACHED_TORRENT_BYTES {
        let _ = tokio::fs::remove_file(path).await;
        return None;
    }
    tokio::fs::read(path).await.ok()
}

async fn write_disk_metadata(path: PathBuf, bytes: Vec<u8>, startup_id: u64) {
    if bytes.is_empty() || bytes.len() as u64 > MAX_CACHED_TORRENT_BYTES || path.exists() {
        return;
    }
    let Some(parent) = path.parent() else { return };
    if tokio::fs::create_dir_all(parent).await.is_err() {
        return;
    }
    let temporary = path.with_extension(format!("{startup_id}.tmp"));
    if tokio::fs::write(&temporary, bytes).await.is_err() {
        return;
    }
    if tokio::fs::rename(&temporary, &path).await.is_err() {
        // Another concurrent resolve may have won the race, which is a successful outcome.
        let _ = tokio::fs::remove_file(&temporary).await;
    }
}

fn empty_fastresume_bitfield_len(piece_hash_bytes: usize) -> Result<usize, String> {
    const SHA1_BYTES: usize = 20;
    if piece_hash_bytes == 0 || piece_hash_bytes % SHA1_BYTES != 0 {
        return Err("The torrent contains an invalid v1 piece-hash table.".into());
    }
    Ok((piece_hash_bytes / SHA1_BYTES).div_ceil(8))
}

/// A direct-playback subfolder is ephemeral and starts with no trusted pieces. rqbit otherwise
/// walks every piece in the ENTIRE torrent during initialization—even after the first missing-file
/// read proves there is nothing to checksum. A zero fast-resume bitfield expresses the same fact
/// directly: no existing byte is trusted, and the stream still blocks until requested pieces have
/// been downloaded and hash-verified.
async fn prime_empty_fastresume(
    folder: &Path,
    info_hash: &str,
    piece_hash_bytes: usize,
) -> Result<(), String> {
    let bitfield_len = empty_fastresume_bitfield_len(piece_hash_bytes)?;
    tokio::fs::create_dir_all(folder)
        .await
        .map_err(|error| format!("Could not create the torrent fast-resume cache: {error}"))?;
    tokio::fs::write(
        folder.join(format!("{}.bitv", info_hash.to_ascii_lowercase())),
        vec![0; bitfield_len],
    )
    .await
    .map_err(|error| format!("Could not prime torrent fast-resume state: {error}"))
}

impl DirectTorrentState {
    async fn get(
        &self,
        app: &AppHandle,
        socks_proxy_url: Option<String>,
        bind_interface: Option<String>,
    ) -> Result<&Arc<DirectTorrentEngine>, String> {
        let socks_proxy_url = normalized_socks_proxy(socks_proxy_url)?;
        let bind_interface = normalized_bind_interface(bind_interface);
        let configured_proxy = socks_proxy_url.clone();
        let configured_bind = bind_interface.clone();
        let engine = self
            .engine
            .get_or_try_init(|| async {
                // Fail closed BEFORE any socket exists: with a binding configured and the VPN
                // adapter absent, the engine must refuse to start rather than run unprotected.
                if let Some(name) = &configured_bind {
                    crate::net_interfaces::ensure_bound_iface_ready(name).await?;
                }
                // Direct playback is deliberately ephemeral rather than a local library. Retire an
                // abandoned payload with an atomic rename and unlink it off-thread: recursively
                // deleting the previous episode here made release warm-up wait on disk cleanup.
                let folder = crate::cache_gc::fresh_direct_torrent_dir(app)?;

                // Episode payloads are ephemeral, but DHT routing is durable so the first play
                // after launch is not a completely cold peer-discovery bootstrap. rqbit's default
                // project directory is unavailable on Android, so give it an explicit app-private
                // filename there instead of disabling persistence for the whole platform.
                let fastresume_folder = folder.join(".fastresume");
                let android_dht_path = if cfg!(target_os = "android") {
                    Some(
                        app.path()
                            .app_data_dir()
                            .map_err(|error| {
                                format!("Could not locate the Android DHT cache: {error}")
                            })?
                            .join("torrent-dht.json"),
                    )
                } else {
                    None
                };
                let dht = if configured_proxy.is_some() {
                    None
                } else {
                    Some(DhtSessionConfig {
                        port: dht_port_override(cfg!(windows)),
                        persistence: Some(librqbit::dht::DhtPersistenceConfig {
                            config_filename: android_dht_path,
                            ..Default::default()
                        }),
                        ..Default::default()
                    })
                };
                let listen = if peer_listener_enabled(
                    configured_proxy.is_some(),
                    configured_bind.is_some(),
                    native_bind_device_name(configured_bind.as_deref()).is_some(),
                ) {
                    let port = available_peer_port().ok_or_else(|| {
                        format!(
                            "Could not find a free incoming peer port in {}-{}.",
                            DIRECT_PEER_PORTS.start,
                            DIRECT_PEER_PORTS.end - 1
                        )
                    })?;
                    Some(ListenerOptions {
                        mode: peer_listener_mode(),
                        // Keep the established IPv4 listener behavior while librqbit 9's DHT and
                        // outgoing connector gain dual-stack peer discovery and connections.
                        listen_addr: (Ipv4Addr::UNSPECIFIED, port).into(),
                        enable_upnp_port_forwarding: upnp_enabled(
                            cfg!(target_os = "android"),
                            configured_proxy.is_some(),
                            configured_bind.is_some(),
                        ),
                        ..Default::default()
                    })
                } else {
                    None
                };
                let game_mode = cfg!(target_os = "linux")
                    && std::env::var_os("GAMESCOPE_WAYLAND_DISPLAY").is_some();
                let session = Session::new_with_opts(
                    folder,
                    SessionOptions {
                        // This is the actual kernel-enforced adapter binding on macOS/Linux. The
                        // independent VpnGuard below remains active as a second fail-closed layer
                        // and supplies disconnect/reconnect feedback to the UI.
                        bind_device_name: native_bind_device_name(configured_bind.as_deref()),
                        // Proxy mode disables UDP DHT completely to prevent bypassing SOCKS5.
                        dht,
                        // Persistence supplies rqbit's bitfield store. Payload retention remains
                        // ephemeral: this database lives inside the disposable playback folder.
                        persistence: Some(SessionPersistenceConfig::Json {
                            folder: Some(fastresume_folder.clone()),
                        }),
                        fastresume: true,
                        connect: Some(ConnectionOptions {
                            proxy_url: configured_proxy.clone(),
                            ..Default::default()
                        }),
                        // A real listen port lets DHT/trackers announce us and allows peers to
                        // connect back. Android supports ordinary server sockets too; keeping it
                        // outbound-only made Wi-Fi/manual-forwarding and VPN-forwarded ports
                        // unusable. Bound macOS/Linux listeners are safe because librqbit applies
                        // the same device to TCP and uTP; Windows stays outbound-only when bound.
                        listen,
                        peer_limit: crate::gm_perf::torrent_peer_limit(game_mode),
                        runtime_worker_threads: crate::gm_perf::torrent_runtime_threads(game_mode),
                        // Do not silently create a home-router mapping on Android: it can bypass a
                        // system VPN's tunnel and cellular CGNAT cannot benefit. The TCP listener
                        // still works with VPN/manual port forwarding. Desktop retains its existing
                        // UPnP behavior when no explicit privacy route is configured.
                        ..Default::default()
                    },
                )
                .await
                .map_err(|e| format!("Could not start the torrent engine: {e:#}"))?;
                let api = Api::new(session.clone(), None, None);
                let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
                    .await
                    .map_err(|e| format!("Could not start the local playback server: {e}"))?;
                let port = listener
                    .local_addr()
                    .map_err(|e| format!("Could not read the local playback address: {e}"))?
                    .port();
                let stream_diagnostics = crate::direct_torrent_stream::StreamDiagnostics::default();
                let server_diagnostics = stream_diagnostics.clone();
                let (request_started_tx, mut request_started_rx) =
                    mpsc::unbounded_channel::<crate::direct_torrent_stream::StreamRequestStarted>();
                let active_for_requests = self.active.clone();
                let app_for_requests = app.clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(request) = request_started_rx.recv().await {
                        let mut active = active_for_requests.lock().await;
                        let Some(current) = active.as_mut() else {
                            continue;
                        };
                        if current.torrent_id != request.torrent_id
                            || current.selected_file_index != request.file_id
                        {
                            continue;
                        }
                        if let Some(release) = current.startup_stream_release.take() {
                            let _ = release.send(());
                            let _ = app_for_requests.emit(
                                "direct-torrent-stream-started",
                                DirectTorrentStreamStarted {
                                    playback_id: current.playback_id,
                                    file_index: request.file_id,
                                    request_range: request.request_range,
                                },
                            );
                        }
                    }
                });
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = crate::direct_torrent_stream::serve(
                        api,
                        listener,
                        server_diagnostics,
                        request_started_tx,
                    )
                    .await
                    {
                        eprintln!("direct torrent playback server stopped: {error:#}");
                    }
                });
                // Register with the kill switch that pauses/resumes this session as the bound
                // adapter disappears/returns. No-op without a binding.
                app.state::<crate::net_interfaces::VpnGuard>()
                    .attach(app, configured_bind.clone(), &session)
                    .await?;
                Ok::<Arc<DirectTorrentEngine>, String>(Arc::new(DirectTorrentEngine {
                    session,
                    port,
                    stream_diagnostics,
                    fastresume_folder,
                    socks_proxy_url: configured_proxy,
                    bind_interface: configured_bind,
                }))
            })
            .await?;
        if engine.socks_proxy_url != socks_proxy_url || engine.bind_interface != bind_interface {
            return Err(crate::net_interfaces::BINDING_CHANGED_ERROR.into());
        }
        Ok(engine)
    }
}

/// Start session/DHT initialization while the user is still browsing. This never adds a torrent.
#[tauri::command]
pub async fn torrent_engine_warmup(
    app: AppHandle,
    state: tauri::State<'_, DirectTorrentState>,
    socks_proxy_url: Option<String>,
    bind_interface: Option<String>,
) -> Result<(), String> {
    state
        .get(&app, socks_proxy_url, bind_interface)
        .await
        .map(|_| ())
}

async fn delete_active(
    session: &Arc<Session>,
    active: &Arc<Mutex<Option<ActivePlayback>>>,
    playback_id: u64,
) {
    let torrent_id = {
        let mut guard = active.lock().await;
        if guard.as_ref().map(|item| item.playback_id) != Some(playback_id) {
            return;
        }
        guard.take().map(|item| item.torrent_id)
    };

    if let Some(torrent_id) = torrent_id {
        if let Err(error) = session.delete(TorrentIdOrHash::Id(torrent_id), true).await {
            eprintln!("could not delete direct torrent playback cache: {error:#}");
        }
    }
}

fn configured_startup_timeout(timeout_ms: Option<u64>) -> Duration {
    timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(METADATA_TIMEOUT)
        .clamp(MIN_STARTUP_TIMEOUT, METADATA_TIMEOUT)
}

fn remaining_startup_time(started: Instant, budget: Duration) -> Duration {
    budget.saturating_sub(started.elapsed())
}

fn startup_is_current(state: &DirectTorrentState, startup_id: u64) -> bool {
    state.active_startup_id.load(Ordering::Acquire) == startup_id
}

async fn wait_for_startup_cancellation(state: &DirectTorrentState, startup_id: u64) {
    while startup_is_current(state, startup_id) {
        sleep(STARTUP_CANCEL_POLL).await;
    }
}

async fn list_torrent_metadata(
    session: &Arc<Session>,
    source: AddTorrent<'_>,
    allowance: Duration,
) -> Result<AddTorrentResponse, String> {
    timeout(
        allowance,
        session.add_torrent(
            source,
            Some(AddTorrentOptions {
                list_only: true,
                ..Default::default()
            }),
        ),
    )
    .await
    .map_err(|_| {
        "Timed out while looking for torrent metadata. Try a source with more seeders.".to_string()
    })?
    .map_err(|error| format!("Could not resolve the magnet: {error:#}"))
}

/// Abort the native half of a connecting attempt. A Tauri `invoke()` promise itself is not
/// cancelable, so merely dropping its JavaScript owner used to leave metadata discovery running for
/// 60 seconds and holding up the next source. New starts also advance this generation themselves.
#[tauri::command]
pub fn torrent_playback_cancel_start(state: tauri::State<'_, DirectTorrentState>, startup_id: u64) {
    // Compare-and-clear makes a delayed Cancel harmless after a replacement has already started.
    // A blind increment could arrive out of order across two invokes and cancel the new source.
    let _ = state.active_startup_id.compare_exchange(
        startup_id,
        0,
        Ordering::AcqRel,
        Ordering::Acquire,
    );
}

async fn begin_metadata_flight(
    state: &DirectTorrentState,
    info_hash: &str,
) -> (Arc<MetadataFlight>, bool) {
    let mut current = state.prefetching.lock().await;
    if let Some(entry) = current.as_ref() {
        if entry.info_hash == info_hash {
            return (entry.flight.clone(), false);
        }
        entry.flight.cancel();
    }
    let flight = Arc::new(MetadataFlight::new());
    *current = Some(MetadataFlightEntry {
        info_hash: info_hash.to_string(),
        flight: flight.clone(),
    });
    (flight, true)
}

async fn matching_metadata_flight(
    state: &DirectTorrentState,
    info_hash: &str,
) -> Option<Arc<MetadataFlight>> {
    state
        .prefetching
        .lock()
        .await
        .as_ref()
        .filter(|entry| entry.info_hash == info_hash)
        .map(|entry| entry.flight.clone())
}

async fn cancel_other_metadata_flight(state: &DirectTorrentState, info_hash: &str) {
    let current = state.prefetching.lock().await;
    if let Some(entry) = current.as_ref() {
        if entry.info_hash != info_hash {
            entry.flight.cancel();
        }
    }
}

async fn finish_metadata_flight(
    state: &DirectTorrentState,
    info_hash: &str,
    flight: &Arc<MetadataFlight>,
    metadata: Option<CachedTorrentMetadata>,
) {
    flight.result.send_replace(match metadata {
        Some(metadata) => MetadataFlightResult::Ready(metadata),
        None => MetadataFlightResult::Failed,
    });
    let mut current = state.prefetching.lock().await;
    if current
        .as_ref()
        .is_some_and(|entry| entry.info_hash == info_hash && Arc::ptr_eq(&entry.flight, flight))
    {
        *current = None;
    }
}

/// Warm the metadata cache for a magnet the picker is about to auto-commit. The DHT/tracker
/// metadata exchange is the dominant variable in click-to-first-frame for direct P2P (routinely
/// 2-15 s), and the auto-pick countdown is pure dead time in front of it — this runs the same
/// list-only lookup and cache writes as torrent_playback_url so the commit that follows finds the
/// metadata already in memory/on disk. Best-effort by design: any failure is reported as `false`
/// and the real start falls back with its remaining budget. A real start for the same hash joins
/// this lookup instead of duplicating it. Returns `true` when metadata is cached (already/freshly).
#[tauri::command]
pub async fn torrent_metadata_prefetch(
    app: AppHandle,
    state: tauri::State<'_, DirectTorrentState>,
    magnet: String,
    expected_info_hash: Option<String>,
    socks_proxy_url: Option<String>,
    bind_interface: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<bool, String> {
    let socks_proxy_url = normalized_socks_proxy(socks_proxy_url)?;
    let Some((info_hash_key, source)) = metadata_prefetch_source(
        &magnet,
        expected_info_hash.as_deref(),
        socks_proxy_url.is_some(),
    )?
    else {
        return Ok(false);
    };

    if state
        .metadata_cache
        .lock()
        .await
        .contains_key(&info_hash_key)
    {
        return Ok(true);
    }
    let disk_cache_path = metadata_cache_path(&app, &info_hash_key)?;
    if read_disk_metadata(&disk_cache_path).await.is_some() {
        return Ok(true);
    }
    let (flight, owns_flight) = begin_metadata_flight(&state, &info_hash_key).await;
    if !owns_flight {
        return Ok(flight.wait().await.is_some());
    }
    let mut cancel = flight.cancel.subscribe();
    let result: Result<Option<CachedTorrentMetadata>, String> = tokio::select! {
      _ = async {
        if !*cancel.borrow() {
            let _ = cancel.changed().await;
        }
      } => Ok(None),
      result = async {
        // A prefetch must never be the thing that surfaces a VPN/kill-switch error — that belongs
        // to a real playback attempt the user can see fail.
        if app
            .state::<crate::net_interfaces::VpnGuard>()
            .ensure_up()
            .is_err()
        {
            return Ok(None);
        }
        let engine = state.get(&app, socks_proxy_url, bind_interface).await?;
        let allowance = timeout_ms
            .map(Duration::from_millis)
            .unwrap_or(STARTUP_STREAM_PRIORITY_TIMEOUT)
            .clamp(MIN_STARTUP_TIMEOUT, METADATA_TIMEOUT);
        let listing =
            match list_torrent_metadata(&engine.session, AddTorrent::from_url(&source), allowance)
                .await
            {
                Ok(AddTorrentResponse::ListOnly(listing)) => listing,
                _ => return Ok(None),
            };
        if listing.info_hash.as_string() != info_hash_key {
            return Ok(None);
        }
        let torrent_bytes = listing.torrent_bytes.to_vec();
        let metadata = CachedTorrentMetadata {
            torrent_bytes: torrent_bytes.clone(),
            seen_peers: listing.seen_peers.clone(),
        };
        let mut cache = state.metadata_cache.lock().await;
        if cache.len() >= METADATA_CACHE_ENTRIES {
            if let Some(oldest) = cache.keys().next().cloned() {
                cache.remove(&oldest);
            }
        }
        cache.insert(
            info_hash_key.clone(),
            metadata.clone(),
        );
        drop(cache);
        tauri::async_runtime::spawn(write_disk_metadata(disk_cache_path, torrent_bytes, 0));
        Ok(Some(metadata))
      } => result,
    };
    match result {
        Ok(metadata) => {
            finish_metadata_flight(&state, &info_hash_key, &flight, metadata.clone()).await;
            Ok(metadata.is_some())
        }
        Err(error) => {
            finish_metadata_flight(&state, &info_hash_key, &flight, None).await;
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn torrent_playback_url(
    app: AppHandle,
    state: tauri::State<'_, DirectTorrentState>,
    magnet: String,
    preferred_file_index: Option<usize>,
    preferred_filename: Option<String>,
    series_title: Option<String>,
    episode: Option<u32>,
    absolute_episode: Option<u32>,
    season: Option<u32>,
    download_limit_mbps: Option<f64>,
    upstream_capacity_mbps: Option<f64>,
    socks_proxy_url: Option<String>,
    bind_interface: Option<String>,
    startup_timeout_ms: Option<u64>,
    startup_id: u64,
) -> Result<DirectTorrentPlayback, String> {
    let total_started = Instant::now();
    let magnet = magnet.trim();
    if !magnet.to_ascii_lowercase().starts_with("magnet:?") {
        return Err("Direct playback needs a valid magnet link.".into());
    }

    if startup_id == 0 {
        return Err("Torrent startup needs a non-zero request id.".into());
    }
    // Store, rather than increment: the caller can later cancel this exact request without a
    // delayed cancel message being able to invalidate whichever request replaced it.
    state.active_startup_id.store(startup_id, Ordering::Release);
    let startup_timeout = configured_startup_timeout(startup_timeout_ms);
    let socks_proxy_url = normalized_socks_proxy(socks_proxy_url)?;
    let magnet = add_public_trackers(magnet)?;
    let magnet = proxy_safe_magnet(&magnet, socks_proxy_url.is_some())?;
    let parsed_magnet =
        Magnet::parse(&magnet).map_err(|e| format!("Could not parse the magnet link: {e:#}"))?;
    let info_hash = parsed_magnet
        .as_id20()
        .ok_or("Direct playback currently needs a BitTorrent v1 info hash.")?;
    let info_hash_key = info_hash.as_string();
    // A speculative lookup for a candidate the user did not choose has no value now and can
    // contend with the selected torrent on constrained Android devices. Preserve the matching
    // flight so this startup can join it below.
    cancel_other_metadata_flight(&state, &info_hash_key).await;
    let magnet_trackers = parsed_magnet.trackers;
    let tracker_count = magnet_trackers.len();
    // Engine construction, metadata discovery, and torrent initialization share one deadline. In
    // particular, do not let a stalled OnceCell initializer leave Android source selection waiting
    // forever before the metadata timeout has even started.
    let startup_budget_started = Instant::now();
    let engine_started = Instant::now();
    let engine_allowance = remaining_startup_time(startup_budget_started, startup_timeout);
    let engine = tokio::select! {
        result = timeout(engine_allowance, state.get(&app, socks_proxy_url, bind_interface)) => {
            result
                .map_err(|_| "Timed out while starting the torrent engine. Please try again.".to_string())??
        }
        _ = wait_for_startup_cancellation(&state, startup_id) => {
            return Err(STARTUP_CANCELED.into());
        }
    };
    let engine_ready_ms = engine_started.elapsed().as_millis() as u64;
    if !startup_is_current(&state, startup_id) {
        return Err(STARTUP_CANCELED.into());
    }
    // With the kill switch engaged, the metadata fetch below would sit on a paused session until
    // its 60 s timeout and then blame the seeders. Fail fast with the real reason instead.
    app.state::<crate::net_interfaces::VpnGuard>().ensure_up()?;
    // Every remaining phase consumes what is left of the same attempt budget. Applying the full
    // allowance to each phase separately could turn a 15-second automatic attempt into 45 seconds.
    let metadata_started = Instant::now();
    let memory_metadata = state
        .metadata_cache
        .lock()
        .await
        .get(&info_hash_key)
        .cloned();
    let disk_cache_path = metadata_cache_path(&app, &info_hash_key)?;
    let memory_cached = memory_metadata.is_some();
    let disk_metadata = if !memory_cached {
        read_disk_metadata(&disk_cache_path).await
    } else {
        None
    };
    let disk_cached = disk_metadata.is_some();
    let mut cached_metadata = memory_metadata.or_else(|| {
        disk_metadata.map(|torrent_bytes| CachedTorrentMetadata {
            torrent_bytes,
            seen_peers: Vec::new(),
        })
    });
    let mut metadata_cache = if memory_cached {
        "memory"
    } else if disk_cached {
        "disk"
    } else {
        "miss"
    };
    if cached_metadata.is_none() {
        if let Some(flight) = matching_metadata_flight(&state, &info_hash_key).await {
            let allowance = remaining_startup_time(startup_budget_started, startup_timeout);
            let joined = tokio::select! {
                result = timeout(allowance, flight.wait()) => result.ok().flatten(),
                _ = wait_for_startup_cancellation(&state, startup_id) => {
                    return Err(STARTUP_CANCELED.into());
                }
            };
            if joined.is_some() {
                metadata_cache = "prefetch";
                cached_metadata = joined;
            }
        }
    }
    let mut metadata_cached = cached_metadata.is_some();
    let cached_peers = cached_metadata
        .as_ref()
        .map(|cached| cached.seen_peers.clone())
        .unwrap_or_default();
    let metadata_source = cached_metadata
        .map(|cached| AddTorrent::from_bytes(cached.torrent_bytes))
        .unwrap_or_else(|| AddTorrent::from_url(&magnet));
    let first_listing = tokio::select! {
        result = list_torrent_metadata(
            &engine.session,
            metadata_source,
            remaining_startup_time(startup_budget_started, startup_timeout),
        ) => result,
        _ = wait_for_startup_cancellation(&state, startup_id) => {
            return Err(STARTUP_CANCELED.into());
        }
    }
    .and_then(|response| match &response {
        AddTorrentResponse::ListOnly(listing) if listing.info_hash.as_string() != info_hash_key => {
            Err("Cached torrent metadata did not match its info hash.".to_string())
        }
        _ => Ok(response),
    });
    let listing = if metadata_cached && first_listing.is_err() {
        // A partial write, old format, or manual cache edit must degrade to an ordinary magnet
        // lookup rather than make that info hash permanently unplayable.
        state.metadata_cache.lock().await.remove(&info_hash_key);
        let _ = tokio::fs::remove_file(&disk_cache_path).await;
        metadata_cached = false;
        metadata_cache = "invalid-fallback";
        tokio::select! {
            result = list_torrent_metadata(
                &engine.session,
                AddTorrent::from_url(&magnet),
                remaining_startup_time(startup_budget_started, startup_timeout),
            ) => result,
            _ = wait_for_startup_cancellation(&state, startup_id) => {
                return Err(STARTUP_CANCELED.into());
            }
        }?
    } else {
        first_listing?
    };
    let metadata_ms = metadata_started.elapsed().as_millis() as u64;

    let mut listing = match listing {
        AddTorrentResponse::ListOnly(listing) => listing,
        _ => return Err("The torrent engine returned an invalid metadata response.".into()),
    };
    if metadata_cached {
        // Parsing cached .torrent bytes does not discover peers. Retain the peers observed during
        // the original magnet exchange as an immediate seed for the actual playback torrent.
        listing.seen_peers = cached_peers;
    } else {
        let torrent_bytes = listing.torrent_bytes.to_vec();
        let mut cache = state.metadata_cache.lock().await;
        if cache.len() >= METADATA_CACHE_ENTRIES {
            if let Some(oldest) = cache.keys().next().cloned() {
                cache.remove(&oldest);
            }
        }
        cache.insert(
            listing.info_hash.as_string(),
            CachedTorrentMetadata {
                torrent_bytes: torrent_bytes.clone(),
                seen_peers: listing.seen_peers.clone(),
            },
        );
        drop(cache);
        tauri::async_runtime::spawn(write_disk_metadata(
            disk_cache_path,
            torrent_bytes,
            startup_id,
        ));
    }
    let metadata_peers = listing.seen_peers.len();
    let piece_hash_bytes = listing.info.info().pieces.as_ref().len();
    let files = listing
        .info
        .iter_file_details()
        .enumerate()
        .map(|(index, details)| TorrentFile {
            index,
            name: details.filename.to_string(),
            length: details.len,
        })
        .collect::<Vec<_>>();
    let torrent_size = files
        .iter()
        .fold(0u64, |total, file| total.saturating_add(file.length));
    let piece_count = piece_hash_bytes / 20;
    let selected = preferred_file_index
        .and_then(|index| select_file_by_index(&files, index))
        .or_else(|| {
            select_file_for_title(
                &files,
                preferred_filename.as_deref(),
                series_title.as_deref(),
                episode,
                absolute_episode,
                season,
            )
        })
        .ok_or_else(|| {
            if episode.is_some() || absolute_episode.is_some() {
                "Could not identify the requested episode inside this torrent. Try another source."
                    .to_string()
            } else {
                "This torrent does not contain a supported video file.".to_string()
            }
        })?;
    // Direct sidecars are tiny and selected alongside the video, but nothing waits for their
    // pieces here. The active video HTTP stream retains librqbit's priority; Windows attaches
    // these tracks live once player_embed has returned.
    let subtitle_files = select_subtitles(&files, &selected);
    // This selection stays applied for the whole of playback and must always contain the video.
    // librqbit treats a torrent whose every SELECTED piece is present as finished, and a finished
    // torrent tells its peers "not interested" and drops the ones holding the full torrent — i.e.
    // the seeders. Streaming reads keep the torrent unfinished only while an HTTP FileStream is
    // registered, and mpv closes and reopens that stream on every seek, so narrowing the selection
    // to the sidecars mid-playback opens a window on each seek in which the seeders are purged.
    // Keeping the episode selected costs at most one episode of ephemeral cache (already bounded
    // by only_files) and gives the player read-ahead beyond librqbit's 32 MiB stream window.
    let selected_indices = std::iter::once(selected.index)
        .chain(subtitle_files.iter().map(|file| file.index))
        .collect::<HashSet<_>>();

    let upload_bps = upload_limit(upstream_capacity_mbps);
    let download_bps = download_limit_mbps.and_then(mbps_to_bps);
    engine.session.ratelimits.set_upload_bps(Some(upload_bps));
    engine.session.ratelimits.set_download_bps(download_bps);

    // Claim a background-prepared single-episode torrent before replacing the current one. A
    // stale slot is deleted here so a manual source/title change cannot leave it downloading.
    let (prepared_torrent, stale_prepared) = {
        let mut prepared = state.prepared_next.lock().await;
        match prepared.take() {
            Some(item) if item.info_hash == info_hash_key => (Some(item), None),
            Some(item) => (None, Some(item)),
            None => (None, None),
        }
    };
    if let Some(stale) = stale_prepared {
        let _ = engine
            .session
            .delete(TorrentIdOrHash::Id(stale.handle.id()), true)
            .await;
    }

    // Serialize replacement with post-play cleanup. Reuse the same managed torrent for another
    // episode in a season pack, or claim the one prepared-next handle. During ordinary playback
    // there is one active torrent; the binge feature may keep exactly one additional bounded slot.
    let active_lock_started = Instant::now();
    let mut active = tokio::select! {
        active = state.active.lock() => active,
        _ = wait_for_startup_cancellation(&state, startup_id) => {
            return Err(STARTUP_CANCELED.into());
        }
    };
    let active_lock_wait_ms = active_lock_started.elapsed().as_millis() as u64;
    let same_torrent = active
        .as_ref()
        .filter(|item| item.handle.info_hash() == listing.info_hash)
        .map(|item| item.handle.clone());

    if same_torrent.is_none() {
        if let Some(mut previous) = active.take() {
            if let Some(task) = previous.cleanup_task.take() {
                task.abort();
            }
            engine
                .session
                .delete(TorrentIdOrHash::Id(previous.torrent_id), true)
                .await
                .map_err(|e| format!("Could not replace the previous torrent: {e:#}"))?;
        }
    } else if let Some(current) = active.as_mut() {
        if let Some(task) = current.cleanup_task.take() {
            task.abort();
        }
    }

    let claimed_prepared = prepared_torrent.is_some();
    let (handle, reused_torrent) = if let Some(handle) = same_torrent {
        (handle, true)
    } else if let Some(prepared) = prepared_torrent {
        (prepared.handle, true)
    } else {
        // This must happen after the previous torrent is deleted: rqbit persistence removes its
        // mapped bitfield during deletion. Priming earlier could have our new file removed with it
        // when two releases happen to share an info hash.
        prime_empty_fastresume(&engine.fastresume_folder, &info_hash_key, piece_hash_bytes).await?;
        let added = engine
            .session
            .add_torrent(
                AddTorrent::from_bytes(listing.torrent_bytes),
                Some(AddTorrentOptions {
                    only_files: Some(selected_indices.iter().copied().collect()),
                    overwrite: true,
                    initial_peers: Some(listing.seen_peers),
                    // Preserve the addon's current tracker hints even on a metadata-cache hit.
                    trackers: Some(magnet_trackers),
                    // Initialize storage without allowing ordinary sequential pieces to occupy
                    // peer request slots. A priority FileStream is registered before unpausing.
                    paused: true,
                    // A timed-out initialization may still be unwinding when the fallback starts.
                    // Never make the retry checksum or contend with that abandoned attempt's files.
                    sub_folder: Some(format!("playback-{startup_id}")),
                    ..Default::default()
                }),
            )
            .await
            .map_err(|e| format!("Could not start the torrent: {e:#}"))?;
        added
            .into_handle()
            .map(|handle| (handle, false))
            .ok_or_else(|| "The torrent did not start.".to_string())?
    };
    let delete_on_failure = !reused_torrent || claimed_prepared;

    if !startup_is_current(&state, startup_id) {
        if delete_on_failure {
            let _ = engine
                .session
                .delete(TorrentIdOrHash::Id(handle.id()), true)
                .await;
        }
        return Err(STARTUP_CANCELED.into());
    }

    // The HTTP stream API rejects reads while a torrent is still initializing. Returning its URL
    // before this point lets mpv make one failed request and close it permanently while librqbit
    // goes on downloading the episode in the background. Wait only for checksum/storage setup —
    // NOT for episode data — so the first URL request is guaranteed to be streamable.
    let initialization_started = Instant::now();
    let initialization = tokio::select! {
        result = timeout(
            remaining_startup_time(startup_budget_started, startup_timeout),
            handle.wait_until_initialized(),
        ) => result
            .map_err(|_| "Timed out while preparing the torrent stream.".to_string())?
            .map_err(|e| format!("Could not prepare the torrent stream: {e:#}")),
        _ = wait_for_startup_cancellation(&state, startup_id) => {
            Err(STARTUP_CANCELED.into())
        }
    };
    let initialization_ms = initialization_started.elapsed().as_millis() as u64;
    if let Err(error) = initialization {
        // The handle is not installed in `active` until initialization succeeds, so the ordinary
        // stop command cannot see it. Delete it here or every timed-out attempt becomes an orphan
        // that keeps discovering/downloading peers while the fallback source starts.
        if delete_on_failure {
            let _ = engine
                .session
                .delete(TorrentIdOrHash::Id(handle.id()), true)
                .await;
        }
        return Err(error);
    }

    // A newly-added torrent already received this selection through AddTorrentOptions. Reused
    // season packs and claimed prepared handles are narrowed to the episode requested at the cut.
    if reused_torrent {
        if let Err(error) = engine
            .session
            .update_only_files(&handle, &selected_indices)
            .await
        {
            if delete_on_failure {
                let _ = engine
                    .session
                    .delete(TorrentIdOrHash::Id(handle.id()), true)
                    .await;
            }
            return Err(format!(
                "Could not select the episode inside the torrent: {error:#}"
            ));
        }
    }

    // Register byte-zero as a streaming range BEFORE a new torrent is allowed to contact peers.
    // librqbit gives every active FileStream's 32 MiB look-ahead precedence over its natural-order
    // queue. Previously the torrent was live for the whole JS/cache/player handoff, so peers could
    // fill their request queues with background pieces before mpv opened the loopback URL.
    let startup_stream = match handle.clone().stream(selected.index).await {
        Ok(stream) => stream,
        Err(error) => {
            if delete_on_failure {
                let _ = engine
                    .session
                    .delete(TorrentIdOrHash::Id(handle.id()), true)
                    .await;
            }
            return Err(format!(
                "Could not prioritize the torrent stream: {error:#}"
            ));
        }
    };
    if !reused_torrent {
        if let Err(error) = engine.session.unpause(&handle).await {
            let _ = engine
                .session
                .delete(TorrentIdOrHash::Id(handle.id()), true)
                .await;
            return Err(format!("Could not start torrent peers: {error:#}"));
        }
    }

    // FileStream itself is intentionally owned by this task. ActivePlayback stores only the
    // release end of the channel, avoiding a librqbit-internal type in shared application state.
    // The timeout is a fail-safe for an external player or failed frontend callback.
    let (startup_stream_release, released) = oneshot::channel();
    tauri::async_runtime::spawn(async move {
        let _startup_stream = startup_stream;
        tokio::select! {
            _ = released => {}
            _ = sleep(STARTUP_STREAM_PRIORITY_TIMEOUT) => {}
        }
    });

    let playback_id = state.next_playback_id.fetch_add(1, Ordering::Relaxed) + 1;
    let uploaded_at_start = handle.stats().uploaded_bytes;
    let torrent_id = handle.id();
    // Stream diagnostics belong to one playback owner. Without this reset the new episode's first
    // health poll reports the previous file's request count/range until mpv opens the replacement.
    engine.stream_diagnostics.reset();
    let subtitles = subtitle_files
        .iter()
        .map(|file| DirectTorrentSubtitle {
            file_index: file.index,
            url: format!(
                "http://127.0.0.1:{}/torrents/{}/stream/{}",
                engine.port, torrent_id, file.index
            ),
            lang: subtitle_language(&file.name).to_string(),
            title: subtitle_title(&selected, file),
        })
        .collect::<Vec<_>>();
    *active = Some(ActivePlayback {
        playback_id,
        torrent_id,
        handle,
        selected_file_index: selected.index,
        subtitle_indices: subtitle_files.iter().map(|file| file.index).collect(),
        selected_size: selected.length,
        uploaded_at_start,
        upload_bps,
        upload_reduced: false,
        download_bps,
        download_reduced: false,
        first_frame: false,
        startup_stream_release: Some(startup_stream_release),
        next_episode_preload: None,
        cleanup_task: None,
    });
    drop(active);

    Ok(DirectTorrentPlayback {
        url: format!(
            "http://127.0.0.1:{}/torrents/{}/stream/{}",
            engine.port, torrent_id, selected.index
        ),
        filename: selected.name,
        file_index: selected.index,
        size: selected.length,
        torrent_size,
        piece_count,
        playback_id,
        subtitles,
        engine_ready_ms,
        metadata_ms,
        active_lock_wait_ms,
        initialization_ms,
        total_ms: total_started.elapsed().as_millis() as u64,
        reused_torrent,
        metadata_peers,
        metadata_cached,
        metadata_cache: metadata_cache.to_string(),
        tracker_count,
        incoming_peer_port: engine.session.listen_addr().map(|address| address.port()),
        fastresume_primed: !reused_torrent || claimed_prepared,
    })
}

/// Release the synthetic byte-zero priority stream once mpv has accepted the real HTTP stream.
/// mpv's own range requests remain registered with librqbit and take over priority from here.
#[tauri::command]
pub async fn torrent_playback_player_attached(
    state: tauri::State<'_, DirectTorrentState>,
    playback_id: u64,
) -> Result<(), String> {
    let mut active = state.active.lock().await;
    let Some(current) = active.as_mut() else {
        return Ok(());
    };
    if current.playback_id != playback_id || current.cleanup_task.is_some() {
        return Ok(());
    }
    if let Some(release) = current.startup_stream_release.take() {
        let _ = release.send(());
    }
    Ok(())
}

/// Select and prioritize the next episode. A season-pack file is added to the active selection;
/// a different infohash occupies the single bounded prepared-next slot and is adopted at the cut.
#[tauri::command]
pub async fn torrent_playback_prepare_next(
    state: tauri::State<'_, DirectTorrentState>,
    playback_id: u64,
    info_hash: String,
    magnet: Option<String>,
    preferred_file_index: Option<usize>,
    preferred_filename: Option<String>,
    series_title: Option<String>,
    episode: Option<u32>,
    absolute_episode: Option<u32>,
    season: Option<u32>,
) -> Result<DirectTorrentNextPreload, String> {
    let engine = state
        .engine
        .get()
        .ok_or("The direct torrent player is not running.")?;
    let info_hash = info_hash.trim().to_ascii_lowercase();
    if info_hash.len() != 40 || !info_hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The next episode returned an invalid v1 info hash.".into());
    }
    let mut active = state.active.lock().await;
    let current = active
        .as_mut()
        .filter(|item| item.playback_id == playback_id && item.cleanup_task.is_none())
        .ok_or("This torrent playback is no longer active.")?;
    if current.handle.info_hash().as_string() == info_hash {
        let files = managed_torrent_files(&current.handle)?;
        let selected = preferred_file_index
            .and_then(|index| select_file_by_index(&files, index))
            .or_else(|| {
                select_file_for_title(
                    &files,
                    preferred_filename.as_deref(),
                    series_title.as_deref(),
                    episode,
                    absolute_episode,
                    season,
                )
            })
            .ok_or("Could not identify the next episode inside the active season pack.")?;
        if selected.index == current.selected_file_index {
            return Err("The next-episode mapping selected the episode already playing.".into());
        }
        let subtitle_files = select_subtitles(&files, &selected);
        let preload_stream = current
            .handle
            .clone()
            .stream(selected.index)
            .await
            .map_err(|error| format!("Could not prioritize the next episode: {error:#}"))?;
        let next_subtitle_indices = subtitle_files
            .iter()
            .map(|file| file.index)
            .collect::<HashSet<_>>();
        let selected_indices = std::iter::once(current.selected_file_index)
            .chain(current.subtitle_indices.iter().copied())
            .chain(std::iter::once(selected.index))
            .chain(next_subtitle_indices.iter().copied())
            .collect::<HashSet<_>>();
        engine
            .session
            .update_only_files(&current.handle, &selected_indices)
            .await
            .map_err(|error| format!("Could not select the next episode for preload: {error:#}"))?;

        current.next_episode_preload.take();
        let (stream_release, released) = oneshot::channel();
        tauri::async_runtime::spawn(async move {
            let _preload_stream = preload_stream;
            tokio::select! {
                _ = released => {}
                _ = sleep(STARTUP_STREAM_PRIORITY_TIMEOUT) => {}
            }
        });
        current.next_episode_preload = Some(NextEpisodePreload {
            file_index: selected.index,
            size: selected.length,
            subtitle_indices: next_subtitle_indices,
            _stream_release: stream_release,
        });
        let stats = current.handle.stats();
        let downloaded_bytes =
            selected_file_downloaded_bytes(&stats.file_progress, selected.index, selected.length);
        return Ok(DirectTorrentNextPreload {
            file_index: selected.index,
            filename: selected.name,
            size: selected.length,
            downloaded_bytes,
            same_torrent: true,
        });
    }
    drop(active);

    let magnet = magnet.ok_or("The next episode did not provide a magnet link.")?;
    let magnet = add_public_trackers(&magnet)?;
    let magnet = proxy_safe_magnet(&magnet, engine.socks_proxy_url.is_some())?;
    let parsed = Magnet::parse(&magnet)
        .map_err(|error| format!("Could not parse the next episode magnet: {error:#}"))?;
    if parsed.as_id20().map(|hash| hash.as_string()).as_deref() != Some(info_hash.as_str()) {
        return Err("The next episode magnet did not match its info hash.".into());
    }
    let trackers = parsed.trackers;

    let cached = state.metadata_cache.lock().await.get(&info_hash).cloned();
    let source = cached
        .as_ref()
        .map(|cached| AddTorrent::from_bytes(cached.torrent_bytes.clone()))
        .unwrap_or_else(|| AddTorrent::from_url(&magnet));
    let response = list_torrent_metadata(&engine.session, source, METADATA_TIMEOUT).await?;
    let mut listing = match response {
        AddTorrentResponse::ListOnly(listing) => listing,
        _ => return Err("The next episode returned invalid torrent metadata.".into()),
    };
    if listing.info_hash.as_string() != info_hash {
        return Err("The next episode metadata did not match its info hash.".into());
    }
    if let Some(cached) = cached {
        listing.seen_peers = cached.seen_peers;
    } else {
        let mut cache = state.metadata_cache.lock().await;
        if cache.len() >= METADATA_CACHE_ENTRIES {
            if let Some(oldest) = cache.keys().next().cloned() {
                cache.remove(&oldest);
            }
        }
        cache.insert(
            info_hash.clone(),
            CachedTorrentMetadata {
                torrent_bytes: listing.torrent_bytes.to_vec(),
                seen_peers: listing.seen_peers.clone(),
            },
        );
    }
    let files = listing
        .info
        .iter_file_details()
        .enumerate()
        .map(|(index, details)| TorrentFile {
            index,
            name: details.filename.to_string(),
            length: details.len,
        })
        .collect::<Vec<_>>();
    let selected = preferred_file_index
        .and_then(|index| select_file_by_index(&files, index))
        .or_else(|| {
            select_file_for_title(
                &files,
                preferred_filename.as_deref(),
                series_title.as_deref(),
                episode,
                absolute_episode,
                season,
            )
        })
        .ok_or("Could not identify the episode inside the prepared torrent.")?;
    let subtitle_indices = select_subtitles(&files, &selected)
        .into_iter()
        .map(|file| file.index)
        .collect::<HashSet<_>>();
    let selected_indices = std::iter::once(selected.index)
        .chain(subtitle_indices.iter().copied())
        .collect::<HashSet<_>>();

    if let Some(previous) = state.prepared_next.lock().await.take() {
        let _ = engine
            .session
            .delete(TorrentIdOrHash::Id(previous.handle.id()), true)
            .await;
    }
    prime_empty_fastresume(
        &engine.fastresume_folder,
        &info_hash,
        listing.info.info().pieces.as_ref().len(),
    )
    .await?;
    let preload_id = state.next_playback_id.fetch_add(1, Ordering::Relaxed) + 1;
    let added = engine
        .session
        .add_torrent(
            AddTorrent::from_bytes(listing.torrent_bytes),
            Some(AddTorrentOptions {
                only_files: Some(selected_indices.iter().copied().collect()),
                overwrite: true,
                initial_peers: Some(listing.seen_peers),
                trackers: Some(trackers),
                paused: true,
                sub_folder: Some(format!("preload-{playback_id}-{preload_id}")),
                ..Default::default()
            }),
        )
        .await
        .map_err(|error| format!("Could not start the next episode torrent: {error:#}"))?;
    let handle = added
        .into_handle()
        .ok_or("The next episode torrent did not start.")?;
    let prepare_result = async {
        timeout(METADATA_TIMEOUT, handle.wait_until_initialized())
            .await
            .map_err(|_| "Timed out while preparing the next episode torrent.".to_string())?
            .map_err(|error| format!("Could not initialize the next episode torrent: {error:#}"))?;
        let preload_stream = handle
            .clone()
            .stream(selected.index)
            .await
            .map_err(|error| format!("Could not prioritize the prepared episode: {error:#}"))?;
        engine
            .session
            .unpause(&handle)
            .await
            .map_err(|error| format!("Could not start next-episode peers: {error:#}"))?;
        tauri::async_runtime::spawn(async move {
            let _preload_stream = preload_stream;
            sleep(STARTUP_STREAM_PRIORITY_TIMEOUT).await;
        });
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = prepare_result {
        let _ = engine
            .session
            .delete(TorrentIdOrHash::Id(handle.id()), true)
            .await;
        return Err(error);
    }
    let still_current = state
        .active
        .lock()
        .await
        .as_ref()
        .is_some_and(|item| item.playback_id == playback_id && item.cleanup_task.is_none());
    if !still_current {
        let _ = engine
            .session
            .delete(TorrentIdOrHash::Id(handle.id()), true)
            .await;
        return Err("The current episode changed before its preload finished.".into());
    }
    let stats = handle.stats();
    let downloaded_bytes =
        selected_file_downloaded_bytes(&stats.file_progress, selected.index, selected.length);
    let displaced = state.prepared_next.lock().await.replace(PreparedTorrent {
        info_hash,
        handle,
        file_index: selected.index,
        size: selected.length,
    });
    if let Some(displaced) = displaced {
        let _ = engine
            .session
            .delete(TorrentIdOrHash::Id(displaced.handle.id()), true)
            .await;
    }
    Ok(DirectTorrentNextPreload {
        file_index: selected.index,
        filename: selected.name,
        size: selected.length,
        downloaded_bytes,
        same_torrent: false,
    })
}

/// Attach a selected direct-torrent sidecar to the live desktop player. Playback-id and file-index
/// checks prevent a slow subtitle request from a previous episode being inserted into the new one.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn torrent_playback_add_subtitle(
    state: tauri::State<'_, DirectTorrentState>,
    player: tauri::State<'_, crate::player::PlayerHandle>,
    playback_id: u64,
    file_index: usize,
    lang: String,
    title: String,
) -> Result<(), String> {
    let Some(engine) = state.engine.get() else {
        return Err("The direct torrent player is not running.".into());
    };
    let torrent_id = {
        let active = state.active.lock().await;
        let current = active
            .as_ref()
            .filter(|item| item.playback_id == playback_id)
            .ok_or("This torrent playback is no longer active.")?;
        if !current.subtitle_indices.contains(&file_index) {
            return Err("This file is not a subtitle for the active video.".into());
        }
        current.torrent_id
    };
    let url = format!(
        "http://127.0.0.1:{}/torrents/{}/stream/{}",
        engine.port, torrent_id, file_index
    );
    player.add_subtitle_auto(&url, &lang, &title)
}

/// Report actual progress for the selected video. The web player uses this to distinguish a
/// torrent that is still downloading from a genuinely dead source while mpv waits for its first
/// frame (Matroska files may require data near the end before playback begins).
#[tauri::command]
pub async fn torrent_playback_health(
    state: tauri::State<'_, DirectTorrentState>,
    playback_id: u64,
) -> Result<DirectTorrentHealth, String> {
    let engine = state
        .engine
        .get()
        .ok_or("The direct torrent player is not running.")?;
    let active = state.active.lock().await;
    let current = active
        .as_ref()
        .filter(|item| item.playback_id == playback_id && item.cleanup_task.is_none())
        .ok_or("This torrent playback is no longer active.")?;
    let mut stats = current.handle.stats();
    let mut downloaded_bytes = selected_file_downloaded_bytes(
        &stats.file_progress,
        current.selected_file_index,
        current.selected_size,
    );

    // Self-heal the exact state that used to leave mpv buffering forever: librqbit reports the
    // torrent as finished because its selection was cleared even though the episode is incomplete,
    // then moves every seeder to `not_needed`. The ordinary 1 Hz health poll is a safe repair point
    // and the playback-id/cleanup guards above ensure post-play seeding is never restarted.
    if selection_needs_restoring(stats.finished, downloaded_bytes, current.selected_size) {
        let selected_indices = std::iter::once(current.selected_file_index)
            .chain(current.subtitle_indices.iter().copied())
            .chain(current.next_episode_preload.iter().flat_map(|next| {
                std::iter::once(next.file_index).chain(next.subtitle_indices.iter().copied())
            }))
            .collect::<HashSet<_>>();
        if let Err(error) = engine
            .session
            .update_only_files(&current.handle, &selected_indices)
            .await
        {
            eprintln!("could not restore direct torrent playback selection: {error:#}");
        } else {
            stats = current.handle.stats();
            downloaded_bytes = selected_file_downloaded_bytes(
                &stats.file_progress,
                current.selected_file_index,
                current.selected_size,
            );
        }
    }
    let active_pack_preload = current.next_episode_preload.as_ref().map(|next| {
        (
            Some(next.file_index),
            selected_file_downloaded_bytes(&stats.file_progress, next.file_index, next.size),
            next.size,
        )
    });
    let separate_preload = if active_pack_preload.is_none() {
        state.prepared_next.lock().await.as_ref().map(|next| {
            let next_stats = next.handle.stats();
            (
                Some(next.file_index),
                selected_file_downloaded_bytes(
                    &next_stats.file_progress,
                    next.file_index,
                    next.size,
                ),
                next.size,
            )
        })
    } else {
        None
    };
    let (next_preload_file_index, next_preload_downloaded_bytes, next_preload_size) =
        active_pack_preload
            .or(separate_preload)
            .unwrap_or((None, 0, 0));
    let live = stats.live.as_ref();
    let peers = live.map(|live| &live.snapshot.peer_stats);
    let stream = engine.stream_diagnostics.snapshot();

    Ok(DirectTorrentHealth {
        downloaded_bytes,
        selected_size: current.selected_size,
        download_mbps: live.map(|l| l.download_speed.mbps).unwrap_or(0.0),
        live_peers: peers.map(|p| p.live as usize).unwrap_or(0),
        upload_mbps: live.map(|l| l.upload_speed.mbps).unwrap_or(0.0),
        queued_peers: peers.map(|p| p.queued as usize).unwrap_or(0),
        connecting_peers: peers.map(|p| p.connecting as usize).unwrap_or(0),
        dead_peers: peers.map(|p| p.dead as usize).unwrap_or(0),
        not_needed_peers: peers.map(|p| p.not_needed as usize).unwrap_or(0),
        seen_peers: peers.map(|p| p.seen as usize).unwrap_or(0),
        fetched_bytes: live.map(|l| l.snapshot.fetched_bytes).unwrap_or(0),
        state: stats.state.to_string(),
        finished: stats.finished,
        error: stats.error.clone(),
        stream_request_count: stream.request_count,
        stream_file_index: stream.file_index,
        stream_request_range: stream.request_range,
        stream_status: stream.status,
        stream_response_bytes: stream.response_bytes,
        stream_range_start: stream.range_start,
        stream_range_end: stream.range_end,
        stream_first_byte_ms: stream.first_byte_ms,
        stream_bytes_served: stream.bytes_served,
        stream_read_finished: stream.read_finished,
        stream_read_failed: stream.read_failed,
        next_preload_file_index,
        next_preload_downloaded_bytes,
        next_preload_size,
    })
}

/// Protect playback from upload-induced buffer starvation. The player reports seconds buffered
/// ahead; below one minute, upload is reduced to 64 KiB/s (or the user's lower cap).
#[tauri::command]
pub async fn torrent_playback_buffer(
    state: tauri::State<'_, DirectTorrentState>,
    playback_id: u64,
    buffered_seconds: f64,
) -> Result<(), String> {
    let Some(engine) = state.engine.get() else {
        return Ok(());
    };
    let mut active = state.active.lock().await;
    let Some(current) = active.as_mut() else {
        return Ok(());
    };
    if current.playback_id != playback_id || current.cleanup_task.is_some() {
        return Ok(());
    }

    let should_reduce =
        buffered_seconds.is_finite() && buffered_seconds.max(0.0) < PLAYBACK_BUFFER_FLOOR_SECONDS;
    if should_reduce != current.upload_reduced {
        let limit = if should_reduce {
            NonZeroU32::new(current.upload_bps.get().min(BUFFERING_UPLOAD_BPS))
                .expect("the buffering upload limit is non-zero")
        } else {
            current.upload_bps
        };
        engine.session.ratelimits.set_upload_bps(Some(limit));
        current.upload_reduced = should_reduce;
    }
    apply_playback_download_limit(&engine.session, current, should_reduce);
    Ok(())
}

/// First decoded frame is up: hashing/IO can yield to the GPU once the playback buffer is healthy.
#[tauri::command]
pub async fn torrent_playback_first_frame(
    state: tauri::State<'_, DirectTorrentState>,
    playback_id: u64,
) -> Result<(), String> {
    let Some(engine) = state.engine.get() else {
        return Ok(());
    };
    let mut active = state.active.lock().await;
    let Some(current) = active.as_mut() else {
        return Ok(());
    };
    if current.playback_id != playback_id || current.cleanup_task.is_some() {
        return Ok(());
    }
    current.first_frame = true;
    apply_playback_download_limit(&engine.session, current, current.upload_reduced);
    Ok(())
}

fn apply_playback_download_limit(
    session: &Session,
    current: &mut ActivePlayback,
    buffer_low: bool,
) {
    let next = crate::gm_perf::playback_download_bps(
        current.download_bps,
        current.first_frame,
        buffer_low,
    );
    let reduced = next != current.download_bps;
    if reduced == current.download_reduced {
        return;
    }
    session.ratelimits.set_download_bps(next);
    current.download_reduced = reduced;
}

/// End playback. Desktop normally enters a bounded seeding window. Android passes false unless
/// the user opted in and the device is currently charging on an unmetered network.
#[tauri::command]
pub async fn torrent_playback_stop(
    state: tauri::State<'_, DirectTorrentState>,
    playback_id: u64,
    allow_post_playback_seed: bool,
) -> Result<(), String> {
    let Some(engine) = state.engine.get().cloned() else {
        return Ok(());
    };

    let mut active = state.active.lock().await;
    let Some(current) = active.as_mut() else {
        return Ok(());
    };
    if current.playback_id != playback_id {
        return Ok(());
    }
    if current.cleanup_task.is_some() {
        return Ok(());
    }
    current.next_episode_preload.take();
    if let Some(prepared) = state.prepared_next.lock().await.take() {
        let _ = engine
            .session
            .delete(TorrentIdOrHash::Id(prepared.handle.id()), true)
            .await;
    }

    if !allow_post_playback_seed {
        let torrent_id = current.torrent_id;
        *active = None;
        drop(active);
        engine
            .session
            .delete(TorrentIdOrHash::Id(torrent_id), true)
            .await
            .map_err(|e| format!("Could not clear the torrent playback cache: {e:#}"))?;
        return Ok(());
    }

    // Stop fetching the remainder once playback ends, while keeping already-downloaded pieces
    // available to peers for the bounded post-playback seeding window.
    engine
        .session
        .update_only_files(&current.handle, &HashSet::new())
        .await
        .map_err(|e| format!("Could not switch the torrent into seeding mode: {e:#}"))?;
    engine
        .session
        .ratelimits
        .set_upload_bps(Some(current.upload_bps));
    current.upload_reduced = false;

    let active_state = state.active.clone();
    let session = engine.session.clone();
    let task_playback_id = playback_id;
    let task = tokio::spawn(async move {
        let started = Instant::now();
        // Give the player a moment to close its local HTTP stream before a ratio already reached
        // during playback causes immediate cache deletion.
        sleep(Duration::from_secs(2)).await;
        loop {
            let should_delete = {
                let guard = active_state.lock().await;
                let Some(item) = guard.as_ref() else {
                    return;
                };
                if item.playback_id != task_playback_id {
                    return;
                }
                let uploaded = item
                    .handle
                    .stats()
                    .uploaded_bytes
                    .saturating_sub(item.uploaded_at_start);
                uploaded >= ratio_target_bytes(item.selected_size)
                    || started.elapsed() >= POST_PLAYBACK_SEED_TIME
            };
            if should_delete {
                break;
            }
            sleep(SEED_CHECK_INTERVAL).await;
        }
        delete_active(&session, &active_state, task_playback_id).await;
    });
    current.cleanup_task = Some(task);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        add_public_trackers, begin_metadata_flight, configured_startup_timeout, dht_port_override,
        empty_fastresume_bitfield_len, mbps_to_bps, metadata_prefetch_source,
        native_bind_device_name, normalized_socks_proxy, peer_listener_enabled, peer_listener_mode,
        proxy_safe_magnet, ratio_target_bytes, remaining_startup_time,
        selected_file_downloaded_bytes, selection_needs_restoring, startup_is_current,
        upload_limit, upnp_enabled, DirectTorrentState, METADATA_TIMEOUT, MIN_STARTUP_TIMEOUT,
        PUBLIC_TRACKERS,
    };
    use std::sync::atomic::Ordering;

    #[test]
    fn automatic_upload_is_one_megabit() {
        assert_eq!(upload_limit(None).get(), 125_000);
    }

    #[test]
    fn supplied_upstream_uses_seventy_percent() {
        assert_eq!(upload_limit(Some(10.0)).get(), 875_000);
    }

    #[test]
    fn zero_download_limit_means_uncapped() {
        assert_eq!(mbps_to_bps(0.0), None);
    }

    #[test]
    fn direct_sessions_keep_tcp_and_utp_peer_paths_available() {
        assert!(peer_listener_enabled(false, false, false));
        assert!(!upnp_enabled(true, false, false));
        assert!(peer_listener_mode().tcp_enabled());
        assert!(peer_listener_mode().utp_enabled());
        assert!(!peer_listener_enabled(true, false, true));
        assert!(!peer_listener_enabled(false, true, false));
        assert!(peer_listener_enabled(false, true, true));
        assert!(!upnp_enabled(false, false, true));
    }

    #[test]
    fn native_device_binding_is_only_forwarded_on_supported_desktop_platforms() {
        let binding = native_bind_device_name(Some("vpn-test"));
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        assert_eq!(binding.as_deref(), Some("vpn-test"));
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        assert_eq!(binding, None);
    }

    #[test]
    fn windows_dht_does_not_reuse_a_persisted_udp_port() {
        assert_eq!(dht_port_override(true), Some(0));
        assert_eq!(dht_port_override(false), None);
    }

    #[test]
    fn ratio_target_rounds_up_to_a_quarter() {
        assert_eq!(ratio_target_bytes(10), 3);
    }

    #[test]
    fn startup_timeout_is_bounded_but_manual_keeps_the_full_allowance() {
        assert_eq!(configured_startup_timeout(None), METADATA_TIMEOUT);
        assert_eq!(configured_startup_timeout(Some(15_000)).as_secs(), 15);
        assert_eq!(configured_startup_timeout(Some(100)), MIN_STARTUP_TIMEOUT);
        assert_eq!(configured_startup_timeout(Some(120_000)), METADATA_TIMEOUT);
    }

    #[test]
    fn engine_metadata_and_initialization_share_one_startup_budget() {
        let started = tokio::time::Instant::now();
        let remaining = remaining_startup_time(started, std::time::Duration::from_secs(15));
        assert!(remaining <= std::time::Duration::from_secs(15));
        assert!(remaining > std::time::Duration::from_secs(14));
    }

    #[test]
    fn a_new_startup_id_supersedes_the_previous_one() {
        let state = DirectTorrentState::default();
        let first = 41;
        state.active_startup_id.store(first, Ordering::Release);
        assert!(startup_is_current(&state, first));
        let second = 42;
        state.active_startup_id.store(second, Ordering::Release);
        assert!(!startup_is_current(&state, first));
        assert!(startup_is_current(&state, second));
    }

    #[test]
    fn metadata_prefetch_is_single_flight_and_replacing_it_cancels_stale_work() {
        tauri::async_runtime::block_on(async {
            let state = DirectTorrentState::default();
            let (first, owns_first) = begin_metadata_flight(&state, "first").await;
            let (same, owns_same) = begin_metadata_flight(&state, "first").await;
            assert!(owns_first);
            assert!(!owns_same);
            assert!(std::sync::Arc::ptr_eq(&first, &same));

            let mut canceled = first.cancel.subscribe();
            let (_replacement, owns_replacement) = begin_metadata_flight(&state, "second").await;
            assert!(owns_replacement);
            canceled.changed().await.unwrap();
            assert!(*canceled.borrow());
        });
    }

    #[test]
    fn restores_an_incomplete_episode_falsely_marked_finished() {
        assert!(selection_needs_restoring(true, 900, 1_000));
        assert!(!selection_needs_restoring(false, 900, 1_000));
        assert!(!selection_needs_restoring(true, 1_000, 1_000));
        assert!(!selection_needs_restoring(true, 0, 0));
    }

    #[test]
    fn initializing_checksum_progress_is_not_episode_download_progress() {
        assert_eq!(selected_file_downloaded_bytes(&[], 6, 400_000_000), 0);
        assert_eq!(selected_file_downloaded_bytes(&[0, 125], 1, 100), 100);
    }

    #[test]
    fn validates_and_normalizes_socks5_proxy_urls() {
        assert_eq!(
            normalized_socks_proxy(Some(" socks5://127.0.0.1:1080 ".into())).unwrap(),
            Some("socks5://127.0.0.1:1080".into())
        );
        assert!(normalized_socks_proxy(Some("http://127.0.0.1:8080".into())).is_err());
        assert!(normalized_socks_proxy(Some("socks5://127.0.0.1".into())).is_err());
    }

    #[test]
    fn proxy_mode_removes_udp_trackers_but_keeps_http_trackers() {
        let magnet = "magnet:?xt=urn:btih:abc&tr=udp%3A%2F%2Ftracker.example%3A80&tr=https%3A%2F%2Ftracker.example%2Fannounce";
        let safe = proxy_safe_magnet(magnet, true).unwrap();
        assert!(!safe.contains("udp%3A"));
        assert!(safe.contains("https%3A%2F%2Ftracker.example%2Fannounce"));
        assert!(safe.contains("xt=urn%3Abtih%3Aabc"));
    }

    #[test]
    fn bare_magnets_receive_public_trackers_without_rewriting_the_hash() {
        let magnet = "magnet:?xt=urn:btih:0123456789012345678901234567890123456789";
        let enriched = add_public_trackers(magnet).unwrap();
        assert!(enriched.starts_with(magnet));
        for tracker in PUBLIC_TRACKERS {
            let encoded =
                url::form_urlencoded::byte_serialize(tracker.as_bytes()).collect::<String>();
            assert!(enriched.contains(&encoded));
        }
    }

    #[test]
    fn metadata_prefetch_accepts_hash_pinned_torrent_urls() {
        let hash = "0123456789012345678901234567890123456789";
        let (key, source) = metadata_prefetch_source(
            "https://example.com/torrents/123/download?public=true",
            Some(hash),
            false,
        )
        .unwrap()
        .unwrap();
        assert_eq!(key, hash);
        assert_eq!(
            source,
            "https://example.com/torrents/123/download?public=true"
        );
        assert!(
            metadata_prefetch_source("https://example.com/file", None, false)
                .unwrap()
                .is_none()
        );
        assert!(
            metadata_prefetch_source("file:///tmp/a.torrent", Some(hash), false)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn public_tracker_enrichment_does_not_duplicate_existing_urls() {
        let encoded =
            url::form_urlencoded::byte_serialize(PUBLIC_TRACKERS[0].as_bytes()).collect::<String>();
        let magnet = format!("magnet:?xt=urn:btih:abc&tr={encoded}");
        let enriched = add_public_trackers(&magnet).unwrap();
        assert_eq!(enriched.matches(&encoded).count(), 1);
    }

    #[test]
    fn empty_fastresume_matches_rqbits_one_bit_per_piece_layout() {
        assert_eq!(empty_fastresume_bitfield_len(20).unwrap(), 1);
        assert_eq!(empty_fastresume_bitfield_len(8 * 20).unwrap(), 1);
        assert_eq!(empty_fastresume_bitfield_len(9 * 20).unwrap(), 2);
        assert!(empty_fastresume_bitfield_len(0).is_err());
        assert!(empty_fastresume_bitfield_len(21).is_err());
    }
}
