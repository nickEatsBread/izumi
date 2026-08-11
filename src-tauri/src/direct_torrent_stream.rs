use std::{
    io::SeekFrom,
    sync::{Arc, Mutex},
};

use anyhow::Context;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use librqbit::{api::TorrentIdOrHash, Api};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncSeekExt},
    net::TcpListener,
    sync::mpsc::UnboundedSender,
};

use crate::direct_torrent_range::parse_byte_range;

#[derive(Clone, Debug, Default)]
pub(crate) struct StreamDiagnostics(Arc<Mutex<StreamDiagnosticsSnapshot>>);

#[derive(Clone, Debug, Default)]
pub(crate) struct StreamDiagnosticsSnapshot {
    pub(crate) request_count: u64,
    pub(crate) file_index: Option<usize>,
    pub(crate) request_range: Option<String>,
    pub(crate) status: Option<u16>,
    pub(crate) response_bytes: Option<u64>,
}

impl StreamDiagnostics {
    fn record(
        &self,
        file_index: usize,
        request_range: Option<&str>,
        status: StatusCode,
        response_bytes: Option<u64>,
    ) {
        let Ok(mut snapshot) = self.0.lock() else {
            return;
        };
        snapshot.request_count = snapshot.request_count.saturating_add(1);
        snapshot.file_index = Some(file_index);
        snapshot.request_range = request_range.map(str::to_owned);
        snapshot.status = Some(status.as_u16());
        snapshot.response_bytes = response_bytes;
    }

    pub(crate) fn snapshot(&self) -> StreamDiagnosticsSnapshot {
        self.0.lock().map(|value| value.clone()).unwrap_or_default()
    }
}

#[derive(Clone)]
struct StreamServerState {
    api: Api,
    diagnostics: StreamDiagnostics,
    request_started: StreamRequestSender,
}

#[derive(Debug)]
pub(crate) struct StreamRequestStarted {
    pub(crate) torrent_id: usize,
    pub(crate) file_id: usize,
    pub(crate) request_range: Option<String>,
}

pub(crate) type StreamRequestSender = UnboundedSender<StreamRequestStarted>;

fn notify_request_started(
    sender: &StreamRequestSender,
    torrent_id: TorrentIdOrHash,
    file_id: usize,
    request_range: Option<&str>,
) {
    if let TorrentIdOrHash::Id(torrent_id) = torrent_id {
        let _ = sender.send(StreamRequestStarted {
            torrent_id,
            file_id,
            request_range: request_range.map(str::to_owned),
        });
    }
}

fn text_error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, message.into()).into_response()
}

async fn stream_file(
    State(state): State<StreamServerState>,
    Path((torrent_id, file_id)): Path<(TorrentIdOrHash, usize)>,
    method: Method,
    request_headers: HeaderMap,
) -> Response {
    let api = &state.api;
    let mut stream = match api.api_stream(torrent_id, file_id) {
        Ok(stream) => stream,
        Err(error) => return text_error(StatusCode::NOT_FOUND, error.to_string()),
    };
    let total_length = stream.len();
    let request_range = request_headers.get(header::RANGE);
    let request_range_text = request_range
        .and_then(|value| value.to_str().ok())
        .unwrap_or("<none>");
    let range = match request_range
        .map(|value| value.to_str().map_err(|_| ()))
        .transpose()
        .and_then(|value| parse_byte_range(value, total_length))
    {
        Ok(range) => range,
        Err(()) => {
            state.diagnostics.record(
                file_id,
                request_range.and_then(|value| value.to_str().ok()),
                StatusCode::RANGE_NOT_SATISFIABLE,
                None,
            );
            let mut response = text_error(
                StatusCode::RANGE_NOT_SATISFIABLE,
                "The requested byte range is not satisfiable.",
            );
            if let Ok(value) = HeaderValue::from_str(&format!("bytes */{total_length}")) {
                response.headers_mut().insert(header::CONTENT_RANGE, value);
            }
            eprintln!(
                "[direct-torrent stream] torrent={torrent_id:?} file={file_id} method={method} request_range={request_range_text:?} response=416 total={total_length}"
            );
            return response;
        }
    };

    let (status, start, end) = match range {
        Some(range) => (StatusCode::PARTIAL_CONTENT, range.start, range.end),
        None => (StatusCode::OK, 0, total_length),
    };
    if start != 0 {
        if let Err(error) = stream.seek(SeekFrom::Start(start)).await {
            return text_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Could not seek torrent stream: {error}"),
            );
        }
    }
    let response_length = end.saturating_sub(start);
    let stream: Box<dyn AsyncRead + Send + Unpin> = if range.is_some() {
        Box::new(stream.take(response_length))
    } else {
        Box::new(stream)
    };

    // The player's real FileStream is registered now. Tell the torrent owner to drop its
    // synthetic byte-zero cursor before this response begins reading pieces, so a tail/Cues or
    // resume-position request cannot compete with the startup cursor for peer request slots.
    notify_request_started(
        &state.request_started,
        torrent_id,
        file_id,
        request_range.and_then(|value| value.to_str().ok()),
    );

    let mut headers = HeaderMap::new();
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Ok(value) = HeaderValue::from_str(&response_length.to_string()) {
        headers.insert(header::CONTENT_LENGTH, value);
    }
    if let Ok(mime) = api.torrent_file_mime_type(torrent_id, file_id) {
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    }
    if range.is_some() {
        if let Ok(value) = HeaderValue::from_str(&format!(
            "bytes {start}-{}/{total_length}",
            end.saturating_sub(1)
        )) {
            headers.insert(header::CONTENT_RANGE, value);
        }
    }

    state.diagnostics.record(
        file_id,
        request_range.and_then(|value| value.to_str().ok()),
        status,
        Some(response_length),
    );
    eprintln!(
        "[direct-torrent stream] torrent={torrent_id:?} file={file_id} method={method} request_range={request_range_text:?} response={} bytes={start}-{} length={response_length} total={total_length}",
        status.as_u16(),
        end.saturating_sub(1),
    );
    let body = Body::from_stream(tokio_util::io::ReaderStream::with_capacity(
        stream,
        64 * 1024,
    ));
    (status, headers, body).into_response()
}

pub async fn serve(
    api: Api,
    listener: TcpListener,
    diagnostics: StreamDiagnostics,
    request_started: StreamRequestSender,
) -> anyhow::Result<()> {
    let router = Router::new()
        .route("/torrents/{id}/stream/{file_id}", get(stream_file))
        .with_state(StreamServerState {
            api,
            diagnostics,
            request_started,
        });
    axum::serve(listener, router)
        .await
        .context("error running direct torrent streaming server")
}

#[cfg(test)]
mod tests {
    use super::notify_request_started;
    use librqbit::{api::TorrentIdOrHash, dht::Id20};
    use tokio::sync::mpsc::unbounded_channel;

    #[test]
    fn numeric_player_request_notifies_the_active_torrent_owner() {
        let (sender, mut receiver) = unbounded_channel();
        notify_request_started(&sender, TorrentIdOrHash::Id(42), 7, Some("bytes=0-65535"));
        let request = receiver.try_recv().unwrap();
        assert_eq!(request.torrent_id, 42);
        assert_eq!(request.file_id, 7);
        assert_eq!(request.request_range.as_deref(), Some("bytes=0-65535"));
    }

    #[test]
    fn hash_routes_do_not_claim_an_unrelated_numeric_playback() {
        let (sender, mut receiver) = unbounded_channel();
        notify_request_started(&sender, TorrentIdOrHash::Hash(Id20::new([1; 20])), 7, None);
        assert!(receiver.try_recv().is_err());
    }
}
