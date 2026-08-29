//! Native desktop sender for Google Cast / Chromecast targets.
//!
//! Tauri desktop webviews do not expose Chrome's Web Sender API. We therefore discover receivers
//! through their `_googlecast._tcp.local.` DNS-SD advertisement and speak CastV2 directly. Media
//! bytes still travel receiver-to-origin (or through `cast_relay` when credentials/loopback make
//! that necessary); this module only owns discovery and the sender control handshake.

use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    rc::Rc,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use mdns_sd::{ServiceDaemon, ServiceEvent};
use rust_cast::{
    channels::{
        connection::ConnectionChannel,
        heartbeat::HeartbeatChannel,
        receiver::{CastDeviceApp, ReceiverChannel},
    },
    message_manager::{CastMessage, CastMessagePayload, MessageManager},
    NoCertificateVerification,
};
use rustls::{pki_types::ServerName, ClientConfig, ClientConnection, StreamOwned};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use url::Url;

const CAST_SERVICE: &str = "_googlecast._tcp.local.";
const SENDER_ID: &str = "sender-0";
const RECEIVER_ID: &str = "receiver-0";
const MEDIA_NAMESPACE: &str = "urn:x-cast:com.google.cast.media";
const HEARTBEAT_NAMESPACE: &str = "urn:x-cast:com.google.cast.tp.heartbeat";
const DEVICE_TTL: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const IO_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_DISCOVERY_MS: u64 = 1_800;
const MAX_DISCOVERY_MS: u64 = 5_000;
const MAX_CAST_MESSAGE_BYTES: usize = 64 * 1024;

type CastIo = StreamOwned<ClientConnection, TcpStream>;
type CastManager = Rc<MessageManager<CastIo>>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCastDevice {
    id: String,
    name: String,
    model: Option<String>,
    address: Ipv4Addr,
    port: u16,
}

#[derive(Clone)]
struct CachedDevice {
    device: DesktopCastDevice,
    seen_at: Instant,
}

#[derive(Clone, Debug)]
struct ActiveCast {
    device: DesktopCastDevice,
    app_session_id: String,
}

#[derive(Default)]
pub struct DesktopCastState {
    devices: Mutex<HashMap<String, CachedDevice>>,
    active: Mutex<Option<ActiveCast>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCastDiscoverRequest {
    #[serde(default = "default_discovery_ms")]
    wait_ms: u64,
}

fn default_discovery_ms() -> u64 {
    DEFAULT_DISCOVERY_MS
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCastSubtitle {
    url: String,
    lang: Option<String>,
    title: Option<String>,
    content_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCastStartRequest {
    device_id: String,
    url: String,
    title: Option<String>,
    content_type: String,
    #[serde(default)]
    position_seconds: f64,
    #[serde(default)]
    subtitles: Vec<DesktopCastSubtitle>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCastSession {
    device_id: String,
    device_name: String,
}

struct CastConnection {
    manager: CastManager,
    connection: ConnectionChannel<'static, CastIo>,
    heartbeat: HeartbeatChannel<'static, CastIo>,
    receiver: ReceiverChannel<'static, CastIo>,
}

#[tauri::command]
pub async fn desktop_cast_discover(
    state: tauri::State<'_, DesktopCastState>,
    request: DesktopCastDiscoverRequest,
) -> Result<Vec<DesktopCastDevice>, String> {
    let wait = Duration::from_millis(request.wait_ms.clamp(100, MAX_DISCOVERY_MS));
    let discovered = tauri::async_runtime::spawn_blocking(move || discover_devices(wait))
        .await
        .map_err(|error| format!("Cast discovery stopped unexpectedly: {error}"))??;

    let mut cache = state
        .devices
        .lock()
        .map_err(|_| "Cast device cache is unavailable".to_string())?;
    let now = Instant::now();
    cache.retain(|_, item| now.duration_since(item.seen_at) <= DEVICE_TTL);
    for device in discovered {
        cache.insert(
            device.id.clone(),
            CachedDevice {
                device,
                seen_at: now,
            },
        );
    }
    let mut devices = cache
        .values()
        .map(|item| item.device.clone())
        .collect::<Vec<_>>();
    devices.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(devices)
}

#[tauri::command]
pub async fn desktop_cast_start(
    state: tauri::State<'_, DesktopCastState>,
    request: DesktopCastStartRequest,
) -> Result<DesktopCastSession, String> {
    validate_start_request(&request)?;
    let device = {
        let cache = state
            .devices
            .lock()
            .map_err(|_| "Cast device cache is unavailable".to_string())?;
        let cached = cache
            .get(&request.device_id)
            .ok_or_else(|| "That Cast device is no longer available; scan again".to_string())?;
        if cached.seen_at.elapsed() > DEVICE_TTL {
            return Err("That Cast device is no longer available; scan again".into());
        }
        cached.device.clone()
    };

    let cast_device = device.clone();
    let app_session_id =
        tauri::async_runtime::spawn_blocking(move || launch_media(&cast_device, &request))
            .await
            .map_err(|error| format!("Cast sender stopped unexpectedly: {error}"))??;

    let session = ActiveCast {
        device: device.clone(),
        app_session_id,
    };
    *state
        .active
        .lock()
        .map_err(|_| "Cast session state is unavailable".to_string())? = Some(session);

    Ok(DesktopCastSession {
        device_id: device.id,
        device_name: device.name,
    })
}

#[tauri::command]
pub async fn desktop_cast_stop(state: tauri::State<'_, DesktopCastState>) -> Result<(), String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "Cast session state is unavailable".to_string())?
        .clone();
    let Some(active) = active else {
        return Ok(());
    };
    let stopping = active.clone();
    tauri::async_runtime::spawn_blocking(move || stop_session(&stopping))
        .await
        .map_err(|error| format!("Cast sender stopped unexpectedly: {error}"))??;

    let mut slot = state
        .active
        .lock()
        .map_err(|_| "Cast session state is unavailable".to_string())?;
    if slot
        .as_ref()
        .is_some_and(|current| current.app_session_id == active.app_session_id)
    {
        *slot = None;
    }
    Ok(())
}

fn discover_devices(wait: Duration) -> Result<Vec<DesktopCastDevice>, String> {
    let mdns =
        ServiceDaemon::new().map_err(|error| format!("Could not start Cast discovery: {error}"))?;
    let events = mdns
        .browse(CAST_SERVICE)
        .map_err(|error| format!("Could not browse for Cast devices: {error}"))?;
    let deadline = Instant::now() + wait;
    let mut devices = HashMap::<String, DesktopCastDevice>::new();

    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        match events.recv_timeout(remaining) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let Some(address) = preferred_ipv4(
                    info.get_addresses()
                        .iter()
                        .map(|address| address.to_ip_addr()),
                ) else {
                    continue;
                };
                let id = clean_field(info.get_property_val_str("id"), 128)
                    .unwrap_or_else(|| info.get_fullname().trim_end_matches('.').to_string());
                let name = clean_field(info.get_property_val_str("fn"), 128)
                    .unwrap_or_else(|| service_name(info.get_fullname()));
                let model = clean_field(info.get_property_val_str("md"), 128);
                let port = info.get_port();
                if port == 0 {
                    continue;
                }
                devices.insert(
                    id.clone(),
                    DesktopCastDevice {
                        id,
                        name,
                        model,
                        address,
                        port,
                    },
                );
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }

    let _ = mdns.stop_browse(CAST_SERVICE);
    let _ = mdns.shutdown();
    Ok(devices.into_values().collect())
}

fn preferred_ipv4(addresses: impl IntoIterator<Item = IpAddr>) -> Option<Ipv4Addr> {
    let mut candidates = addresses
        .into_iter()
        .filter_map(|address| match address {
            IpAddr::V4(address)
                if !address.is_loopback()
                    && !address.is_unspecified()
                    && !address.is_multicast()
                    && address != Ipv4Addr::BROADCAST =>
            {
                Some(address)
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|address| (!address.is_private(), !address.is_link_local(), *address));
    candidates.into_iter().next()
}

fn clean_field(value: Option<&str>, max_chars: usize) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    Some(value.chars().take(max_chars).collect())
}

fn service_name(fullname: &str) -> String {
    fullname
        .strip_suffix(CAST_SERVICE)
        .unwrap_or(fullname)
        .trim_end_matches('.')
        .replace("\\.", ".")
}

fn validate_start_request(request: &DesktopCastStartRequest) -> Result<(), String> {
    validate_http_url(&request.url, "media")?;
    if !supported_media_type(&request.content_type) {
        return Err("Cast received an unsupported media content type".into());
    }
    if !request.position_seconds.is_finite() || request.position_seconds < 0.0 {
        return Err("Cast received an invalid playback position".into());
    }
    if request.subtitles.len() > 8 {
        return Err("Cast received too many subtitle tracks".into());
    }
    for subtitle in &request.subtitles {
        validate_http_url(&subtitle.url, "subtitle")?;
        if !supported_subtitle_type(&subtitle.content_type) {
            return Err("Cast received an unsupported subtitle content type".into());
        }
    }
    Ok(())
}

fn validate_http_url(value: &str, kind: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|_| format!("Cast received an invalid {kind} URL"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(format!("Cast needs an HTTP or HTTPS {kind} URL"));
    }
    Ok(())
}

fn supported_media_type(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    value.starts_with("video/")
        || value.starts_with("audio/")
        || matches!(
            value.split(';').next().unwrap_or("").trim(),
            "application/vnd.apple.mpegurl" | "application/x-mpegurl" | "application/dash+xml"
        )
}

fn supported_subtitle_type(value: &str) -> bool {
    matches!(
        value
            .to_ascii_lowercase()
            .split(';')
            .next()
            .unwrap_or("")
            .trim(),
        "text/vtt" | "application/ttml+xml"
    )
}

fn connect(device: &DesktopCastDevice) -> Result<CastConnection, String> {
    let socket = SocketAddr::from((device.address, device.port));
    let tcp = TcpStream::connect_timeout(&socket, CONNECT_TIMEOUT)
        .map_err(|error| format!("Could not connect to {}: {error}", device.name))?;
    tcp.set_read_timeout(Some(IO_TIMEOUT))
        .map_err(|error| format!("Could not configure the Cast connection: {error}"))?;
    tcp.set_write_timeout(Some(IO_TIMEOUT))
        .map_err(|error| format!("Could not configure the Cast connection: {error}"))?;

    // Cast receivers use self-signed device certificates rather than the public Web PKI. Keep the
    // peer's signature checks, but deliberately skip Web-PKI identity verification, matching
    // rust_cast's CastV2 transport. Pick AWS-LC explicitly: the full app graph also enables ring,
    // and rustls cannot infer a process-wide default when both providers are compiled in.
    let config = ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|error| format!("Could not configure Cast TLS versions: {error}"))?
    .dangerous()
    .with_custom_certificate_verifier(Arc::new(NoCertificateVerification))
    .with_no_client_auth();
    let server_name = ServerName::try_from(device.address.to_string())
        .map_err(|error| format!("Could not address the Cast receiver: {error}"))?
        .to_owned();
    let tls = ClientConnection::new(Arc::new(config), server_name)
        .map_err(|error| format!("Could not configure Cast TLS: {error}"))?;
    let manager = Rc::new(MessageManager::new(StreamOwned::new(tls, tcp)));
    let connection = ConnectionChannel::new(SENDER_ID, Rc::clone(&manager));
    let heartbeat = HeartbeatChannel::new(SENDER_ID, RECEIVER_ID, Rc::clone(&manager));
    let receiver = ReceiverChannel::new(SENDER_ID, RECEIVER_ID, Rc::clone(&manager));
    connection
        .connect(RECEIVER_ID)
        .map_err(|error| format!("Could not open the Cast control channel: {error}"))?;
    heartbeat
        .ping()
        .map_err(|error| format!("Could not contact the Cast receiver: {error}"))?;
    Ok(CastConnection {
        manager,
        connection,
        heartbeat,
        receiver,
    })
}

fn launch_media(
    device: &DesktopCastDevice,
    request: &DesktopCastStartRequest,
) -> Result<String, String> {
    let cast = connect(device)?;
    let app = cast
        .receiver
        .launch_app(&CastDeviceApp::DefaultMediaReceiver)
        .map_err(|error| format!("Could not open the Cast media receiver: {error}"))?;
    cast.connection
        .connect(app.transport_id.as_str())
        .map_err(|error| format!("Could not connect to the Cast media receiver: {error}"))?;

    let request_id = cast.manager.generate_request_id().get();
    let payload = load_payload(request_id, &app.session_id, request);
    let encoded = serde_json::to_string(&payload)
        .map_err(|error| format!("Could not prepare the Cast request: {error}"))?;
    if encoded.len() > MAX_CAST_MESSAGE_BYTES {
        return Err("Cast media metadata exceeds the receiver message limit".into());
    }
    cast.manager
        .send(CastMessage {
            namespace: MEDIA_NAMESPACE.into(),
            source: SENDER_ID.into(),
            destination: app.transport_id,
            payload: CastMessagePayload::String(encoded),
        })
        .map_err(|error| format!("Could not send media to the Cast receiver: {error}"))?;

    wait_for_load(&cast, request_id, &request.url)?;
    Ok(app.session_id)
}

fn load_payload(request_id: u32, session_id: &str, request: &DesktopCastStartRequest) -> Value {
    let tracks = request
        .subtitles
        .iter()
        .enumerate()
        .map(|(index, subtitle)| {
            let track_id = index as u32 + 1;
            json!({
                "trackId": track_id,
                "type": "TEXT",
                "trackContentId": subtitle.url,
                "trackContentType": subtitle.content_type,
                "subtype": "SUBTITLES",
                "name": subtitle.title.as_deref().unwrap_or("Subtitles"),
                "language": subtitle.lang.as_deref().unwrap_or("und")
            })
        })
        .collect::<Vec<_>>();
    let active_track_ids = (1..=tracks.len() as u32).collect::<Vec<_>>();
    json!({
        "type": "LOAD",
        "requestId": request_id,
        "sessionId": session_id,
        "autoplay": true,
        "currentTime": request.position_seconds,
        "activeTrackIds": active_track_ids,
        "customData": {},
        "media": {
            "contentId": request.url,
            "streamType": "BUFFERED",
            "contentType": request.content_type,
            "metadata": {
                "metadataType": 0,
                "title": request.title.as_deref().unwrap_or("Izumi")
            },
            "tracks": tracks
        }
    })
}

fn wait_for_load(cast: &CastConnection, request_id: u32, content_id: &str) -> Result<i32, String> {
    loop {
        let message = cast
            .manager
            .receive()
            .map_err(|error| format!("Cast receiver did not confirm playback: {error}"))?;
        if message.namespace == HEARTBEAT_NAMESPACE {
            if payload_type(&message.payload).as_deref() == Some("PING") {
                cast.heartbeat
                    .pong()
                    .map_err(|error| format!("Could not answer the Cast receiver: {error}"))?;
            }
            continue;
        }
        if message.namespace != MEDIA_NAMESPACE {
            continue;
        }
        let CastMessagePayload::String(raw) = message.payload else {
            continue;
        };
        let value: Value = serde_json::from_str(&raw)
            .map_err(|error| format!("Cast receiver returned invalid media status: {error}"))?;
        if let Some(result) = load_response(&value, request_id, content_id) {
            return result;
        }
    }
}

fn payload_type(payload: &CastMessagePayload) -> Option<String> {
    let CastMessagePayload::String(raw) = payload else {
        return None;
    };
    serde_json::from_str::<Value>(raw)
        .ok()?
        .get("type")?
        .as_str()
        .map(str::to_owned)
}

fn load_response(value: &Value, request_id: u32, content_id: &str) -> Option<Result<i32, String>> {
    let response_type = value.get("type")?.as_str()?;
    let response_request = value.get("requestId").and_then(Value::as_u64).unwrap_or(0) as u32;
    match response_type {
        "MEDIA_STATUS" => {
            let status = value.get("status")?.as_array()?;
            let matching = status.iter().find(|entry| {
                response_request == request_id
                    || entry
                        .pointer("/media/contentId")
                        .and_then(Value::as_str)
                        .is_some_and(|id| id == content_id)
            })?;
            let session_id = matching.get("mediaSessionId").and_then(Value::as_i64)?;
            Some(
                i32::try_from(session_id)
                    .map_err(|_| "Cast returned an invalid media session".into()),
            )
        }
        "LOAD_FAILED" | "LOAD_CANCELLED" | "INVALID_PLAYER_STATE" | "INVALID_REQUEST"
            if response_request == request_id =>
        {
            let reason = value
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or(response_type);
            Some(Err(format!("Cast could not start playback: {reason}")))
        }
        _ => None,
    }
}

fn stop_session(active: &ActiveCast) -> Result<(), String> {
    let cast = connect(&active.device)?;
    let status = cast
        .receiver
        .get_status()
        .map_err(|error| format!("Could not read Cast session state: {error}"))?;
    if status
        .applications
        .iter()
        .any(|app| app.session_id == active.app_session_id)
    {
        cast.receiver
            .stop_app(active.app_session_id.as_str())
            .map_err(|error| format!("Could not stop casting: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn request() -> DesktopCastStartRequest {
        DesktopCastStartRequest {
            device_id: "living-room".into(),
            url: "http://192.168.1.5:43100/cast/token/media".into(),
            title: Some("Frieren — Episode 1".into()),
            content_type: "video/mp4".into(),
            position_seconds: 63.25,
            subtitles: vec![DesktopCastSubtitle {
                url: "http://192.168.1.5:43100/cast/token/subtitle-0".into(),
                lang: Some("en".into()),
                title: Some("English".into()),
                content_type: "text/vtt; charset=utf-8".into(),
            }],
        }
    }

    #[test]
    fn load_request_carries_resume_point_and_active_sidecar() {
        let payload = load_payload(7, "session-1", &request());
        assert_eq!(payload["currentTime"], 63.25);
        assert_eq!(payload["activeTrackIds"], json!([1]));
        assert_eq!(
            payload["media"]["tracks"][0]["trackContentType"],
            "text/vtt; charset=utf-8"
        );
        assert_eq!(payload["media"]["tracks"][0]["language"], "en");
    }

    #[test]
    fn media_status_must_match_our_load() {
        let response = json!({
            "type": "MEDIA_STATUS",
            "requestId": 7,
            "status": [{ "mediaSessionId": 42, "media": { "contentId": "http://media" } }]
        });
        assert_eq!(
            load_response(&response, 7, "http://media")
                .unwrap()
                .unwrap(),
            42
        );
        assert!(load_response(&response, 8, "http://other").is_none());
    }

    #[test]
    fn rejects_non_web_media_and_unknown_subtitle_formats() {
        let mut value = request();
        value.url = "file:///tmp/video.mp4".into();
        assert!(validate_start_request(&value)
            .unwrap_err()
            .contains("HTTP or HTTPS"));

        let mut value = request();
        value.subtitles[0].content_type = "text/x-ssa".into();
        assert!(validate_start_request(&value)
            .unwrap_err()
            .contains("subtitle content type"));
    }

    #[test]
    fn address_choice_ignores_loopback_and_prefers_private_ipv4() {
        let addresses = HashSet::from([
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            IpAddr::V4(Ipv4Addr::new(203, 0, 113, 4)),
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 40)),
        ]);
        assert_eq!(
            preferred_ipv4(addresses),
            Some(Ipv4Addr::new(192, 168, 1, 40))
        );
    }
}
