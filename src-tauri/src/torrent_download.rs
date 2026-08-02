//! Direct P2P downloads: fetch one episode from peers straight into the user's download folder.
//!
//! This is the offline-download counterpart of `direct_torrent.rs`. It deliberately runs its own
//! librqbit session rather than sharing playback's:
//!   * playback keeps exactly ONE torrent alive and deletes the previous one whenever a new episode
//!     starts — a download sharing that session would be evicted mid-transfer (and vice versa);
//!   * playback narrows `only_files` to the episode being watched, which would unselect a
//!     concurrently downloading file;
//!   * playback's output folder is an ephemeral cache that is wiped on the next launch, while a
//!     download is a permanent file;
//!   * the buffer governor retunes session-wide rate limits from the player's buffer level, which
//!     has nothing to do with a background download.
//!
//! It emits the same `download-progress` / `download-done` / `download-paused` events as the HTTP
//! path in `download.rs`, so the queue in the web app does not care which engine ran the job.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use librqbit::{
    api::TorrentIdOrHash, AddTorrent, AddTorrentOptions, AddTorrentResponse, Session, SessionOptions,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    sync::{Mutex, OnceCell},
    time::{sleep, timeout, Instant},
};

use crate::direct_torrent::{
    mbps_to_bps, normalized_bind_interface, normalized_socks_proxy, proxy_safe_magnet, upload_limit,
};
use crate::direct_torrent_select::{select_file, TorrentFile};
use crate::download::sanitize;

const METADATA_TIMEOUT: Duration = Duration::from_secs(60);
const POLL_INTERVAL: Duration = Duration::from_millis(400);
const EMIT_INTERVAL: Duration = Duration::from_millis(300);
/// A torrent with no seeders never errors — it just sits there. Give up rather than leave a job
/// "downloading" forever with a spinner and no explanation.
const STALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
pub struct TorrentDownloads {
    engine: OnceCell<Arc<Engine>>,
    jobs: Mutex<HashMap<String, Job>>,
}

struct Engine {
    session: Arc<Session>,
    socks_proxy_url: Option<String>,
    bind_interface: Option<String>,
}

#[derive(Clone, Default)]
struct Job {
    stop: Arc<AtomicBool>,
    /// Set by a cancel (as opposed to a pause): discard the partially downloaded data too.
    discard: Arc<AtomicBool>,
}

enum Outcome {
    Done(u64),
    Stopped(u64),
}

/// Keep the release's real container instead of the guessed `.mkv` the web app supplies for a
/// torrent (whose file list it has not seen yet).
fn output_name(requested: &str, actual: &str) -> String {
    let actual_ext = actual
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(actual)
        .rsplit_once('.')
        .map(|(_, ext)| ext)
        .filter(|ext| !ext.is_empty() && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()));
    match actual_ext {
        Some(ext) => {
            let stem = requested.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(requested);
            let stem = if stem.is_empty() { requested } else { stem };
            format!("{stem}.{ext}")
        }
        None => requested.to_string(),
    }
}

/// Partial data lives beside the finished file so completing a download is a same-volume rename
/// rather than a multi-gigabyte copy out of a cache directory on another disk.
fn staging_dir(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!(".part-{}", sanitize(id)))
}

impl TorrentDownloads {
    async fn engine(
        &self,
        app: &AppHandle,
        socks_proxy_url: Option<String>,
        bind_interface: Option<String>,
    ) -> Result<&Arc<Engine>, String> {
        let socks_proxy_url = normalized_socks_proxy(socks_proxy_url)?;
        let bind_interface = normalized_bind_interface(bind_interface);
        let configured = socks_proxy_url.clone();
        let configured_bind = bind_interface.clone();
        let engine = self
            .engine
            .get_or_try_init(|| async {
                // Same fail-closed rule as playback: a configured VPN binding with its adapter
                // absent must block the session from starting at all.
                if let Some(name) = &configured_bind {
                    crate::net_interfaces::ensure_bound_iface_ready(name).await?;
                }
                // Every job overrides `output_folder`, so this root only ever holds librqbit's own
                // bookkeeping — no episode data.
                let folder = app
                    .path()
                    .app_cache_dir()
                    .map_err(|e| format!("Could not locate Izumi's cache folder: {e}"))?
                    .join("torrent-downloads");
                tokio::fs::create_dir_all(&folder)
                    .await
                    .map_err(|e| format!("Could not create the download work folder: {e}"))?;
                let session = Session::new_with_opts(
                    folder,
                    SessionOptions {
                        // Same privacy kill switch as playback: with a SOCKS5 proxy configured,
                        // UDP DHT would bypass it entirely, so it is turned off rather than leaked.
                        disable_dht: configured.is_some(),
                        // Playback owns the persisted DHT routing file; a second session must not
                        // write the same one.
                        disable_dht_persistence: true,
                        persistence: None,
                        socks_proxy_url: configured.clone(),
                        ..Default::default()
                    },
                )
                .await
                .map_err(|e| format!("Could not start the torrent downloader: {e:#}"))?;
                // Register with the shared kill switch so a VPN drop pauses in-flight downloads
                // exactly like playback. No-op without a binding.
                app.state::<crate::net_interfaces::VpnGuard>()
                    .attach(app, configured_bind.clone(), &session)
                    .await?;
                Ok::<_, String>(Arc::new(Engine {
                    session,
                    socks_proxy_url: configured.clone(),
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

/// Download one episode out of `magnet` into `dir`. Resolves when the file is fully written, or
/// when the job is paused/cancelled. Progress arrives via `download-progress` events.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn torrent_download_start(
    app: AppHandle,
    state: tauri::State<'_, TorrentDownloads>,
    id: String,
    magnet: String,
    dir: String,
    filename: String,
    preferred_filename: Option<String>,
    episode: Option<u32>,
    absolute_episode: Option<u32>,
    season: Option<u32>,
    download_limit_mbps: Option<f64>,
    upstream_capacity_mbps: Option<f64>,
    socks_proxy_url: Option<String>,
    bind_interface: Option<String>,
) -> Result<String, String> {
    // Same guard as the HTTP path: a re-pump must never run two jobs for one id, which would have
    // two torrents writing the same staging file.
    let job = Job::default();
    {
        let mut jobs = state.jobs.lock().await;
        if jobs.contains_key(&id) {
            return Ok("already-running".into());
        }
        jobs.insert(id.clone(), job.clone());
    }
    let out = run(
        &app,
        state.inner(),
        &job,
        &id,
        &magnet,
        &dir,
        &filename,
        preferred_filename.as_deref(),
        episode,
        absolute_episode,
        season,
        download_limit_mbps,
        upstream_capacity_mbps,
        socks_proxy_url,
        bind_interface,
    )
    .await;
    state.jobs.lock().await.remove(&id);
    out
}

#[allow(clippy::too_many_arguments)]
async fn run(
    app: &AppHandle,
    state: &TorrentDownloads,
    job: &Job,
    id: &str,
    magnet: &str,
    dir: &str,
    filename: &str,
    preferred_filename: Option<&str>,
    episode: Option<u32>,
    absolute_episode: Option<u32>,
    season: Option<u32>,
    download_limit_mbps: Option<f64>,
    upstream_capacity_mbps: Option<f64>,
    socks_proxy_url: Option<String>,
    bind_interface: Option<String>,
) -> Result<String, String> {
    let magnet = magnet.trim();
    if !magnet.to_ascii_lowercase().starts_with("magnet:?") {
        return Err("This source has no magnet link to download from.".into());
    }
    let proxy = normalized_socks_proxy(socks_proxy_url.clone())?;
    let magnet = proxy_safe_magnet(magnet, proxy.is_some())?;
    let engine = state.engine(app, socks_proxy_url, bind_interface).await?;
    // Kill switch engaged: fail the job now with the real reason rather than sitting on a paused
    // session until the metadata timeout blames the seeders.
    app.state::<crate::net_interfaces::VpnGuard>().ensure_up()?;

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
        preferred_filename,
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

    engine
        .session
        .ratelimits
        .set_upload_bps(Some(upload_limit(upstream_capacity_mbps)));
    engine
        .session
        .ratelimits
        .set_download_bps(download_limit_mbps.and_then(mbps_to_bps));

    let dir = PathBuf::from(dir);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Could not create the download folder: {e}"))?;
    let staging = staging_dir(&dir, id);

    // `overwrite` is what makes resume work: a paused job left its pieces in the staging folder,
    // and librqbit re-checksums them on the way back in instead of starting over.
    let added = engine
        .session
        .add_torrent(
            AddTorrent::from_bytes(listing.torrent_bytes),
            Some(AddTorrentOptions {
                only_files: Some(vec![selected.index]),
                overwrite: true,
                output_folder: Some(staging.to_string_lossy().into_owned()),
                initial_peers: Some(listing.seen_peers),
                ..Default::default()
            }),
        )
        .await
        .map_err(|e| format!("Could not start the torrent: {e:#}"))?;
    let handle = added
        .into_handle()
        .ok_or_else(|| "The torrent did not start.".to_string())?;
    let torrent_id = handle.id();

    let result = async {
        timeout(METADATA_TIMEOUT, handle.wait_until_initialized())
            .await
            .map_err(|_| "Timed out while preparing the torrent download.".to_string())?
            .map_err(|e| format!("Could not prepare the torrent download: {e:#}"))?;
        let relative = handle
            .with_metadata(|m| {
                m.file_infos
                    .get(selected.index)
                    .map(|file| file.relative_filename.clone())
            })
            .map_err(|e| format!("Could not read the torrent file list: {e:#}"))?
            .ok_or_else(|| "The selected episode is missing from the torrent.".to_string())?;

        let total = selected.length;
        let mut last_emit = Instant::now();
        let mut last_bytes = 0_u64;
        let mut best_bytes = 0_u64;
        let mut last_progress_at = Instant::now();
        let outcome = loop {
            if job.stop.load(Ordering::Relaxed) {
                break Outcome::Stopped(best_bytes);
            }
            let stats = handle.stats();
            if let Some(error) = stats.error.clone() {
                return Err(error);
            }
            let received = stats
                .file_progress
                .get(selected.index)
                .copied()
                .unwrap_or(0)
                .min(total);
            if received > best_bytes {
                best_bytes = received;
                last_progress_at = Instant::now();
            }
            if last_emit.elapsed() >= EMIT_INTERVAL {
                let seconds = last_emit.elapsed().as_secs_f64().max(0.001);
                let speed = (received.saturating_sub(last_bytes) as f64 / seconds) as u64;
                let _ = app.emit("download-progress", (id, received, total, speed));
                last_emit = Instant::now();
                last_bytes = received;
            }
            if total > 0 && received >= total {
                break Outcome::Done(received);
            }
            if app.state::<crate::net_interfaces::VpnGuard>().is_down() {
                // The VPN kill switch paused this torrent. It resumes by itself when the adapter
                // returns — don't let the no-seeders stall timeout cancel the job meanwhile.
                last_progress_at = Instant::now();
            }
            if last_progress_at.elapsed() >= STALL_TIMEOUT {
                return Err(
                    "This torrent stopped making progress — it may have no seeders left. Try another source."
                        .into(),
                );
            }
            sleep(POLL_INTERVAL).await;
        };
        Ok((outcome, relative))
    }
    .await;

    let (outcome, relative) = match result {
        Ok(value) => value,
        Err(error) => {
            // A failed job keeps its partial data so a retry resumes; only an explicit cancel
            // throws it away.
            let _ = engine
                .session
                .delete(TorrentIdOrHash::Id(torrent_id), false)
                .await;
            return Err(error);
        }
    };

    // Stop the torrent before touching its files. Downloads are not a seeding library: the episode
    // is the user's file from here, and leaving a torrent attached to it would keep uploading from
    // a path the app no longer manages.
    engine
        .session
        .delete(TorrentIdOrHash::Id(torrent_id), false)
        .await
        .map_err(|e| format!("Could not close the torrent: {e:#}"))?;

    let bytes = match outcome {
        Outcome::Done(bytes) => bytes,
        Outcome::Stopped(received) => {
            if job.discard.load(Ordering::Relaxed) {
                let _ = tokio::fs::remove_dir_all(&staging).await;
                return Ok("cancelled".into());
            }
            let _ = app.emit("download-paused", (id, received));
            return Ok("paused".into());
        }
    };

    let name = sanitize(&output_name(filename, &selected.name));
    let final_path = dir.join(&name);
    let source = staging.join(&relative);
    tokio::fs::rename(&source, &final_path)
        .await
        .map_err(|e| format!("Could not move the finished episode into place: {e}"))?;
    let _ = tokio::fs::remove_dir_all(&staging).await;

    let path = final_path.to_string_lossy().into_owned();
    let _ = app.emit("download-done", (id, path.clone(), bytes));
    Ok(path)
}

/// Stop an in-flight torrent download. `delete_files=false` (pause) keeps the partial data so a
/// later `torrent_download_start` resumes from it; `true` (cancel) discards it.
#[tauri::command]
pub async fn torrent_download_cancel(
    state: tauri::State<'_, TorrentDownloads>,
    id: String,
    delete_files: bool,
    dir: String,
) -> Result<(), String> {
    let job = state.jobs.lock().await.get(&id).cloned();
    match job {
        Some(job) => {
            job.discard.store(delete_files, Ordering::Relaxed);
            job.stop.store(true, Ordering::Relaxed);
        }
        // Nothing running (already finished, or a leftover from a previous session). A cancel still
        // has to clear whatever partial data is on disk.
        None if delete_files && !dir.is_empty() => {
            let _ = tokio::fs::remove_dir_all(staging_dir(Path::new(&dir), &id)).await;
        }
        None => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{output_name, staging_dir};
    use std::path::Path;

    #[test]
    fn keeps_the_releases_real_container() {
        assert_eq!(output_name("Show - E02.mkv", "Show.E02.1080p.mp4"), "Show - E02.mp4");
        assert_eq!(output_name("Show - E02.mkv", "dir/Show.E02.mkv"), "Show - E02.mkv");
    }

    #[test]
    fn falls_back_to_the_requested_name_without_a_usable_extension() {
        assert_eq!(output_name("Show - E02.mkv", "Show E02 no extension"), "Show - E02.mkv");
        assert_eq!(output_name("Show - E02.mkv", "Show.E02.0123456789"), "Show - E02.mkv");
    }

    #[test]
    fn partial_data_stays_next_to_the_finished_file() {
        // Same volume as the destination, so completing is a rename and not a multi-GB copy.
        let staging = staging_dir(Path::new("/media/anime"), "42:7");
        assert_eq!(staging.parent(), Some(Path::new("/media/anime")));
        // The queue id contains a colon, which is not a legal Windows path character.
        assert!(!staging.file_name().unwrap().to_string_lossy().contains(':'));
    }
}
