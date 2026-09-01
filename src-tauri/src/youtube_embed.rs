//! Loopback document for YouTube embeds inside desktop WebViews with a non-HTTP app origin.
//!
//! WKWebView does not send an HTTP Referer when Izumi's `tauri://localhost` document embeds
//! YouTube directly. YouTube rejects that request with player error 153. Loading a tiny document
//! from this loopback-only server gives the nested player a normal HTTP embedding origin while the
//! message bridge preserves the IFrame Player API used by hover previews.

use std::{net::Ipv4Addr, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use serde::Deserialize;
use tokio::{net::TcpListener, sync::OnceCell};

static SERVER: OnceCell<Arc<YoutubeEmbedServer>> = OnceCell::const_new();

struct YoutubeEmbedServer {
    port: u16,
    token: String,
}

#[derive(Clone)]
struct EmbedState {
    token: String,
}

#[derive(Deserialize)]
struct EmbedQuery {
    id: String,
    app: String,
    controls: Option<u8>,
    muted: Option<u8>,
}

const EMBED_HTML: &str = r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>YouTube trailer</title>
  <style>html,body,iframe{width:100%;height:100%;margin:0;border:0;background:#000;overflow:hidden}</style>
</head>
<body>
  <iframe id="player" title="YouTube trailer" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>
  <script>
    (() => {
      const params = new URLSearchParams(location.search)
      const id = params.get('id') || ''
      const appId = params.get('app') || ''
      const controls = params.get('controls') === '1' ? '1' : '0'
      const muted = params.get('muted') === '1' ? '1' : '0'
      const player = document.getElementById('player')
      const youtubeOrigin = 'https://www.youtube-nocookie.com'
      const playerParams = new URLSearchParams({
        enablejsapi: '1', autoplay: '1', controls, mute: muted,
        disablekb: controls === '1' ? '0' : '1',
        cc_lang_pref: 'ja', iv_load_policy: '3', playsinline: '1', rel: '0',
        origin: location.origin,
        widget_referrer: `https://${appId}`,
      })
      player.src = `${youtubeOrigin}/embed/${encodeURIComponent(id)}?${playerParams}`

      window.addEventListener('message', (event) => {
        if (event.source === player.contentWindow &&
            (event.origin === youtubeOrigin || event.origin === 'https://www.youtube.com')) {
          parent.postMessage({ type: 'izumi-youtube-event', payload: event.data }, '*')
          return
        }
        if (event.source === parent && event.data?.type === 'izumi-youtube-command' &&
            typeof event.data.payload === 'string') {
          player.contentWindow?.postMessage(event.data.payload, youtubeOrigin)
        }
      })
    })()
  </script>
</body>
</html>"#;

fn valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn valid_app_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 255
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(data_encoding::HEXLOWER.encode(&bytes))
}

async fn embed_document(
    State(state): State<EmbedState>,
    Path(token): Path<String>,
    Query(query): Query<EmbedQuery>,
) -> Response {
    if token != state.token
        || !valid_video_id(&query.id)
        || !valid_app_id(&query.app)
        || query.controls.unwrap_or(0) > 1
        || query.muted.unwrap_or(1) > 1
    {
        return StatusCode::NOT_FOUND.into_response();
    }

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'none'; frame-src https://www.youtube-nocookie.com https://www.youtube.com; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        ),
    );
    (headers, EMBED_HTML).into_response()
}

async fn start_server() -> Result<Arc<YoutubeEmbedServer>, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|error| format!("Could not start the YouTube embed bridge: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not inspect the YouTube embed bridge: {error}"))?
        .port();
    let token = random_token()?;
    let state = EmbedState {
        token: token.clone(),
    };

    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/{token}/youtube", get(embed_document))
            .with_state(state);
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("YouTube embed bridge stopped: {error:#}");
        }
    });

    Ok(Arc::new(YoutubeEmbedServer { port, token }))
}

#[tauri::command]
pub async fn youtube_embed_url(
    app: tauri::AppHandle,
    id: String,
    controls: bool,
    muted: bool,
) -> Result<String, String> {
    if !valid_video_id(&id) {
        return Err("Invalid YouTube video ID".into());
    }
    let server = SERVER.get_or_try_init(start_server).await?;
    let app_id = &app.config().identifier;
    if !valid_app_id(app_id) {
        return Err("Invalid application identifier".into());
    }
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("id", &id)
        .append_pair("app", app_id)
        .append_pair("controls", if controls { "1" } else { "0" })
        .append_pair("muted", if muted { "1" } else { "0" })
        .finish();
    Ok(format!(
        "http://127.0.0.1:{}/{}/youtube?{query}",
        server.port, server.token,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_canonical_youtube_video_ids() {
        assert!(valid_video_id("M7lc1UVf-VE"));
        assert!(valid_video_id("abc_DEF-123"));
        assert!(!valid_video_id("too-short"));
        assert!(!valid_video_id("invalid/id!"));
        assert!(valid_app_id("com.nicho.izumi"));
        assert!(!valid_app_id("https://com.nicho.izumi"));
    }

    #[test]
    fn bridge_identifies_its_http_origin_and_relays_player_messages() {
        assert!(EMBED_HTML.contains("strict-origin-when-cross-origin"));
        assert!(EMBED_HTML.contains("origin: location.origin"));
        assert!(EMBED_HTML.contains("widget_referrer: `https://${appId}`"));
        assert!(EMBED_HTML.contains("type: 'izumi-youtube-event'"));
        assert!(EMBED_HTML.contains("event.data?.type === 'izumi-youtube-command'"));
    }

    #[tokio::test]
    async fn serves_a_token_scoped_no_store_document() {
        let server = start_server().await.expect("bridge server");
        let url = format!(
            "http://127.0.0.1:{}/{}/youtube?id=M7lc1UVf-VE&app=com.nicho.izumi&controls=0&muted=1",
            server.port, server.token,
        );
        let response = reqwest::get(url).await.expect("bridge response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        assert!(response
            .text()
            .await
            .unwrap()
            .contains("youtube-nocookie.com"));
    }
}
