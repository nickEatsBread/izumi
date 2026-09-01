//! Temporary, capability-scoped LAN bridge for cast-source edge cases.
//!
//! Ordinary Izumi receiver sessions get the original source URL and the TV streams it itself. This
//! server is only used when a receiver cannot reach Android/desktop loopback URLs, cannot attach
//! provider headers, or needs a subtitle-format compatibility conversion. It forwards Range
//! requests to the existing source (including librqbit's localhost stream), rewrites HLS resource
//! URLs when necessary, and normalizes subtitle sidecars. It never demuxes, remuxes, or transcodes
//! media.

use std::{
    collections::HashMap,
    net::Ipv4Addr,
    sync::{Arc, Mutex, RwLock},
    time::{Duration, Instant},
};

use axum::{
    body::Body,
    extract::{Path, Query, State},
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
const MAX_COMPANION_SNAPSHOT_BYTES: usize = 512 * 1024;
const COMPANION_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);

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
    #[serde(default)]
    force_relay: bool,
    content_type: Option<String>,
    #[serde(default)]
    subtitle_delivery: SubtitleDelivery,
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
    Ass,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SubtitleDelivery {
    #[default]
    Web,
    SamsungDlna,
    TizenReceiver,
}

impl SubtitleDelivery {
    fn content_type(self, source: SubtitleFormat) -> &'static str {
        match self {
            Self::SamsungDlna => "text/srt; charset=utf-8",
            Self::Web => match source {
                SubtitleFormat::Vtt | SubtitleFormat::Srt => "text/vtt; charset=utf-8",
                SubtitleFormat::Ttml => "application/ttml+xml; charset=utf-8",
                SubtitleFormat::Ass => "text/x-ssa; charset=utf-8",
            },
            Self::TizenReceiver => match source {
                SubtitleFormat::Vtt => "text/vtt; charset=utf-8",
                SubtitleFormat::Srt => "application/x-subrip; charset=utf-8",
                SubtitleFormat::Ttml => "application/ttml+xml; charset=utf-8",
                SubtitleFormat::Ass => "text/x-ssa; charset=utf-8",
            },
        }
    }

    fn extension(self, source: SubtitleFormat) -> &'static str {
        match self {
            Self::SamsungDlna => "srt",
            Self::Web => match source {
                SubtitleFormat::Vtt | SubtitleFormat::Srt => "vtt",
                SubtitleFormat::Ttml => "ttml",
                SubtitleFormat::Ass => "ass",
            },
            Self::TizenReceiver => match source {
                SubtitleFormat::Vtt => "vtt",
                SubtitleFormat::Srt => "srt",
                SubtitleFormat::Ttml => "ttml",
                SubtitleFormat::Ass => "ass",
            },
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
pub struct CompanionBridge {
    url: String,
    token: String,
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
    Media {
        hls: bool,
        content_type: Option<String>,
        caption_urls: Vec<String>,
    },
    Subtitle {
        source: SubtitleFormat,
        delivery: SubtitleDelivery,
    },
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelayQuery {
    caption: Option<usize>,
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

struct CompanionSnapshot {
    payload: String,
    bearer: String,
    expires_at: Mutex<Instant>,
}

impl CompanionSnapshot {
    fn touch(&self) -> bool {
        let Ok(mut expires_at) = self.expires_at.lock() else {
            return false;
        };
        if *expires_at <= Instant::now() {
            return false;
        }
        *expires_at = Instant::now() + COMPANION_TTL;
        true
    }
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
    companion: RwLock<HashMap<String, Arc<CompanionSnapshot>>>,
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
    let (relay_media, relay_subtitles) = relay_plan(&request, &media)?;
    if !relay_media && !relay_subtitles.iter().any(|relay| *relay) {
        let delivery = request.subtitle_delivery;
        return Ok(CastPreparedSource {
            url: media.to_string(),
            relayed: false,
            subtitles: request
                .subtitles
                .into_iter()
                .map(|subtitle| CastPreparedSubtitle {
                    url: subtitle.url,
                    lang: subtitle.lang,
                    title: subtitle.title,
                    content_type: delivery.content_type(subtitle.format).to_string(),
                })
                .collect(),
        });
    }

    let relay = RELAY.get_or_try_init(start_relay).await?;
    let public_ip = lan_ipv4().await?;
    relay.register(public_ip, media, request, relay_media, relay_subtitles)
}

#[tauri::command]
pub async fn companion_publish_snapshot(snapshot: String) -> Result<CompanionBridge, String> {
    if snapshot.len() > MAX_COMPANION_SNAPSHOT_BYTES {
        return Err("The companion snapshot is too large".into());
    }
    let parsed: serde_json::Value = serde_json::from_str(&snapshot)
        .map_err(|_| "The companion snapshot is not valid JSON".to_string())?;
    if parsed.get("app").and_then(serde_json::Value::as_str) != Some("izumi")
        || parsed.get("kind").and_then(serde_json::Value::as_str) != Some("companion-home")
        || parsed.get("version").and_then(serde_json::Value::as_u64) != Some(1)
    {
        return Err("The companion snapshot has an unsupported format".into());
    }
    let relay = RELAY.get_or_try_init(start_relay).await?;
    relay.register_companion(lan_ipv4().await?, snapshot)
}

fn parse_http_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Cast received an invalid media URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Cast only supports HTTP or HTTPS media".into());
    }
    Ok(url)
}

fn is_loopback(url: &Url) -> bool {
    matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
}

fn safe_url_suffix(url: &Url) -> String {
    let filename = url
        .path_segments()
        .and_then(Iterator::last)
        .unwrap_or_default();
    let Some((_, extension)) = filename.rsplit_once('.') else {
        return String::new();
    };
    let extension = extension.to_ascii_lowercase();
    if extension.is_empty()
        || extension.len() > 8
        || !extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return String::new();
    }
    format!(".{extension}")
}

fn media_resource_id(request: &CastPrepareRequest, media: &Url) -> String {
    let suffix = match request.manifest.as_deref() {
        Some("hls") => ".m3u8",
        Some("dash") => ".mpd",
        _ => match request
            .content_type
            .as_deref()
            .and_then(valid_content_type)
            .as_deref()
        {
            Some("application/vnd.apple.mpegurl") | Some("application/x-mpegurl") => ".m3u8",
            Some("application/dash+xml") => ".mpd",
            Some("video/mp4") => ".mp4",
            Some("video/x-matroska") | Some("video/x-mkv") => ".mkv",
            Some("video/webm") => ".webm",
            Some("video/mp2t") => ".ts",
            _ => return format!("media{}", safe_url_suffix(media)),
        },
    };
    format!("media{suffix}")
}

fn relay_plan(request: &CastPrepareRequest, media: &Url) -> Result<(bool, Vec<bool>), String> {
    let izumi_receiver = matches!(request.subtitle_delivery, SubtitleDelivery::TizenReceiver);
    let relay_subtitles = request
        .subtitles
        .iter()
        .map(|subtitle| {
            let url = parse_http_url(&subtitle.url)?;
            // Izumi's TV client can fetch ordinary remote sidecars itself. A local-only URL or
            // provider-specific request headers are the only reasons to bridge one through the
            // source device. Other receiver types retain their format-conversion path.
            Ok(!izumi_receiver
                || is_loopback(&url)
                || !request.headers.is_empty()
                || !subtitle.headers.is_empty())
        })
        .collect::<Result<Vec<_>, String>>()?;
    let hls = request.manifest.as_deref() == Some("hls")
        || media.path().to_ascii_lowercase().ends_with(".m3u8");
    let relay_media = request.force_relay
        || is_loopback(media)
        || !request.headers.is_empty()
        // AVPlay resolves ordinary remote HLS resources on the TV. Web/DLNA compatibility still
        // uses the established playlist/subtitle bridge behavior.
        || (!izumi_receiver && (!request.subtitles.is_empty() || hls));
    Ok((relay_media, relay_subtitles))
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
            .route(
                "/companion/{token}",
                get(companion_snapshot).options(cors_preflight),
            )
            .with_state(server_state);
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("Cast relay stopped: {error:#}");
        }
    });
    Ok(Arc::new(CastRelay { port, state }))
}

impl CastRelay {
    fn register_companion(
        &self,
        public_ip: Ipv4Addr,
        payload: String,
    ) -> Result<CompanionBridge, String> {
        let token = random_token()?;
        let bearer = random_token()?;
        let entry = Arc::new(CompanionSnapshot {
            payload,
            bearer: bearer.clone(),
            expires_at: Mutex::new(Instant::now() + COMPANION_TTL),
        });
        let mut snapshots = self
            .state
            .companion
            .write()
            .map_err(|_| "Companion bridge state is unavailable".to_string())?;
        snapshots.retain(|_, snapshot| snapshot.touch());
        if snapshots.len() >= MAX_SESSIONS {
            if let Some(oldest) = snapshots.keys().next().cloned() {
                snapshots.remove(&oldest);
            }
        }
        snapshots.insert(token.clone(), entry);
        Ok(CompanionBridge {
            url: format!("http://{public_ip}:{}/companion/{token}", self.port),
            token: bearer,
        })
    }

    fn register(
        &self,
        public_ip: Ipv4Addr,
        media: Url,
        request: CastPrepareRequest,
        relay_media: bool,
        relay_subtitles: Vec<bool>,
    ) -> Result<CastPreparedSource, String> {
        let token = random_token()?;
        let public_base = format!("http://{public_ip}:{}", self.port);
        // AVPlay uses the URL suffix as an input to container/stream selection. Keeping the relay
        // endpoint extensionless made valid header-bound HLS and MP4 sources fail during prepare
        // with Samsung's unhelpful PLAYER_ERROR_NONE/unknown error.
        let media_resource_id = media_resource_id(&request, &media);
        let mut resources = HashMap::new();
        let mut prepared_subtitles = Vec::new();
        for (index, (subtitle, relay_subtitle)) in request
            .subtitles
            .into_iter()
            .zip(relay_subtitles)
            .enumerate()
        {
            let resource_id = format!(
                "subtitle-{index}.{}",
                request.subtitle_delivery.extension(subtitle.format)
            );
            let upstream = parse_http_url(&subtitle.url)?;
            let url = if relay_subtitle {
                let mut headers = request.headers.clone();
                headers.extend(subtitle.headers.clone());
                resources.insert(
                    resource_id.clone(),
                    RelayResource {
                        upstream,
                        headers,
                        kind: ResourceKind::Subtitle {
                            source: subtitle.format,
                            delivery: request.subtitle_delivery,
                        },
                    },
                );
                format!("{public_base}/cast/{token}/{resource_id}")
            } else {
                upstream.to_string()
            };
            prepared_subtitles.push(CastPreparedSubtitle {
                url,
                lang: subtitle.lang,
                title: subtitle.title,
                content_type: request
                    .subtitle_delivery
                    .content_type(subtitle.format)
                    .to_string(),
            });
        }

        let caption_urls = prepared_subtitles
            .iter()
            .map(|subtitle| subtitle.url.clone())
            .collect();
        if relay_media {
            resources.insert(
                media_resource_id.clone(),
                RelayResource {
                    upstream: media.clone(),
                    headers: request.headers.clone(),
                    kind: ResourceKind::Media {
                        hls: request.manifest.as_deref() == Some("hls")
                            || request.url.to_ascii_lowercase().contains(".m3u8"),
                        content_type: request.content_type.as_deref().and_then(valid_content_type),
                        caption_urls,
                    },
                },
            );
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
            url: if relay_media {
                session.local_url(&token, &media_resource_id)
            } else {
                media.to_string()
            },
            relayed: true,
            subtitles: prepared_subtitles,
        })
    }
}

async fn companion_snapshot(
    State(state): State<Arc<RelayState>>,
    Path(token): Path<String>,
    request_headers: HeaderMap,
) -> Response {
    let snapshot = state
        .companion
        .read()
        .ok()
        .and_then(|snapshots| snapshots.get(&token).cloned());
    let Some(snapshot) = snapshot.filter(|snapshot| snapshot.touch()) else {
        return relay_error(StatusCode::NOT_FOUND, "Companion snapshot expired");
    };
    let authorized = request_headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|value| value.as_bytes() == snapshot.bearer.as_bytes());
    if !authorized {
        return relay_error(StatusCode::UNAUTHORIZED, "Companion authorization failed");
    }
    let mut response = Response::new(Body::from(snapshot.payload.clone()));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    add_cors(response.headers_mut());
    response
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
    Query(query): Query<RelayQuery>,
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

    match fetch_resource(
        &token,
        &session,
        resource,
        query.caption,
        method,
        request_headers,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => relay_error(StatusCode::BAD_GATEWAY, &error),
    }
}

async fn fetch_resource(
    token: &str,
    session: &Arc<RelaySession>,
    resource: RelayResource,
    caption: Option<usize>,
    method: Method,
    request_headers: HeaderMap,
) -> Result<Response, String> {
    let upstream_method = reqwest::Method::from_bytes(method.as_str().as_bytes())
        .map_err(|error| error.to_string())?;
    // A media GET commonly remains open for the whole episode. The ordinary extension client has
    // a 30-second total API timeout, so using it here deterministically severed every relayed DLNA
    // stream. The streaming variant retains the same cookie jar/DoH behavior without that cap.
    let mut request = crate::ext_stream_http_client()
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
    let mut upstream_headers = upstream.headers().clone();
    let upstream_type = upstream_headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    if let ResourceKind::Media {
        content_type,
        caption_urls,
        ..
    } = &resource.kind
    {
        if let Some(content_type) = content_type
            .as_deref()
            .and_then(|value| HeaderValue::from_str(value).ok())
        {
            // CDN/torrent endpoints commonly return application/octet-stream. Samsung's DMR uses
            // the HTTP type as well as DIDL protocolInfo when deciding whether to open the item.
            upstream_headers.insert(header::CONTENT_TYPE, content_type);
        }
        upstream_headers
            .entry(HeaderName::from_static("transfermode.dlna.org"))
            .or_insert(HeaderValue::from_static("Streaming"));
        upstream_headers
            .entry(HeaderName::from_static("contentfeatures.dlna.org"))
            .or_insert(HeaderValue::from_static(
                "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000",
            ));
        if let Some(caption_url) = caption
            .and_then(|index| index.checked_sub(1))
            .and_then(|index| caption_urls.get(index))
            .and_then(|value| HeaderValue::from_str(value).ok())
        {
            // Samsung asks for this during its HEAD probe (getCaptionInfo.sec: 1). Supplying it on
            // GET too is harmless and covers firmware versions that skip the probe.
            upstream_headers.insert(HeaderName::from_static("captioninfo.sec"), caption_url);
        }
    }

    if method == Method::HEAD {
        let mut response = build_response(status, &upstream_headers, Body::empty(), None);
        if let ResourceKind::Subtitle { source, delivery } = resource.kind {
            if let Ok(value) = HeaderValue::from_str(delivery.content_type(source)) {
                response.headers_mut().insert(header::CONTENT_TYPE, value);
            }
            // A converted WebVTT payload has a different length. Omitting the upstream length is
            // safer than telling the renderer to truncate the generated SRT response.
            response.headers_mut().remove(header::CONTENT_LENGTH);
        }
        return Ok(response);
    }

    match resource.kind {
        ResourceKind::Subtitle { source, delivery } => {
            let bytes = read_limited(upstream, MAX_SUBTITLE_BYTES).await?;
            let body = match (delivery, source) {
                (SubtitleDelivery::SamsungDlna, SubtitleFormat::Vtt) => {
                    webvtt_to_srt(&bytes)?.into_bytes()
                }
                (SubtitleDelivery::SamsungDlna, SubtitleFormat::Srt) => bytes,
                (SubtitleDelivery::SamsungDlna, SubtitleFormat::Ttml) => {
                    return Err("Samsung DLNA captions support SRT or WebVTT sidecars".into());
                }
                (SubtitleDelivery::SamsungDlna, SubtitleFormat::Ass) => {
                    return Err("Samsung DLNA captions do not support ASS sidecars".into());
                }
                (SubtitleDelivery::Web, SubtitleFormat::Srt) => srt_to_webvtt(&bytes)?.into_bytes(),
                (
                    SubtitleDelivery::Web,
                    SubtitleFormat::Vtt | SubtitleFormat::Ttml | SubtitleFormat::Ass,
                ) => bytes,
                (SubtitleDelivery::TizenReceiver, _) => bytes,
            };
            Ok(build_response(
                status,
                &HeaderMap::new(),
                Body::from(body.clone()),
                Some((delivery.content_type(source), body.len())),
            ))
        }
        ResourceKind::Media { hls, .. } => {
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
    let resource_id = format!(
        "{}{}",
        blake3::hash(resolved.as_str().as_bytes()).to_hex(),
        safe_url_suffix(&resolved)
    );
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
                kind: ResourceKind::Media {
                    hls,
                    content_type: None,
                    caption_urls: Vec::new(),
                },
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

fn webvtt_to_srt(bytes: &[u8]) -> Result<String, String> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "Cast subtitle is not UTF-8".to_string())?
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let mut output = String::new();
    let mut cue_number = 1;
    for block in text.split("\n\n") {
        let lines = block.lines().collect::<Vec<_>>();
        let Some(timing_index) = lines.iter().position(|line| line.contains("-->")) else {
            continue;
        };
        let Some((start, end_and_settings)) = lines[timing_index].split_once("-->") else {
            continue;
        };
        let Some(end) = end_and_settings.split_whitespace().next() else {
            continue;
        };
        let timestamp = |value: &str| {
            let value = value.trim().replace('.', ",");
            if value.matches(':').count() == 1 {
                format!("00:{value}")
            } else {
                value
            }
        };
        let cue = lines[timing_index + 1..].join("\n");
        if cue.trim().is_empty() {
            continue;
        }
        output.push_str(&format!(
            "{cue_number}\n{} --> {}\n{cue}\n\n",
            timestamp(start),
            timestamp(end)
        ));
        cue_number += 1;
    }
    if output.is_empty() {
        return Err("WebVTT subtitle contains no usable cues".into());
    }
    Ok(output)
}

fn valid_content_type(value: &str) -> Option<String> {
    let value = value.split(';').next()?.trim().to_ascii_lowercase();
    (!value.is_empty() && value.len() <= 128 && value.contains('/')).then_some(value)
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
        for name in [
            "transfermode.dlna.org",
            "contentfeatures.dlna.org",
            "captioninfo.sec",
        ] {
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
        HeaderValue::from_static("Authorization, Range, If-Range, Content-Type, Accept-Encoding"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Length, Content-Range, Accept-Ranges, CaptionInfo.sec"),
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

    #[test]
    fn relays_phone_p2p_but_not_direct_debrid_to_the_tizen_client() {
        let request = |url: &str| CastPrepareRequest {
            url: url.into(),
            headers: HashMap::new(),
            manifest: None,
            subtitles: Vec::new(),
            force_relay: false,
            content_type: Some("video/x-matroska".into()),
            subtitle_delivery: SubtitleDelivery::TizenReceiver,
        };
        let p2p = request("http://127.0.0.1:49152/torrents/session/stream/0");
        let debrid = request("https://debrid-cdn.example/download/signed-file");

        assert_eq!(
            relay_plan(&p2p, &Url::parse(&p2p.url).unwrap()).unwrap(),
            (true, Vec::<bool>::new())
        );
        assert_eq!(
            relay_plan(&debrid, &Url::parse(&debrid.url).unwrap()).unwrap(),
            (false, Vec::<bool>::new())
        );
    }

    #[test]
    fn passes_ordinary_tizen_media_and_subtitles_directly_to_the_tv() {
        let request = CastPrepareRequest {
            url: "https://cdn.example/master.m3u8".into(),
            headers: HashMap::new(),
            manifest: Some("hls".into()),
            subtitles: vec![CastSubtitleRequest {
                url: "https://cdn.example/en.ass".into(),
                lang: Some("en".into()),
                title: Some("English".into()),
                format: SubtitleFormat::Ass,
                headers: HashMap::new(),
            }],
            force_relay: false,
            content_type: Some("application/vnd.apple.mpegurl".into()),
            subtitle_delivery: SubtitleDelivery::TizenReceiver,
        };
        assert_eq!(
            relay_plan(&request, &Url::parse(&request.url).unwrap()).unwrap(),
            (false, vec![false])
        );
    }

    #[test]
    fn bridges_only_tizen_resources_the_tv_cannot_fetch_directly() {
        let request = CastPrepareRequest {
            url: "https://cdn.example/video.mp4".into(),
            headers: HashMap::new(),
            manifest: None,
            subtitles: vec![CastSubtitleRequest {
                url: "http://127.0.0.1:9000/en.srt".into(),
                lang: Some("en".into()),
                title: None,
                format: SubtitleFormat::Srt,
                headers: HashMap::new(),
            }],
            force_relay: false,
            content_type: Some("video/mp4".into()),
            subtitle_delivery: SubtitleDelivery::TizenReceiver,
        };
        assert_eq!(
            relay_plan(&request, &Url::parse(&request.url).unwrap()).unwrap(),
            (false, vec![true])
        );
    }

    #[test]
    fn normalizes_safe_declared_content_types() {
        assert_eq!(
            valid_content_type("video/x-mkv; charset=binary").as_deref(),
            Some("video/x-mkv")
        );
        assert_eq!(valid_content_type("not-a-content-type"), None);
    }

    #[test]
    fn keeps_player_significant_suffixes_on_relay_urls() {
        let request = CastPrepareRequest {
            url: "https://cdn.example/tokenized?id=42".into(),
            headers: HashMap::new(),
            manifest: Some("hls".into()),
            subtitles: Vec::new(),
            force_relay: true,
            content_type: Some("application/vnd.apple.mpegurl".into()),
            subtitle_delivery: SubtitleDelivery::TizenReceiver,
        };
        assert_eq!(
            media_resource_id(&request, &Url::parse(&request.url).unwrap()),
            "media.m3u8"
        );
        assert_eq!(
            safe_url_suffix(&Url::parse("https://cdn.example/segment-01.ts?token=x").unwrap()),
            ".ts"
        );
    }

    #[test]
    fn converts_webvtt_to_samsung_srt() {
        let converted =
            webvtt_to_srt(b"WEBVTT\n\nintro\n00:01.250 --> 00:03.500 align:start\nHello\nworld\n")
                .unwrap();
        assert_eq!(
            converted,
            "1\n00:00:01,250 --> 00:00:03,500\nHello\nworld\n\n"
        );
    }
}
