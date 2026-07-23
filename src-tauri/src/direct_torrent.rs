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
}

struct ActivePlayback {
    playback_id: u64,
    torrent_id: usize,
    handle: Arc<ManagedTorrent>,
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
pub struct DirectTorrentSubtitle {
    file_index: usize,
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

impl DirectTorrentState {
    async fn get(&self, app: &AppHandle) -> Result<&Arc<DirectTorrentEngine>, String> {
        self.engine
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

                // Direct playback is ephemeral (the folder above is wiped on init), so run with no
                // session persistence — and, crucially, DISABLE DHT persistence. librqbit's default
                // persistent DHT asks the `directories` crate for a project dir to store its routing
                // table; on Android that returns nothing and aborts engine startup with
                // "cannot determine project directory for com.rqbit.dht". DHT still runs for peer
                // discovery — it just no longer tries to cache/reload its table from disk.
                let session = Session::new_with_opts(
                    folder,
                    SessionOptions {
                        disable_dht_persistence: true,
                        persistence: None,
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
                Ok(Arc::new(DirectTorrentEngine { session, port }))
            })
            .await
    }
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
    download_limit_mbps: Option<f64>,
    upstream_capacity_mbps: Option<f64>,
) -> Result<DirectTorrentPlayback, String> {
    let magnet = magnet.trim();
    if !magnet.to_ascii_lowercase().starts_with("magnet:?") {
        return Err("Direct playback needs a valid magnet link.".into());
    }

    let engine = state.get(&app).await?;
    let listing = timeout(
        METADATA_TIMEOUT,
        engine.session.add_torrent(
            AddTorrent::from_url(magnet),
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
    let selected = select_file(&files, preferred_filename.as_deref())
        .ok_or_else(|| "This torrent does not contain a supported video file.".to_string())?;
    // Direct sidecars are tiny and selected alongside the video, but nothing waits for their
    // pieces here. The active video HTTP stream retains librqbit's priority; Windows attaches
    // these tracks live once player_embed has returned.
    let subtitle_files = if cfg!(target_os = "android") {
        Vec::new()
    } else {
        select_subtitles(&files, &selected)
    };
    let subtitles = subtitle_files
        .iter()
        .map(|file| DirectTorrentSubtitle {
            file_index: file.index,
            lang: subtitle_language(&file.name).to_string(),
            title: subtitle_title(&selected, file),
        })
        .collect::<Vec<_>>();
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

    let handle = if let Some(handle) = same_torrent {
        handle
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
            .ok_or_else(|| "The torrent did not start.".to_string())?
    };

    // A season pack may already be active from the previous episode. Update its selection to the
    // newly requested video plus its tiny sidecars. Active HTTP streams still receive priority.
    engine
        .session
        .update_only_files(&handle, &selected_indices)
        .await
        .map_err(|e| format!("Could not select the episode inside the torrent: {e:#}"))?;

    let playback_id = state.next_playback_id.fetch_add(1, Ordering::Relaxed) + 1;
    let uploaded_at_start = handle.stats().uploaded_bytes;
    let torrent_id = handle.id();
    *active = Some(ActivePlayback {
        playback_id,
        torrent_id,
        handle,
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
    use super::{mbps_to_bps, ratio_target_bytes, upload_limit};

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
}
