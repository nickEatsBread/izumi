//! Temporary, capability-scoped LAN relay for Google Cast.
//!
//! Cast receivers cannot reach Android/desktop loopback URLs and cannot attach provider headers.
//! This server does only that missing transport work: it forwards Range requests to the existing
//! source (including librqbit's localhost stream), rewrites HLS resource URLs, and normalizes SRT
//! sidecars to WebVTT. It never demuxes, remuxes, or transcodes media.

use std::{
    collections::HashMap,
    net::Ipv4Addr,
    sync::{Arc, Mutex, RwLock},
    time::{Duration, Instant},
};

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::{net::TcpListener, sync::OnceCell};
use url::Url;

const SESSION_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_SESSIONS: usize = 16;
const MAX_PLAYLIST_BYTES: usize = 2 * 1024 * 1024;
const MAX_SUBTITLE_BYTES: usize = 8 * 1024 * 1024;

static RELAY: OnceCell<Arc<CastRelay>> = OnceCell::const_new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastPrepareRequest {
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    manifest: Option<String>,
    #[serde(default)]
    subtitles: Vec<CastSubtitleRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CastSubtitleRequest {
    url: String,
    lang: Option<String>,
    title: Option<String>,
    format: SubtitleFormat,
    #[serde(default)]
    headers: HashMap<String, String>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum SubtitleFormat {
    Vtt,
    Srt,
    Ttml,
}

impl SubtitleFormat {
    fn content_type(self) -> &'static str {
        match self {
            Self::Vtt | Self::Srt => "text/vtt; charset=utf-8",
            Self::Ttml => "application/ttml+xml; charset=utf-8",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastPreparedSource {
    url: String,
    relayed: bool,
    subtitles: Vec<CastPreparedSubtitle>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CastPreparedSubtitle {
    url: String,
    lang: Option<String>,
    title: Option<String>,
    content_type: String,
}

#[derive(Clone)]
enum ResourceKind {
    Media { hls: bool },
    Subtitle(SubtitleFormat),
}

#[derive(Clone)]
struct RelayResource {
    upstream: Url,
    headers: HashMap<String, String>,
    kind: ResourceKind,
}

struct RelaySession {
    public_base: String,
    expires_at: Mutex<Instant>,
    resources: RwLock<HashMap<String, RelayResource>>,
}

impl RelaySession {
    fn touch(&self) -> bool {
        let Ok(mut expires_at) = self.expires_at.lock() else {
            return false;
        };
        let now = Instant::now();
        if *expires_at <= now {
            return false;
        }
        *expires_at = now + SESSION_TTL;
        true
    }

    fn expired(&self) -> bool {
        self.expires_at
            .lock()
            .map(|expires_at| *expires_at <= Instant::now())
            .unwrap_or(true)
    }

    fn local_url(&self, token: &str, resource: &str) -> String {
        format!("{}/cast/{token}/{resource}", self.public_base)
    }
}

#[derive(Default)]
struct RelayState {
    sessions: RwLock<HashMap<String, Arc<RelaySession>>>,
}

struct CastRelay {
    port: u16,
    state: Arc<RelayState>,
}

#[tauri::command]
pub async fn cast_prepare_source(
    request: CastPrepareRequest,
) -> Result<CastPreparedSource, String> {
    let media = parse_http_url(&request.url)?;
    for subtitle in &request.subtitles {
        parse_http_url(&subtitle.url)?;
    }

    let needs_relay = is_loopback(&media)
        || !request.headers.is_empty()
        || !request.subtitles.is_empty()
        || request.manifest.as_deref() == Some("hls")
        || media.path().to_ascii_lowercase().ends_with(".m3u8");
    if !needs_relay {
        return Ok(CastPreparedSource {
            url: media.to_string(),
            relayed: false,
            subtitles: Vec::new(),
        });
    }

    let relay = RELAY.get_or_try_init(start_relay).await?;
    let public_ip = lan_ipv4().await?;
    relay.register(public_ip, media, request)
}

fn parse_http_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Cast received an invalid media URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Cast can only relay HTTP or HTTPS media".into());
    }
    Ok(url)
}

fn is_loopback(url: &Url) -> bool {
    matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
}

async fn start_relay() -> Result<Arc<CastRelay>, String> {
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
        .await
        .map_err(|error| format!("Could not start the Cast relay: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not inspect the Cast relay: {error}"))?
        .port();
    let state = Arc::new(RelayState::default());
    let server_state = Arc::clone(&state);
    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route(
                "/cast/{token}/{resource}",
                get(relay_resource).options(cors_preflight),
            )
            .with_state(server_state);
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("Cast relay stopped: {error:#}");
        }
    });
    Ok(Arc::new(CastRelay { port, state }))
}

impl CastRelay {
    fn register(
        &self,
        public_ip: Ipv4Addr,
        media: Url,
        request: CastPrepareRequest,
    ) -> Result<CastPreparedSource, String> {
        let token = random_token()?;
        let public_base = format!("http://{public_ip}:{}", self.port);
        let media_kind = ResourceKind::Media {
            hls: request.manifest.as_deref() == Some("hls")
                || media.path().to_ascii_lowercase().ends_with(".m3u8"),
        };
        let mut resources = HashMap::from([(
            "media".to_string(),
            RelayResource {
                upstream: media,
                headers: request.headers.clone(),
                kind: media_kind,
            },
        )]);
        let mut prepared_subtitles = Vec::new();
        for (index, subtitle) in request.subtitles.into_iter().enumerate() {
            let resource_id = format!("subtitle-{index}");
            let upstream = parse_http_url(&subtitle.url)?;
            let mut headers = request.headers.clone();
            headers.extend(subtitle.headers.clone());
            resources.insert(
                resource_id.clone(),
                RelayResource {
                    upstream,
                    headers,
                    kind: ResourceKind::Subtitle(subtitle.format),
                },
            );
            prepared_subtitles.push((resource_id, subtitle));
        }

        let session = Arc::new(RelaySession {
            public_base,
            expires_at: Mutex::new(Instant::now() + SESSION_TTL),
            resources: RwLock::new(resources),
        });
        {
            let mut sessions = self
                .state
                .sessions
                .write()
                .map_err(|_| "Cast relay state is unavailable".to_string())?;
            sessions.retain(|_, session| !session.expired());
            if sessions.len() >= MAX_SESSIONS {
                if let Some(oldest) = sessions.keys().next().cloned() {
                    sessions.remove(&oldest);
                }
            }
            sessions.insert(token.clone(), Arc::clone(&session));
        }

        Ok(CastPreparedSource {
            url: session.local_url(&token, "media"),
            relayed: true,
            subtitles: prepared_subtitles
                .into_iter()
                .map(|(resource, subtitle)| CastPreparedSubtitle {
                    url: session.local_url(&token, &resource),
                    lang: subtitle.lang,
                    title: subtitle.title,
                    content_type: subtitle.format.content_type().to_string(),
                })
                .collect(),
        })
    }
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("Could not secure the Cast relay URL: {error}"))?;
    Ok(data_encoding::HEXLOWER.encode(&bytes))
}

async fn lan_ipv4() -> Result<Ipv4Addr, String> {
    tokio::task::spawn_blocking(select_lan_ipv4)
        .await
        .map_err(|error| format!("Could not inspect the local network: {error}"))?
}

fn select_lan_ipv4() -> Result<Ipv4Addr, String> {
    use netdev::prelude::InterfaceType;

    let mut candidates = Vec::new();
    for interface in netdev::get_interfaces() {
        if !interface.is_up()
            || interface.is_loopback()
            || interface.is_tun()
            || matches!(
                interface.if_type,
                InterfaceType::Tunnel | InterfaceType::Ppp
            )
        {
            continue;
        }
        let physical = matches!(
            interface.if_type,
            InterfaceType::Wireless80211
                | InterfaceType::Ethernet
                | InterfaceType::FastEthernetT
                | InterfaceType::FastEthernetFx
                | InterfaceType::GigabitEthernet
        );
        for network in interface.ipv4 {
            let address = network.addr();
            if address.is_loopback() || address.is_link_local() || address.is_unspecified() {
                continue;
            }
            candidates.push((physical, address.is_private(), interface.default, address));
        }
    }
    candidates.sort_by_key(|(physical, private, default, _)| (*physical, *private, *default));
    candidates
        .pop()
        .map(|(_, _, _, address)| address)
        .ok_or_else(|| {
            "Cast needs this device and the receiver on the same Wi-Fi or Ethernet network".into()
        })
}

async fn cors_preflight() -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    add_cors(response.headers_mut());
    response
}

async fn relay_resource(
    State(state): State<Arc<RelayState>>,
    Path((token, resource_id)): Path<(String, String)>,
    method: Method,
    request_headers: HeaderMap,
) -> Response {
    let session = state
        .sessions
        .read()
        .ok()
        .and_then(|sessions| sessions.get(&token).cloned());
    let Some(session) = session.filter(|session| session.touch()) else {
        return relay_error(StatusCode::NOT_FOUND, "Cast relay link expired");
    };
    let resource = session
        .resources
        .read()
        .ok()
        .and_then(|resources| resources.get(&resource_id).cloned());
    let Some(resource) = resource else {
        return relay_error(StatusCode::NOT_FOUND, "Unknown Cast relay resource");
    };

    match fetch_resource(&token, &session, resource, method, request_headers).await {
        Ok(response) => response,
        Err(error) => relay_error(StatusCode::BAD_GATEWAY, &error),
    }
}

async fn fetch_resource(
    token: &str,
    session: &Arc<RelaySession>,
    resource: RelayResource,
    method: Method,
    request_headers: HeaderMap,
) -> Result<Response, String> {
    let upstream_method = reqwest::Method::from_bytes(method.as_str().as_bytes())
        .map_err(|error| error.to_string())?;
    let mut request = crate::ext_http_client()
        .request(upstream_method, resource.upstream.clone())
        .header(reqwest::header::ACCEPT_ENCODING, "identity");
    for (name, value) in &resource.headers {
        let Ok(name) = reqwest::header::HeaderName::from_bytes(name.as_bytes()) else {
            continue;
        };
        let Ok(value) = reqwest::header::HeaderValue::from_str(value) else {
            continue;
        };
        request = request.header(name, value);
    }
    if matches!(resource.kind, ResourceKind::Media { .. }) {
        for name in [header::RANGE, header::IF_RANGE] {
            if let Some(value) = request_headers.get(&name) {
                request = request.header(name, value);
            }
        }
    }

    let upstream = request.send().await.map_err(|error| error.to_string())?;
    let status = upstream.status();
    let final_url = upstream.url().clone();
    let upstream_headers = upstream.headers().clone();
    let upstream_type = upstream_headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    if method == Method::HEAD {
        return Ok(build_response(
            status,
            &upstream_headers,
            Body::empty(),
            None,
        ));
    }

    match resource.kind {
        ResourceKind::Subtitle(format) => {
            let bytes = read_limited(upstream, MAX_SUBTITLE_BYTES).await?;
            let body = match format {
                SubtitleFormat::Srt => srt_to_webvtt(&bytes)?.into_bytes(),
                SubtitleFormat::Vtt | SubtitleFormat::Ttml => bytes,
            };
            Ok(build_response(
                status,
                &HeaderMap::new(),
                Body::from(body.clone()),
                Some((format.content_type(), body.len())),
            ))
        }
        ResourceKind::Media { hls } => {
            let is_playlist = hls
                || final_url.path().to_ascii_lowercase().ends_with(".m3u8")
                || upstream_type.to_ascii_lowercase().contains("mpegurl");
            if is_playlist {
                let bytes = read_limited(upstream, MAX_PLAYLIST_BYTES).await?;
                let text = String::from_utf8(bytes)
                    .map_err(|_| "Upstream HLS playlist is not UTF-8".to_string())?;
                let rewritten =
                    rewrite_playlist(token, session, &final_url, &resource.headers, &text)?;
                let length = rewritten.len();
                return Ok(build_response(
                    status,
                    &HeaderMap::new(),
                    Body::from(rewritten),
                    Some(("application/vnd.apple.mpegurl", length)),
                ));
            }
            let body = Body::from_stream(upstream.bytes_stream());
            Ok(build_response(status, &upstream_headers, body, None))
        }
    }
}

async fn read_limited(response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("Cast relay resource exceeds its safe size limit".into());
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        if body.len().saturating_add(chunk.len()) > limit {
            return Err("Cast relay resource exceeds its safe size limit".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn rewrite_playlist(
    token: &str,
    session: &Arc<RelaySession>,
    base: &Url,
    headers: &HashMap<String, String>,
    text: &str,
) -> Result<String, String> {
    let mut output = String::with_capacity(text.len() + 1024);
    for line in text.split_inclusive('\n') {
        let ending = if line.ends_with("\r\n") {
            "\r\n"
        } else if line.ends_with('\n') {
            "\n"
        } else {
            ""
        };
        let content = line.trim_end_matches(['\r', '\n']);
        let rewritten = if content.starts_with('#') {
            rewrite_uri_attributes(content, |uri| {
                register_hls_resource(token, session, base, headers, uri)
            })?
        } else if content.trim().is_empty() {
            content.to_string()
        } else {
            register_hls_resource(token, session, base, headers, content.trim())?
        };
        output.push_str(&rewritten);
        output.push_str(ending);
    }
    Ok(output)
}

fn register_hls_resource(
    token: &str,
    session: &Arc<RelaySession>,
    base: &Url,
    headers: &HashMap<String, String>,
    value: &str,
) -> Result<String, String> {
    let resolved = base
        .join(value)
        .map_err(|error| format!("Invalid HLS resource URL {value:?}: {error}"))?;
    let resource_id = blake3::hash(resolved.as_str().as_bytes())
        .to_hex()
        .to_string();
    let hls = resolved.path().to_ascii_lowercase().ends_with(".m3u8");
    session
        .resources
        .write()
        .map_err(|_| "Cast relay state is unavailable".to_string())?
        .insert(
            resource_id.clone(),
            RelayResource {
                upstream: resolved,
                headers: headers.clone(),
                kind: ResourceKind::Media { hls },
            },
        );
    Ok(session.local_url(token, &resource_id))
}

fn rewrite_uri_attributes(
    line: &str,
    mut register: impl FnMut(&str) -> Result<String, String>,
) -> Result<String, String> {
    let mut output = String::with_capacity(line.len());
    let mut remaining = line;
    while let Some(start) = remaining.find("URI=\"") {
        let value_start = start + 5;
        let Some(relative_end) = remaining[value_start..].find('"') else {
            break;
        };
        let value_end = value_start + relative_end;
        output.push_str(&remaining[..value_start]);
        output.push_str(&register(&remaining[value_start..value_end])?);
        remaining = &remaining[value_end..];
    }
    output.push_str(remaining);
    Ok(output)
}

fn srt_to_webvtt(bytes: &[u8]) -> Result<String, String> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "Cast subtitle is not UTF-8".to_string())?
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let mut output = String::from("WEBVTT\n\n");
    for line in text.lines() {
        if line.contains("-->") {
            output.push_str(&line.replace(',', "."));
        } else {
            output.push_str(line);
        }
        output.push('\n');
    }
    Ok(output)
}

fn build_response(
    status: StatusCode,
    upstream_headers: &HeaderMap,
    body: Body,
    override_type_and_length: Option<(&str, usize)>,
) -> Response {
    let mut response = Response::builder()
        .status(status)
        .body(body)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    if let Some((content_type, length)) = override_type_and_length {
        if let Ok(value) = HeaderValue::from_str(content_type) {
            response.headers_mut().insert(header::CONTENT_TYPE, value);
        }
        if let Ok(value) = HeaderValue::from_str(&length.to_string()) {
            response.headers_mut().insert(header::CONTENT_LENGTH, value);
        }
    } else {
        for name in [
            header::CONTENT_TYPE,
            header::CONTENT_LENGTH,
            header::CONTENT_RANGE,
            header::ACCEPT_RANGES,
            header::ETAG,
            header::LAST_MODIFIED,
            header::CACHE_CONTROL,
        ] {
            if let Some(value) = upstream_headers.get(&name) {
                response.headers_mut().insert(name, value.clone());
            }
        }
        for name in ["transfermode.dlna.org", "contentfeatures.dlna.org"] {
            let name = HeaderName::from_static(name);
            if let Some(value) = upstream_headers.get(&name) {
                response.headers_mut().insert(name, value.clone());
            }
        }
    }
    add_cors(response.headers_mut());
    response
}

fn add_cors(headers: &mut HeaderMap) {
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Range, If-Range, Content-Type, Accept-Encoding"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Length, Content-Range, Accept-Ranges"),
    );
}

fn relay_error(status: StatusCode, message: &str) -> Response {
    let mut response = (status, message.to_string()).into_response();
    add_cors(response.headers_mut());
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_srt_timestamps_to_webvtt() {
        let converted = srt_to_webvtt(b"1\r\n00:00:01,250 --> 00:00:03,500\r\nHello\r\n").unwrap();
        assert_eq!(
            converted,
            "WEBVTT\n\n1\n00:00:01.250 --> 00:00:03.500\nHello\n"
        );
    }

    #[test]
    fn rewrites_hls_uri_attributes() {
        let rewritten = rewrite_uri_attributes(
            r#"#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1234"#,
            |value| Ok(format!("local/{value}")),
        )
        .unwrap();
        assert_eq!(
            rewritten,
            r#"#EXT-X-KEY:METHOD=AES-128,URI="local/key.bin",IV=0x1234"#
        );
    }

    #[test]
    fn detects_loopback_sources_that_need_the_relay() {
        assert!(is_loopback(
            &Url::parse("http://127.0.0.1:9000/video").unwrap()
        ));
        assert!(!is_loopback(
            &Url::parse("https://cdn.example/video.mp4").unwrap()
        ));
    }
}
