use std::{
    collections::HashSet,
    net::Ipv4Addr,
    num::NonZeroU32,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use librqbit::{
    api::TorrentIdOrHash,
    http_api::{HttpApi, HttpApiOptions},
    AddTorrent, AddTorrentOptions, AddTorrentResponse, Api, ManagedTorrent, Session,
    SessionOptions,
};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::{
    net::TcpListener,
    sync::{Mutex, OnceCell},
    task::JoinHandle,
    time::{sleep, timeout, Instant},
};

use crate::direct_torrent_select::{select_file, select_subtitles, subtitle_language, TorrentFile};

const METADATA_TIMEOUT: Duration = Duration::from_secs(60);
const POST_PLAYBACK_SEED_TIME: Duration = Duration::from_secs(30 * 60);
const SEED_CHECK_INTERVAL: Duration = Duration::from_secs(10);
const PLAYBACK_BUFFER_FLOOR_SECONDS: f64 = 60.0;
const AUTO_UPLOAD_MBPS: f64 = 1.0;
const USER_CAPACITY_FRACTION: f64 = 0.70;
const BUFFERING_UPLOAD_BPS: u32 = 64 * 1024;

#[derive(Default)]
pub struct DirectTorrentState {
    engine: OnceCell<Arc<DirectTorrentEngine>>,
    active: Arc<Mutex<Option<ActivePlayback>>>,
    next_playback_id: AtomicU64,
}

struct DirectTorrentEngine {
    session: Arc<Session>,
    port: u16,
    socks_proxy_url: Option<String>,
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
    cleanup_task: Option<JoinHandle<()>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectTorrentPlayback {
    url: String,
    filename: String,
    file_index: usize,
    size: u64,
    playback_id: u64,
    subtitles: Vec<DirectTorrentSubtitle>,
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

fn mbps_to_bps(value: f64) -> Option<NonZeroU32> {
    if !value.is_finite() || value <= 0.0 {
        return None;
    }
    let bytes_per_second = (value * 1_000_000.0 / 8.0)
        .round()
        .clamp(1.0, u32::MAX as f64) as u32;
    NonZeroU32::new(bytes_per_second)
}

fn upload_limit(upstream_capacity_mbps: Option<f64>) -> NonZeroU32 {
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

fn normalized_socks_proxy(value: Option<String>) -> Result<Option<String>, String> {
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
fn proxy_safe_magnet(magnet: &str, proxy_enabled: bool) -> Result<String, String> {
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

impl DirectTorrentState {
    async fn get(
        &self,
        app: &AppHandle,
        socks_proxy_url: Option<String>,
    ) -> Result<&Arc<DirectTorrentEngine>, String> {
        let socks_proxy_url = normalized_socks_proxy(socks_proxy_url)?;
        let configured_proxy = socks_proxy_url.clone();
        let engine = self
            .engine
            .get_or_try_init(|| async {
                let folder = app
                    .path()
                    .app_cache_dir()
                    .map_err(|e| format!("Could not locate Izumi's cache folder: {e}"))?
                    .join("direct-torrents");

                // Direct playback is deliberately ephemeral rather than a local library. If the
                // app was killed before its normal seeding cleanup, discard that abandoned cache
                // before starting a fresh torrent session.
                match tokio::fs::remove_dir_all(&folder).await {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => {
                        return Err(format!("Could not clear the old torrent cache: {error}"))
                    }
                }
                tokio::fs::create_dir_all(&folder)
                    .await
                    .map_err(|e| format!("Could not create the torrent cache: {e}"))?;

                // Episode payloads are ephemeral, but desktop DHT routing is allowed to persist so
                // the first play after launch is not a completely cold peer-discovery bootstrap.
                // Android still disables that persistence because it has no librqbit project dir.
                let session = Session::new_with_opts(
                    folder,
                    SessionOptions {
                        // Keep desktop's DHT routing table between launches so the first episode
                        // does not bootstrap from zero. Android has no compatible persistence dir.
                        // Proxy mode disables UDP DHT completely to prevent bypassing SOCKS5.
                        disable_dht: configured_proxy.is_some(),
                        disable_dht_persistence: cfg!(target_os = "android")
                            || configured_proxy.is_some(),
                        persistence: None,
                        socks_proxy_url: configured_proxy.clone(),
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
                let server = HttpApi::new(
                    api,
                    Some(HttpApiOptions {
                        read_only: true,
                        basic_auth: None,
                    }),
                );
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = server.make_http_api_and_run(listener, None).await {
                        eprintln!("direct torrent playback server stopped: {error:#}");
                    }
                });
                Ok(Arc::new(DirectTorrentEngine {
                    session,
                    port,
                    socks_proxy_url: configured_proxy,
                }))
            })
            .await?;
        if engine.socks_proxy_url != socks_proxy_url {
            return Err("The Direct P2P network binding changed after its session started. Restart Izumi to apply it safely.".into());
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
) -> Result<(), String> {
    state.get(&app, socks_proxy_url).await.map(|_| ())
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

#[tauri::command]
pub async fn torrent_playback_url(
    app: AppHandle,
    state: tauri::State<'_, DirectTorrentState>,
    magnet: String,
    preferred_filename: Option<String>,
    episode: Option<u32>,
    absolute_episode: Option<u32>,
    season: Option<u32>,
    download_limit_mbps: Option<f64>,
    upstream_capacity_mbps: Option<f64>,
    socks_proxy_url: Option<String>,
) -> Result<DirectTorrentPlayback, String> {
    let magnet = magnet.trim();
    if !magnet.to_ascii_lowercase().starts_with("magnet:?") {
        return Err("Direct playback needs a valid magnet link.".into());
    }

    let socks_proxy_url = normalized_socks_proxy(socks_proxy_url)?;
    let magnet = proxy_safe_magnet(magnet, socks_proxy_url.is_some())?;
    let engine = state.get(&app, socks_proxy_url).await?;
    let listing = timeout(
        METADATA_TIMEOUT,
        engine.session.add_torrent(
            AddTorrent::from_url(&magnet),
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
    .map_err(|e| format!("Could not resolve the magnet: {e:#}"))?;

    let listing = match listing {
        AddTorrentResponse::ListOnly(listing) => listing,
        _ => return Err("The torrent engine returned an invalid metadata response.".into()),
    };
    let files = listing
        .info
        .iter_file_details()
        .map_err(|e| format!("Could not read the torrent file list: {e:#}"))?
        .enumerate()
        .filter_map(|(index, details)| {
            details.filename.to_string().ok().map(|name| TorrentFile {
                index,
                name,
                length: details.len,
            })
        })
        .collect::<Vec<_>>();
    let selected = select_file(
        &files,
        preferred_filename.as_deref(),
        episode,
        absolute_episode,
        season,
    )
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
    engine.session.ratelimits.set_upload_bps(Some(upload_bps));
    engine
        .session
        .ratelimits
        .set_download_bps(download_limit_mbps.and_then(mbps_to_bps));

    // Serialize replacement with post-play cleanup. Reuse the same managed torrent for another
    // episode in a season pack; otherwise remove the previous torrent and its ephemeral files
    // before admitting the new one. This keeps exactly one torrent active.
    let mut active = state.active.lock().await;
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

    let (handle, reused_torrent) = if let Some(handle) = same_torrent {
        (handle, true)
    } else {
        let added = engine
            .session
            .add_torrent(
                AddTorrent::from_bytes(listing.torrent_bytes),
                Some(AddTorrentOptions {
                    only_files: Some(selected_indices.iter().copied().collect()),
                    overwrite: true,
                    initial_peers: Some(listing.seen_peers),
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

    // The HTTP stream API rejects reads while a torrent is still initializing. Returning its URL
    // before this point lets mpv make one failed request and close it permanently while librqbit
    // goes on downloading the episode in the background. Wait only for checksum/storage setup —
    // NOT for episode data — so the first URL request is guaranteed to be streamable.
    timeout(METADATA_TIMEOUT, handle.wait_until_initialized())
        .await
        .map_err(|_| "Timed out while preparing the torrent stream.".to_string())?
        .map_err(|e| format!("Could not prepare the torrent stream: {e:#}"))?;

    // A newly-added torrent already received this exact selection through AddTorrentOptions.
    // Only a reused season pack needs its selection changed to the newly requested episode; its
    // active HTTP stream still receives priority.
    if reused_torrent {
        engine
            .session
            .update_only_files(&handle, &selected_indices)
            .await
            .map_err(|e| format!("Could not select the episode inside the torrent: {e:#}"))?;
    }

    let playback_id = state.next_playback_id.fetch_add(1, Ordering::Relaxed) + 1;
    let uploaded_at_start = handle.stats().uploaded_bytes;
    let torrent_id = handle.id();
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
        playback_id,
        subtitles,
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
    let live = stats.live.as_ref();
    let peers = live.map(|live| &live.snapshot.peer_stats);

    Ok(DirectTorrentHealth {
        downloaded_bytes,
        selected_size: current.selected_size,
        download_mbps: live.map(|l| l.download_speed.mbps).unwrap_or(0.0),
        live_peers: peers.map(|p| p.live).unwrap_or(0),
        upload_mbps: live.map(|l| l.upload_speed.mbps).unwrap_or(0.0),
        queued_peers: peers.map(|p| p.queued).unwrap_or(0),
        connecting_peers: peers.map(|p| p.connecting).unwrap_or(0),
        dead_peers: peers.map(|p| p.dead).unwrap_or(0),
        not_needed_peers: peers.map(|p| p.not_needed).unwrap_or(0),
        seen_peers: peers.map(|p| p.seen).unwrap_or(0),
        fetched_bytes: live.map(|l| l.snapshot.fetched_bytes).unwrap_or(0),
        state: stats.state.to_string(),
        finished: stats.finished,
        error: stats.error.clone(),
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
    Ok(())
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
        mbps_to_bps, normalized_socks_proxy, proxy_safe_magnet, ratio_target_bytes,
        selected_file_downloaded_bytes, selection_needs_restoring, upload_limit,
    };

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
    fn ratio_target_rounds_up_to_a_quarter() {
        assert_eq!(ratio_target_bytes(10), 3);
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
}
