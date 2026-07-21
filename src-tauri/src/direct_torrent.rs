use std::{collections::HashSet, net::Ipv4Addr, sync::Arc, time::Duration};

use librqbit::{
    http_api::{HttpApi, HttpApiOptions},
    AddTorrent, AddTorrentOptions, AddTorrentResponse, Api, Session,
};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::{net::TcpListener, sync::OnceCell, time::timeout};

use crate::direct_torrent_select::{select_file, TorrentFile};

const METADATA_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct DirectTorrentState {
    engine: OnceCell<Arc<DirectTorrentEngine>>,
}

struct DirectTorrentEngine {
    session: Arc<Session>,
    port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectTorrentPlayback {
    url: String,
    filename: String,
    file_index: usize,
    size: u64,
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
                tokio::fs::create_dir_all(&folder)
                    .await
                    .map_err(|e| format!("Could not create the torrent cache: {e}"))?;

                let session = Session::new(folder)
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

#[tauri::command]
pub async fn torrent_playback_url(
    app: AppHandle,
    state: tauri::State<'_, DirectTorrentState>,
    magnet: String,
    preferred_filename: Option<String>,
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

    let added = engine
        .session
        .add_torrent(
            AddTorrent::from_bytes(listing.torrent_bytes),
            Some(AddTorrentOptions {
                only_files: Some(vec![selected.index]),
                overwrite: true,
                initial_peers: Some(listing.seen_peers),
                ..Default::default()
            }),
        )
        .await
        .map_err(|e| format!("Could not start the torrent: {e:#}"))?;
    let handle = added
        .into_handle()
        .ok_or_else(|| "The torrent did not start.".to_string())?;

    // A season pack may already be active from the previous episode. Update its
    // selection so only the newly requested episode is fetched.
    let only_files = HashSet::from([selected.index]);
    engine
        .session
        .update_only_files(&handle, &only_files)
        .await
        .map_err(|e| format!("Could not select the episode inside the torrent: {e:#}"))?;

    Ok(DirectTorrentPlayback {
        url: format!(
            "http://127.0.0.1:{}/torrents/{}/stream/{}",
            engine.port,
            handle.id(),
            selected.index
        ),
        filename: selected.name,
        file_index: selected.index,
        size: selected.length,
    })
}
