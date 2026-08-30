//! Content-only TV casting through the UPnP AV MediaRenderer profile.
//!
//! Discovery is SSDP multicast. Playback uses the receiver's advertised AVTransport and
//! RenderingControl SOAP endpoints, so the TV fetches media from the origin (or Izumi's LAN relay)
//! and the desktop remains a control point rather than mirroring its screen.

use std::{
    collections::{HashMap, HashSet},
    net::{Ipv4Addr, SocketAddr, UdpSocket},
    time::{Duration, Instant},
};

use futures_util::future::join_all;
use quick_xml::{events::Event, Reader};
use reqwest::{header, Client};
use url::Url;

const SSDP_TARGET: &str = "239.255.255.250:1900";
const MEDIA_RENDERER_V1: &str = "urn:schemas-upnp-org:device:MediaRenderer:1";
const MAX_SSDP_PACKET: usize = 16 * 1024;
const MAX_DEVICE_DESCRIPTIONS: usize = 32;
const MAX_XML_BYTES: usize = 512 * 1024;
const HTTP_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Clone, Debug)]
pub struct DlnaDevice {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub address: Ipv4Addr,
    pub port: u16,
    av_transport: ServiceEndpoint,
    rendering_control: Option<ServiceEndpoint>,
}

#[derive(Clone, Debug)]
struct ServiceEndpoint {
    service_type: String,
    control_url: Url,
}

#[derive(Clone, Debug)]
struct DiscoveredLocation {
    url: Url,
    source: Ipv4Addr,
}

#[derive(Clone, Debug, Default)]
pub struct DlnaStatus {
    pub state: String,
    pub position_seconds: f32,
    pub duration_seconds: Option<f32>,
    pub volume: Option<f32>,
    pub muted: Option<bool>,
}

#[derive(Clone, Copy, Debug)]
pub struct DlnaSubtitle<'a> {
    pub track_id: u32,
    pub url: &'a str,
}

#[derive(Default)]
struct ServiceFields {
    service_type: String,
    control_url: String,
}

pub async fn discover(wait: Duration) -> Result<Vec<DlnaDevice>, String> {
    let locations = tauri::async_runtime::spawn_blocking(move || discover_locations(wait))
        .await
        .map_err(|error| format!("DLNA discovery stopped unexpectedly: {error}"))??;
    if locations.is_empty() {
        return Ok(Vec::new());
    }

    let client = Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|error| format!("Could not configure DLNA discovery: {error}"))?;
    let descriptions = locations
        .into_iter()
        .take(MAX_DEVICE_DESCRIPTIONS)
        .map(|location| describe_device(client.clone(), location));
    let mut devices = HashMap::<String, DlnaDevice>::new();
    for device in join_all(descriptions).await.into_iter().flatten() {
        devices.entry(device.id.clone()).or_insert(device);
    }
    Ok(devices.into_values().collect())
}

fn discover_locations(wait: Duration) -> Result<Vec<DiscoveredLocation>, String> {
    // Windows often makes a VPN or virtual Ethernet adapter the default multicast route. Send one
    // query from every live LAN address so the Wi-Fi TV remains discoverable on multi-homed PCs.
    let mut sockets = netdev::get_interfaces()
        .into_iter()
        .filter(|interface| interface.is_up() && !interface.is_loopback())
        .flat_map(|interface| interface.ipv4.into_iter().map(|network| network.addr()))
        .filter(|address| valid_lan_address(*address))
        .filter_map(|address| {
            let socket = UdpSocket::bind((address, 0)).ok()?;
            socket.set_multicast_ttl_v4(2).ok()?;
            socket.set_nonblocking(true).ok()?;
            Some(socket)
        })
        .collect::<Vec<_>>();
    if sockets.is_empty() {
        let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
            .map_err(|error| format!("Could not open DLNA discovery: {error}"))?;
        socket
            .set_multicast_ttl_v4(2)
            .map_err(|error| format!("Could not configure DLNA multicast: {error}"))?;
        socket
            .set_nonblocking(true)
            .map_err(|error| format!("Could not configure DLNA discovery: {error}"))?;
        sockets.push(socket);
    }

    let mut sent = false;
    for socket in &sockets {
        for target in [MEDIA_RENDERER_V1, "ssdp:all"] {
            let request = format!(
                "M-SEARCH * HTTP/1.1\r\nHOST: {SSDP_TARGET}\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: {target}\r\nUSER-AGENT: Izumi/1.0 UPnP/1.1\r\n\r\n"
            );
            sent |= socket.send_to(request.as_bytes(), SSDP_TARGET).is_ok();
        }
    }
    if !sent {
        return Err("Could not send DLNA discovery on any network interface".into());
    }

    let deadline = Instant::now() + wait;
    let mut packet = vec![0_u8; MAX_SSDP_PACKET];
    let mut seen = HashSet::new();
    let mut locations = Vec::new();
    while Instant::now() < deadline {
        for socket in &sockets {
            loop {
                match socket.recv_from(&mut packet) {
                    Ok((length, source)) => {
                        let SocketAddr::V4(source) = source else {
                            continue;
                        };
                        let source_ip = *source.ip();
                        if !valid_lan_address(source_ip) {
                            continue;
                        }
                        let response = String::from_utf8_lossy(&packet[..length]);
                        let Some(location) = header_value(&response, "location") else {
                            continue;
                        };
                        let Ok(url) = Url::parse(location.trim()) else {
                            continue;
                        };
                        let matches_source = url.scheme() == "http"
                            && url
                                .host_str()
                                .and_then(|host| host.parse::<Ipv4Addr>().ok())
                                == Some(source_ip);
                        if !matches_source || !seen.insert(url.to_string()) {
                            continue;
                        }
                        locations.push(DiscoveredLocation {
                            url,
                            source: source_ip,
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                    Err(error) => {
                        return Err(format!("Could not receive DLNA discovery: {error}"));
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(12));
    }
    Ok(locations)
}

fn valid_lan_address(address: Ipv4Addr) -> bool {
    !address.is_loopback()
        && !address.is_unspecified()
        && !address.is_multicast()
        && address != Ipv4Addr::BROADCAST
        && (address.is_private() || address.is_link_local())
}

fn header_value<'a>(response: &'a str, name: &str) -> Option<&'a str> {
    response.lines().skip(1).find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim()
            .eq_ignore_ascii_case(name)
            .then_some(value.trim())
    })
}

async fn describe_device(client: Client, location: DiscoveredLocation) -> Option<DlnaDevice> {
    let response = client
        .get(location.url.clone())
        .header(header::USER_AGENT, "Izumi/1.0 UPnP/1.1")
        .send()
        .await
        .ok()?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > MAX_XML_BYTES as u64)
    {
        return None;
    }
    let body = response.bytes().await.ok()?;
    if body.len() > MAX_XML_BYTES {
        return None;
    }
    parse_device_description(&body, &location.url, location.source).ok()
}

fn parse_device_description(
    xml: &[u8],
    location: &Url,
    source: Ipv4Addr,
) -> Result<DlnaDevice, String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut tag = String::new();
    let mut in_service = false;
    let mut service = ServiceFields::default();
    let mut services = Vec::new();
    let mut friendly_name = String::new();
    let mut manufacturer = String::new();
    let mut model = String::new();
    let mut udn = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                tag = String::from_utf8_lossy(element.local_name().as_ref()).into_owned();
                if tag == "service" {
                    in_service = true;
                    service = ServiceFields::default();
                }
            }
            Ok(Event::Text(text)) => {
                let decoded = text
                    .xml_content()
                    .map_err(|error| format!("Invalid DLNA device text: {error}"))?;
                let value = quick_xml::escape::unescape(&decoded)
                    .map_err(|error| format!("Invalid DLNA device escape: {error}"))?
                    .trim()
                    .to_string();
                if in_service {
                    match tag.as_str() {
                        "serviceType" => service.service_type = value,
                        "controlURL" => service.control_url = value,
                        _ => {}
                    }
                } else {
                    match tag.as_str() {
                        "friendlyName" if friendly_name.is_empty() => friendly_name = value,
                        "manufacturer" if manufacturer.is_empty() => manufacturer = value,
                        "modelName" if model.is_empty() => model = value,
                        "UDN" if udn.is_empty() => udn = value,
                        _ => {}
                    }
                }
            }
            Ok(Event::End(element)) => {
                let name = String::from_utf8_lossy(element.local_name().as_ref()).into_owned();
                if name == "service" {
                    in_service = false;
                    services.push(service);
                    service = ServiceFields::default();
                }
                tag.clear();
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(format!("Invalid DLNA device description: {error}")),
        }
    }

    let endpoint = |kind: &str| -> Option<ServiceEndpoint> {
        let service = services.iter().find(|service| {
            service.service_type.contains(kind) && !service.control_url.is_empty()
        })?;
        let control_url = location.join(&service.control_url).ok()?;
        let host_matches = control_url.scheme() == "http"
            && control_url
                .host_str()
                .and_then(|host| host.parse::<Ipv4Addr>().ok())
                == Some(source);
        host_matches.then(|| ServiceEndpoint {
            service_type: service.service_type.clone(),
            control_url,
        })
    };
    let av_transport = endpoint("AVTransport")
        .ok_or_else(|| "DLNA renderer has no AVTransport control service".to_string())?;
    let rendering_control = endpoint("RenderingControl");
    let port = location.port_or_known_default().unwrap_or(80);
    let name = clean_value(&friendly_name, 128).unwrap_or_else(|| format!("TV at {source}"));
    let id_source = clean_value(&udn, 256).unwrap_or_else(|| location.to_string());
    Ok(DlnaDevice {
        id: id_source,
        name,
        manufacturer: clean_value(&manufacturer, 128),
        model: clean_value(&model, 128),
        address: source,
        port,
        av_transport,
        rendering_control,
    })
}

fn clean_value(value: &str, max_chars: usize) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.chars().take(max_chars).collect())
}

pub async fn start(
    device: &DlnaDevice,
    url: &str,
    title: &str,
    content_type: &str,
    position_seconds: f64,
    subtitle: Option<DlnaSubtitle<'_>>,
) -> Result<(), String> {
    // Samsung's AllShare renderer advertises a few legacy MIME aliases rather than the modern
    // names used by browsers/mpv. Some TVs reject video/x-matroska at the transport layer even
    // though the same container is accepted as video/x-mkv.
    let content_type = dlna_content_type(device, content_type);
    let class = if content_type.to_ascii_lowercase().starts_with("audio/") {
        "object.item.audioItem"
    } else {
        "object.item.videoItem"
    };
    let subtitle = subtitle.filter(|_| is_samsung(device));
    let media_url = media_url_with_caption(url, subtitle.map(|value| value.track_id))?;
    let didl = didl_metadata(title, class, &content_type, &media_url, subtitle);
    let set_body = format!(
        "<InstanceID>0</InstanceID><CurrentURI>{}</CurrentURI><CurrentURIMetaData>{}</CurrentURIMetaData>",
        xml_escape(&media_url),
        xml_escape(&didl),
    );
    if let Err(first_error) = soap_call(&device.av_transport, "SetAVTransportURI", &set_body).await
    {
        let without_metadata = format!(
            "<InstanceID>0</InstanceID><CurrentURI>{}</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>",
            xml_escape(&media_url),
        );
        soap_call(&device.av_transport, "SetAVTransportURI", &without_metadata)
            .await
            .map_err(|_| first_error)?;
    }
    soap_call(
        &device.av_transport,
        "Play",
        "<InstanceID>0</InstanceID><Speed>1</Speed>",
    )
    .await?;
    // SetAVTransportURI and Play can both return success before Samsung asynchronously validates
    // the resource. Catch its definitive ERROR_OCCURRED response before the desktop pauses local
    // playback and announces a cast session that never actually began.
    tokio::time::sleep(Duration::from_millis(650)).await;
    ensure_transport_healthy(device).await?;
    if position_seconds >= 1.0 {
        let _ = seek(device, position_seconds).await;
    }
    Ok(())
}

fn media_url_with_caption(url: &str, track_id: Option<u32>) -> Result<String, String> {
    let Some(track_id) = track_id else {
        return Ok(url.to_string());
    };
    let mut media_url = Url::parse(url).map_err(|_| "DLNA received an invalid media URL")?;
    media_url
        .query_pairs_mut()
        .append_pair("caption", &track_id.to_string());
    Ok(media_url.to_string())
}

fn didl_metadata(
    title: &str,
    class: &str,
    content_type: &str,
    media_url: &str,
    subtitle: Option<DlnaSubtitle<'_>>,
) -> String {
    let sec_namespace = subtitle
        .is_some()
        .then_some(" xmlns:sec=\"http://www.sec.co.kr/\"")
        .unwrap_or_default();
    let subtitle_metadata = subtitle
        .map(|subtitle| {
            let url = xml_escape(subtitle.url);
            format!(
                "<res protocolInfo=\"http-get:*:text/srt:*\">{url}</res><sec:CaptionInfoEx sec:type=\"srt\">{url}</sec:CaptionInfoEx>"
            )
        })
        .unwrap_or_default();
    format!(
        "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"{sec_namespace}><item id=\"0\" parentID=\"0\" restricted=\"1\"><dc:title>{}</dc:title><upnp:class>{class}</upnp:class><res protocolInfo=\"http-get:*:{}:*\">{}</res>{subtitle_metadata}</item></DIDL-Lite>",
        xml_escape(title),
        xml_escape(content_type),
        xml_escape(media_url),
    )
}

fn is_samsung(device: &DlnaDevice) -> bool {
    device
        .manufacturer
        .as_deref()
        .is_some_and(|value| value.to_ascii_lowercase().contains("samsung"))
        || device.name.to_ascii_lowercase().contains("samsung")
}

fn dlna_content_type(device: &DlnaDevice, content_type: &str) -> String {
    let content_type = content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase();
    if !is_samsung(device) {
        return content_type;
    }
    match content_type.as_str() {
        "video/x-matroska" | "application/x-matroska" => "video/x-mkv".into(),
        "audio/flac" => "audio/x-flac".into(),
        "audio/wav" => "audio/x-wav".into(),
        "video/mp2t" => "video/mpeg".into(),
        _ => content_type,
    }
}

async fn ensure_transport_healthy(device: &DlnaDevice) -> Result<(), String> {
    let transport = soap_call(
        &device.av_transport,
        "GetTransportInfo",
        "<InstanceID>0</InstanceID>",
    )
    .await?;
    if element_text(&transport, "CurrentTransportStatus")
        .is_some_and(|value| value.eq_ignore_ascii_case("ERROR_OCCURRED"))
    {
        return Err(
            "The TV rejected this stream. Its container, codecs, or media URL may not be supported"
                .into(),
        );
    }
    Ok(())
}

pub async fn status(device: &DlnaDevice) -> Result<DlnaStatus, String> {
    let transport = soap_call(
        &device.av_transport,
        "GetTransportInfo",
        "<InstanceID>0</InstanceID>",
    );
    let position = soap_call(
        &device.av_transport,
        "GetPositionInfo",
        "<InstanceID>0</InstanceID>",
    );
    let volume = async {
        let endpoint = device.rendering_control.as_ref()?;
        soap_call(
            endpoint,
            "GetVolume",
            "<InstanceID>0</InstanceID><Channel>Master</Channel>",
        )
        .await
        .ok()
    };
    let muted = async {
        let endpoint = device.rendering_control.as_ref()?;
        soap_call(
            endpoint,
            "GetMute",
            "<InstanceID>0</InstanceID><Channel>Master</Channel>",
        )
        .await
        .ok()
    };
    let (transport, position, volume, muted) = tokio::join!(transport, position, volume, muted);
    let transport = transport?;
    let position = position.unwrap_or_default();
    let state = match element_text(&transport, "CurrentTransportState").as_deref() {
        Some("PLAYING") => "playing",
        Some("PAUSED_PLAYBACK" | "PAUSED_RECORDING") => "paused",
        Some("TRANSITIONING") => "buffering",
        _ => "idle",
    };
    Ok(DlnaStatus {
        state: state.into(),
        position_seconds: element_text(&position, "RelTime")
            .and_then(|value| parse_upnp_time(&value))
            .unwrap_or(0.0) as f32,
        duration_seconds: element_text(&position, "TrackDuration")
            .and_then(|value| parse_upnp_time(&value))
            .map(|value| value as f32),
        volume: volume
            .and_then(|xml| element_text(&xml, "CurrentVolume"))
            .and_then(|value| value.parse::<f32>().ok())
            .map(|value| (value / 100.0).clamp(0.0, 1.0)),
        muted: muted
            .and_then(|xml| element_text(&xml, "CurrentMute"))
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
    })
}

pub async fn control(
    device: &DlnaDevice,
    action: &str,
    position_seconds: Option<f64>,
    volume: Option<f32>,
    muted: Option<bool>,
) -> Result<DlnaStatus, String> {
    match action {
        "play" => {
            soap_call(
                &device.av_transport,
                "Play",
                "<InstanceID>0</InstanceID><Speed>1</Speed>",
            )
            .await?;
        }
        "pause" => {
            soap_call(&device.av_transport, "Pause", "<InstanceID>0</InstanceID>").await?;
        }
        "seek" => seek(device, position_seconds.unwrap_or(0.0)).await?,
        "volume" => {
            let endpoint = device
                .rendering_control
                .as_ref()
                .ok_or_else(|| "This TV does not advertise DLNA volume control".to_string())?;
            if let Some(volume) = volume {
                let desired = (volume.clamp(0.0, 1.0) * 100.0).round() as u8;
                soap_call(
                    endpoint,
                    "SetVolume",
                    &format!("<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>{desired}</DesiredVolume>"),
                )
                .await?;
            }
            if let Some(muted) = muted {
                soap_call(
                    endpoint,
                    "SetMute",
                    &format!("<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>{}</DesiredMute>", u8::from(muted)),
                )
                .await?;
            }
        }
        "status" => {}
        "tracks" => return Err("DLNA receivers do not support remote subtitle switching".into()),
        _ => return Err("Unknown DLNA control action".into()),
    }
    status(device).await
}

pub async fn stop(device: &DlnaDevice) -> Result<(), String> {
    soap_call(&device.av_transport, "Stop", "<InstanceID>0</InstanceID>")
        .await
        .map(|_| ())
}

async fn seek(device: &DlnaDevice, position_seconds: f64) -> Result<(), String> {
    soap_call(
        &device.av_transport,
        "Seek",
        &format!(
            "<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>{}</Target>",
            format_upnp_time(position_seconds)
        ),
    )
    .await
    .map(|_| ())
}

async fn soap_call(
    endpoint: &ServiceEndpoint,
    action: &str,
    arguments: &str,
) -> Result<String, String> {
    let envelope = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:{action} xmlns:u=\"{}\">{arguments}</u:{action}></s:Body></s:Envelope>",
        endpoint.service_type
    );
    let response = Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|error| format!("Could not configure DLNA control: {error}"))?
        .post(endpoint.control_url.clone())
        .header(header::CONTENT_TYPE, "text/xml; charset=\"utf-8\"")
        .header(
            "SOAPACTION",
            format!("\"{}#{action}\"", endpoint.service_type),
        )
        .header(header::USER_AGENT, "Izumi/1.0 UPnP/1.1")
        .body(envelope)
        .send()
        .await
        .map_err(|error| format!("Could not contact the DLNA receiver: {error}"))?;
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_XML_BYTES as u64)
    {
        return Err("DLNA receiver returned an oversized response".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read the DLNA receiver response: {error}"))?;
    if bytes.len() > MAX_XML_BYTES {
        return Err("DLNA receiver returned an oversized response".into());
    }
    let body = String::from_utf8_lossy(&bytes).into_owned();
    if !status.is_success() {
        let detail = element_text(&body, "errorDescription")
            .or_else(|| element_text(&body, "faultstring"))
            .unwrap_or_else(|| status.to_string());
        return Err(format!("DLNA {action} failed: {detail}"));
    }
    Ok(body)
}

fn element_text(xml: &str, wanted: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut matching = false;
    loop {
        match reader.read_event().ok()? {
            Event::Start(element) => {
                matching = element.local_name().as_ref() == wanted.as_bytes();
            }
            Event::Text(text) if matching => {
                let decoded = text.xml_content().ok()?;
                return quick_xml::escape::unescape(&decoded)
                    .ok()
                    .map(|value| value.into_owned());
            }
            Event::End(_) => matching = false,
            Event::Eof => return None,
            _ => {}
        }
    }
}

fn xml_escape(value: &str) -> String {
    quick_xml::escape::escape(value).into_owned()
}

fn format_upnp_time(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    format!(
        "{:02}:{:02}:{:02}",
        total / 3600,
        (total % 3600) / 60,
        total % 60
    )
}

fn parse_upnp_time(value: &str) -> Option<f64> {
    if value.eq_ignore_ascii_case("NOT_IMPLEMENTED") {
        return None;
    }
    let mut parts = value.split(':');
    let hours = parts.next()?.parse::<f64>().ok()?;
    let minutes = parts.next()?.parse::<f64>().ok()?;
    let seconds = parts.next()?.parse::<f64>().ok()?;
    (parts.next().is_none() && minutes < 60.0 && seconds < 60.0)
        .then_some(hours * 3600.0 + minutes * 60.0 + seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DESCRIPTION: &str = r#"<?xml version="1.0"?>
      <root xmlns="urn:schemas-upnp-org:device-1-0">
        <device><friendlyName>[TV] Samsung Tizen TV</friendlyName>
          <manufacturer>Samsung Electronics</manufacturer><modelName>Tizen TV</modelName>
          <UDN>uuid:tv-123</UDN><serviceList>
            <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/upnp/control/avtransport1</controlURL></service>
            <service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/upnp/control/rendering1</controlURL></service>
          </serviceList></device>
      </root>"#;

    #[test]
    fn parses_renderer_description_and_resolves_control_urls() {
        let location = Url::parse("http://192.168.1.40:9197/dmr/description.xml").unwrap();
        let device = parse_device_description(
            DESCRIPTION.as_bytes(),
            &location,
            Ipv4Addr::new(192, 168, 1, 40),
        )
        .unwrap();
        assert_eq!(device.name, "[TV] Samsung Tizen TV");
        assert_eq!(device.manufacturer.as_deref(), Some("Samsung Electronics"));
        assert_eq!(
            device.av_transport.control_url.as_str(),
            "http://192.168.1.40:9197/upnp/control/avtransport1"
        );
        assert!(device.rendering_control.is_some());
    }

    #[test]
    fn parses_ssdp_headers_case_insensitively() {
        let response = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: http://192.168.1.40:9197/root.xml\r\n\r\n";
        assert_eq!(
            header_value(response, "location"),
            Some("http://192.168.1.40:9197/root.xml")
        );
    }

    #[test]
    fn formats_and_parses_upnp_clock_values() {
        assert_eq!(format_upnp_time(3661.4), "01:01:01");
        assert_eq!(parse_upnp_time("01:01:01.500"), Some(3661.5));
        assert_eq!(parse_upnp_time("NOT_IMPLEMENTED"), None);
    }

    #[test]
    fn reads_namespaced_soap_values() {
        let xml = "<s:Envelope><s:Body><u:GetPositionInfoResponse><TrackDuration>00:24:03</TrackDuration></u:GetPositionInfoResponse></s:Body></s:Envelope>";
        assert_eq!(
            element_text(xml, "TrackDuration").as_deref(),
            Some("00:24:03")
        );
    }

    #[test]
    fn uses_samsung_allshare_mime_aliases() {
        let location = Url::parse("http://192.168.1.40:9197/dmr").unwrap();
        let device = parse_device_description(
            DESCRIPTION.as_bytes(),
            &location,
            Ipv4Addr::new(192, 168, 1, 40),
        )
        .unwrap();
        assert_eq!(
            dlna_content_type(&device, "video/x-matroska"),
            "video/x-mkv"
        );
        assert_eq!(dlna_content_type(&device, "audio/flac"), "audio/x-flac");
        assert_eq!(
            dlna_content_type(&device, "video/mp4; charset=binary"),
            "video/mp4"
        );
    }

    #[test]
    fn adds_samsung_caption_metadata_and_media_query() {
        let subtitle = DlnaSubtitle {
            track_id: 2,
            url: "http://192.168.1.5:43100/cast/token/subtitle-1.srt",
        };
        let media_url = media_url_with_caption(
            "http://192.168.1.5:43100/cast/token/media",
            Some(subtitle.track_id),
        )
        .unwrap();
        let didl = didl_metadata(
            "Episode 1",
            "object.item.videoItem",
            "video/x-mkv",
            &media_url,
            Some(subtitle),
        );
        assert!(media_url.ends_with("?caption=2"));
        assert!(didl.contains("xmlns:sec=\"http://www.sec.co.kr/\""));
        assert!(didl.contains("protocolInfo=\"http-get:*:text/srt:*\""));
        assert!(didl.contains("<sec:CaptionInfoEx sec:type=\"srt\">"));
        assert!(didl.contains("media?caption=2"));
    }
}
