use std::{
    collections::HashMap,
    net::Ipv4Addr,
    sync::{Arc, RwLock},
};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::OnceCell,
};
use url::Url;

const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const MAX_PLAYLISTS: usize = 32;

static PROXY: OnceCell<Arc<HlsRepairProxy>> = OnceCell::const_new();

struct HlsRepairProxy {
    port: u16,
    playlists: RwLock<HashMap<String, Arc<Playlist>>>,
}

struct Playlist {
    headers: HashMap<String, String>,
    resources: RwLock<HashMap<String, String>>,
}

/// Route Anikoto's kotocdn HLS transport through a tiny local repair server.
///
/// The provider prepends a valid 1x1 PNG to each MPEG-TS segment. Its bundled Android/JVM
/// decoder mistakes every subsequent 188-byte TS packet for another junk block and deletes it,
/// while the direct HD links hand the disguised PNG straight to mpv. We bypass both broken paths:
/// fetch the upstream playlist with its provider headers, rewrite its resources to localhost, and
/// remove only the bytes before the first trustworthy MPEG-TS packet alignment.
pub(crate) async fn prepare_playback_url(
    value: &str,
    headers: Option<&HashMap<String, String>>,
) -> Result<String, String> {
    let Some(upstream) = kotocdn_upstream(value) else {
        return Ok(value.to_string());
    };

    let proxy = PROXY
        .get_or_try_init(start_proxy)
        .await
        .map_err(|error| format!("could not start the local HLS repair proxy: {error}"))?;
    Ok(proxy.register(upstream, provider_headers(headers)))
}

/// Give mpv a stable localhost URL for a remote subtitle sidecar.
///
/// Some providers return perfectly valid VTT files that reject a direct request unless it carries
/// the video embed's Origin/Referer/User-Agent. mpv has only one global header set and failures from
/// `sub-add` are otherwise silent, so fetch the sidecar through the same tiny proxy used by repaired
/// HLS. Non-HTTP values (notably JVM-created temporary `file:` subtitles) stay untouched.
pub(crate) async fn prepare_sidecar_url(
    value: &str,
    headers: Option<&HashMap<String, String>>,
) -> Result<String, String> {
    let Some(upstream) = sidecar_upstream(value) else {
        return Ok(value.to_string());
    };
    let resource = sidecar_resource(&upstream);
    let proxy = PROXY
        .get_or_try_init(start_proxy)
        .await
        .map_err(|error| format!("could not start the local media proxy: {error}"))?;
    Ok(proxy.register_as(upstream, headers.cloned().unwrap_or_default(), resource))
}

fn kotocdn_upstream(value: &str) -> Option<Url> {
    let outer = Url::parse(value).ok()?;
    if is_kotocdn(&outer) {
        return Some(outer);
    }

    if !matches!(outer.host_str(), Some("localhost" | "127.0.0.1" | "::1")) {
        return None;
    }
    let nested = outer.query_pairs().find_map(|(key, value)| {
        (key == "url")
            .then(|| Url::parse(value.as_ref()).ok())
            .flatten()
    })?;
    is_kotocdn(&nested).then_some(nested)
}

fn sidecar_upstream(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    matches!(url.scheme(), "http" | "https").then_some(url)
}

fn sidecar_resource(url: &Url) -> &'static str {
    match url
        .path_segments()
        .and_then(|segments| segments.last())
        .and_then(|name| name.rsplit_once('.'))
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("ass") => "subtitle.ass",
        Some("ssa") => "subtitle.ssa",
        Some("srt") => "subtitle.srt",
        Some("ttml") | Some("xml") => "subtitle.ttml",
        _ => "subtitle.vtt",
    }
}

fn is_kotocdn(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|host| host == "kotocdn.site" || host.ends_with(".kotocdn.site"))
}

fn provider_headers(headers: Option<&HashMap<String, String>>) -> HashMap<String, String> {
    let mut result = headers.cloned().unwrap_or_default();
    insert_header_if_missing(&mut result, "Origin", "https://megaplay.buzz");
    insert_header_if_missing(&mut result, "Referer", "https://megaplay.buzz/");
    insert_header_if_missing(
        &mut result,
        "User-Agent",
        "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 \
         (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    );
    result
}

fn insert_header_if_missing(headers: &mut HashMap<String, String>, name: &str, value: &str) {
    if !headers.keys().any(|key| key.eq_ignore_ascii_case(name)) {
        headers.insert(name.to_string(), value.to_string());
    }
}

async fn start_proxy() -> Result<Arc<HlsRepairProxy>, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let proxy = Arc::new(HlsRepairProxy {
        port,
        playlists: RwLock::new(HashMap::new()),
    });
    let server = Arc::clone(&proxy);
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let server = Arc::clone(&server);
            tokio::spawn(async move {
                let _ = server.handle(stream).await;
            });
        }
    });
    Ok(proxy)
}

impl HlsRepairProxy {
    fn register(&self, upstream: Url, headers: HashMap<String, String>) -> String {
        self.register_as(upstream, headers, "root")
    }

    fn register_as(
        &self,
        upstream: Url,
        headers: HashMap<String, String>,
        resource: &str,
    ) -> String {
        let token = playlist_token(upstream.as_str(), &headers);
        let mut playlists = self.playlists.write().unwrap();
        if let Some(playlist) = playlists.get(&token) {
            playlist
                .resources
                .write()
                .unwrap()
                .insert(resource.to_string(), upstream.to_string());
            return self.local_url(&token, resource);
        }
        if playlists.len() >= MAX_PLAYLISTS && !playlists.contains_key(&token) {
            if let Some(oldest) = playlists.keys().next().cloned() {
                playlists.remove(&oldest);
            }
        }
        let playlist = Arc::new(Playlist {
            headers,
            resources: RwLock::new(HashMap::from([(
                resource.to_string(),
                upstream.to_string(),
            )])),
        });
        playlists.insert(token.clone(), playlist);
        self.local_url(&token, resource)
    }

    fn local_url(&self, token: &str, resource: &str) -> String {
        format!("http://127.0.0.1:{}/hls/{token}/{resource}", self.port)
    }

    async fn handle(&self, mut stream: TcpStream) -> Result<(), String> {
        let request = read_request(&mut stream).await?;
        let Some((method, path)) = parse_request_line(&request) else {
            return write_error(&mut stream, 400, "Bad Request", "invalid HTTP request").await;
        };
        if method != "GET" && method != "HEAD" {
            return write_error(&mut stream, 405, "Method Not Allowed", "GET only").await;
        }

        let Some((token, resource)) = parse_route(path) else {
            return write_error(&mut stream, 404, "Not Found", "unknown HLS resource").await;
        };
        let playlist = { self.playlists.read().unwrap().get(token).cloned() };
        let Some(playlist) = playlist else {
            return write_error(&mut stream, 404, "Not Found", "expired HLS playlist").await;
        };
        let upstream = playlist.resources.read().unwrap().get(resource).cloned();
        let Some(upstream) = upstream else {
            return write_error(&mut stream, 404, "Not Found", "unknown HLS resource").await;
        };

        match self.fetch(token, &playlist, &upstream).await {
            Ok((body, content_type)) => {
                write_response(
                    &mut stream,
                    200,
                    "OK",
                    &content_type,
                    &body,
                    method == "HEAD",
                )
                .await
            }
            Err(error) => write_error(&mut stream, 502, "Bad Gateway", &error).await,
        }
    }

    async fn fetch(
        &self,
        token: &str,
        playlist: &Playlist,
        upstream: &str,
    ) -> Result<(Vec<u8>, String), String> {
        let mut request = crate::ext_http_client().get(upstream);
        for (name, value) in &playlist.headers {
            let Ok(name) = reqwest::header::HeaderName::from_bytes(name.as_bytes()) else {
                continue;
            };
            let Ok(value) = reqwest::header::HeaderValue::from_str(value) else {
                continue;
            };
            request = request.header(name, value);
        }
        let response = request.send().await.map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "upstream returned HTTP {} for {upstream}",
                response.status()
            ));
        }
        let final_url = response.url().clone();
        let upstream_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let body = response
            .bytes()
            .await
            .map_err(|error| error.to_string())?
            .to_vec();

        if looks_like_playlist(&body) {
            let text = String::from_utf8(body)
                .map_err(|_| "upstream HLS playlist was not UTF-8".to_string())?;
            let rewritten = self.rewrite_playlist(token, playlist, &final_url, &text)?;
            return Ok((
                rewritten.into_bytes(),
                "application/vnd.apple.mpegurl".to_string(),
            ));
        }

        if looks_like_webvtt(&body) {
            return Ok((body, "text/vtt; charset=utf-8".to_string()));
        }

        if body.starts_with(PNG_SIGNATURE) {
            let offset = transport_stream_offset(&body).ok_or_else(|| {
                "provider returned a PNG wrapper without an MPEG-TS payload".to_string()
            })?;
            return Ok((body[offset..].to_vec(), "video/mp2t".to_string()));
        }

        Ok((body, upstream_type))
    }

    fn rewrite_playlist(
        &self,
        token: &str,
        playlist: &Playlist,
        base: &Url,
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
                    self.register_resource(token, playlist, base, uri)
                })?
            } else if content.trim().is_empty() {
                content.to_string()
            } else {
                self.register_resource(token, playlist, base, content.trim())?
            };
            output.push_str(&rewritten);
            output.push_str(ending);
        }
        Ok(output)
    }

    fn register_resource(
        &self,
        token: &str,
        playlist: &Playlist,
        base: &Url,
        value: &str,
    ) -> Result<String, String> {
        let resolved = base
            .join(value)
            .map_err(|error| format!("invalid HLS resource URL {value:?}: {error}"))?;
        let resource = blake3::hash(resolved.as_str().as_bytes())
            .to_hex()
            .to_string();
        playlist
            .resources
            .write()
            .unwrap()
            .insert(resource.clone(), resolved.to_string());
        Ok(self.local_url(token, &resource))
    }
}

fn playlist_token(upstream: &str, headers: &HashMap<String, String>) -> String {
    let mut pairs: Vec<_> = headers.iter().collect();
    pairs.sort_by(|(left, _), (right, _)| left.to_lowercase().cmp(&right.to_lowercase()));
    let mut hasher = blake3::Hasher::new();
    hasher.update(upstream.as_bytes());
    for (name, value) in pairs {
        hasher.update(name.to_lowercase().as_bytes());
        hasher.update(b":");
        hasher.update(value.as_bytes());
        hasher.update(b"\n");
    }
    hasher.finalize().to_hex().to_string()
}

fn looks_like_playlist(body: &[u8]) -> bool {
    body.iter()
        .copied()
        .skip_while(u8::is_ascii_whitespace)
        .take(7)
        .eq(b"#EXTM3U".iter().copied())
}

fn looks_like_webvtt(body: &[u8]) -> bool {
    body.strip_prefix(b"\xef\xbb\xbf")
        .unwrap_or(body)
        .starts_with(b"WEBVTT")
}

fn transport_stream_offset(body: &[u8]) -> Option<usize> {
    const PACKET: usize = 188;
    const CHECKS: usize = 5;
    if body.len() < PACKET * CHECKS {
        return None;
    }
    (0..=body.len() - PACKET * CHECKS).find(|offset| {
        (body.len() - offset) % PACKET == 0
            && (0..CHECKS).all(|packet| body[offset + packet * PACKET] == 0x47)
    })
}

fn rewrite_uri_attributes(
    line: &str,
    mut register: impl FnMut(&str) -> Result<String, String>,
) -> Result<String, String> {
    let mut output = String::with_capacity(line.len());
    let mut remaining = line;
    while let Some(start) = remaining.find("URI=\"") {
        let value_start = start + 5;
        let Some(value_end) = remaining[value_start..].find('"') else {
            break;
        };
        let value_end = value_start + value_end;
        output.push_str(&remaining[..value_start]);
        output.push_str(&register(&remaining[value_start..value_end])?);
        remaining = &remaining[value_end..];
    }
    output.push_str(remaining);
    Ok(output)
}

async fn read_request(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    while request.len() < MAX_REQUEST_BYTES {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..read]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            return Ok(request);
        }
    }
    Err("HTTP request was incomplete or too large".to_string())
}

fn parse_request_line(request: &[u8]) -> Option<(&str, &str)> {
    let line_end = request.windows(2).position(|window| window == b"\r\n")?;
    let line = std::str::from_utf8(&request[..line_end]).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?;
    let path = parts.next()?;
    parts.next()?;
    Some((method, path))
}

fn parse_route(path: &str) -> Option<(&str, &str)> {
    let path = path.split('?').next()?;
    let mut parts = path.trim_start_matches('/').split('/');
    (parts.next()? == "hls").then_some(())?;
    let token = parts.next()?;
    let resource = parts.next()?;
    (parts.next().is_none() && !token.is_empty() && !resource.is_empty())
        .then_some((token, resource))
}

async fn write_error(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    message: &str,
) -> Result<(), String> {
    write_response(
        stream,
        status,
        reason,
        "text/plain; charset=utf-8",
        message.as_bytes(),
        false,
    )
    .await
}

async fn write_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &[u8],
    head_only: bool,
) -> Result<(), String> {
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(headers.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    if !head_only {
        stream
            .write_all(body)
            .await
            .map_err(|error| error.to_string())?;
    }
    stream.shutdown().await.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_transport_stream() -> Vec<u8> {
        let mut stream = vec![0_u8; 188 * 6];
        for packet in 0..6 {
            stream[packet * 188] = 0x47;
            stream[packet * 188 + 1..(packet + 1) * 188].fill(packet as u8 + 1);
        }
        // These signatures are payload and must never be treated as removable junk blocks.
        stream[188 + 40..188 + 48].copy_from_slice(PNG_SIGNATURE);
        stream[188 * 3 + 80..188 * 3 + 84].copy_from_slice(b"RIFF");
        stream
    }

    #[test]
    fn unwraps_only_the_png_prefix() {
        let stream = fake_transport_stream();
        let mut disguised = vec![0_u8; 252];
        disguised[..PNG_SIGNATURE.len()].copy_from_slice(PNG_SIGNATURE);
        disguised.extend_from_slice(&stream);

        let offset = transport_stream_offset(&disguised).unwrap();
        assert_eq!(offset, 252);
        assert_eq!(&disguised[offset..], stream);
    }

    #[test]
    fn leaves_plain_transport_stream_at_zero() {
        assert_eq!(transport_stream_offset(&fake_transport_stream()), Some(0));
    }

    #[test]
    fn unwraps_direct_and_loopback_kotocdn_urls() {
        let direct = "https://megap.kotocdn.site/a/index.m3u8";
        assert_eq!(kotocdn_upstream(direct).unwrap().as_str(), direct);

        let loopback =
            "http://localhost:52610/m3u8?url=https%3A%2F%2Fvidtub.kotocdn.site%2Fb%2F720.m3u8";
        assert_eq!(
            kotocdn_upstream(loopback).unwrap().as_str(),
            "https://vidtub.kotocdn.site/b/720.m3u8"
        );
        assert!(kotocdn_upstream("https://cdn.example/x.m3u8").is_none());
    }

    #[test]
    fn proxies_remote_sidecars_but_keeps_runtime_files_local() {
        let vtt = sidecar_upstream("https://subs.example/english.vtt").unwrap();
        assert_eq!(vtt.as_str(), "https://subs.example/english.vtt");
        assert_eq!(sidecar_resource(&vtt), "subtitle.vtt");
        assert_eq!(
            sidecar_resource(&Url::parse("https://subs.example/english.ass").unwrap()),
            "subtitle.ass"
        );
        assert!(sidecar_upstream("file:///tmp/decrypted.srt").is_none());
        assert!(sidecar_upstream("not a url").is_none());
    }

    #[test]
    fn recognizes_webvtt_served_as_generic_binary_data() {
        assert!(looks_like_webvtt(b"WEBVTT\r\n\r\n00:00.000 --> 00:01.000"));
        assert!(looks_like_webvtt(
            b"\xef\xbb\xbfWEBVTT\n\n00:00.000 --> 00:01.000"
        ));
        assert!(!looks_like_webvtt(b"1\n00:00:00,000 --> 00:00:01,000"));
    }

    #[test]
    fn rewrites_hls_uri_attributes_without_touching_other_fields() {
        let line = r#"#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1234"#;
        let rewritten = rewrite_uri_attributes(line, |value| Ok(format!("local/{value}"))).unwrap();
        assert_eq!(
            rewritten,
            r#"#EXT-X-KEY:METHOD=AES-128,URI="local/key.bin",IV=0x1234"#
        );
    }
}
