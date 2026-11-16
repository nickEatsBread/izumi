//! Browser sign-in for plugins with the `signin` permission (src/lib/plugins/host.ts). A plugin
//! signs in through the viewer's own browser, the way native apps do (RFC 8252): izumi listens on a
//! free loopback port, the plugin puts `http://127.0.0.1:<port><path>` in its authorize URL as the
//! redirect, and the provider's redirect comes back here. The listener answers that one request,
//! hands its query string to the plugin, and closes. The plugin checks `state` and does the rest.

use std::{
    collections::HashMap,
    net::{Ipv4Addr, Ipv6Addr},
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
};

const WAIT: Duration = Duration::from_secs(600);
const MAX_PENDING: usize = 8;
const PAGE: &str = "<!doctype html><meta charset=utf-8><title>izumi</title>\
<body style=\"font:16px system-ui;margin:3rem;text-align:center\"><p>You can close this tab and go back to izumi.</p>";

struct Pending {
    answer: Option<oneshot::Receiver<String>>,
    task: tauri::async_runtime::JoinHandle<()>,
}

static PENDING: LazyLock<Mutex<HashMap<u16, Pending>>> = LazyLock::new(Default::default);

/// The query string of a `GET <path>?<query>` request head, or None for any other request.
fn callback_query(head: &str, path: &str) -> Option<String> {
    let target = head.lines().next()?.strip_prefix("GET ")?.split(' ').next()?;
    let (route, query) = target.split_once('?').unwrap_or((target, ""));
    (route == path).then(|| query.to_string())
}

async fn answer(mut stream: TcpStream, path: &str) -> Option<String> {
    let mut head = Vec::new();
    let mut buf = [0u8; 2048];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") && head.len() < 16 * 1024 {
        match tokio::time::timeout(Duration::from_secs(10), stream.read(&mut buf)).await {
            Ok(Ok(n)) if n > 0 => head.extend_from_slice(&buf[..n]),
            _ => return None,
        }
    }
    let query = callback_query(&String::from_utf8_lossy(&head), path);
    let (status, body) = if query.is_some() { ("200 OK", PAGE) } else { ("404 Not Found", "") };
    let reply = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(reply.as_bytes()).await;
    let _ = stream.shutdown().await;
    query
}

async fn accept(listener: &Option<TcpListener>) -> std::io::Result<TcpStream> {
    match listener {
        Some(listener) => listener.accept().await.map(|(stream, _)| stream),
        None => std::future::pending().await,
    }
}

async fn serve(v4: TcpListener, v6: Option<TcpListener>, path: String, sender: oneshot::Sender<String>) {
    let v4 = Some(v4);
    let deadline = tokio::time::sleep(WAIT);
    tokio::pin!(deadline);
    let (found, mut answers) = tokio::sync::mpsc::channel::<String>(1);
    loop {
        let stream = tokio::select! {
            _ = &mut deadline => return,
            Some(query) = answers.recv() => {
                let _ = sender.send(query);
                return;
            }
            stream = accept(&v4) => stream,
            stream = accept(&v6) => stream,
        };
        // Each connection on its own: a browser's idle preconnect must not hold up the redirect.
        // Anything but the callback (such as /favicon.ico) gets a 404.
        if let Ok(stream) = stream {
            let (found, path) = (found.clone(), path.clone());
            tauri::async_runtime::spawn(async move {
                if let Some(query) = answer(stream, &path).await {
                    let _ = found.send(query).await;
                }
            });
        }
    }
}

/// Starts listening for one redirect to `path` on a free loopback port, and returns the port. A
/// `localhost` redirect also works: the same port on ::1 is taken when it is free.
#[tauri::command]
pub async fn plugin_signin_listen(path: String) -> Result<u16, String> {
    if !path.starts_with('/') || path.len() > 100 || !path.bytes().all(|b| b.is_ascii_alphanumeric() || b"/-_.".contains(&b)) {
        return Err("invalid callback path".into());
    }
    if PENDING.lock().unwrap().len() >= MAX_PENDING {
        return Err("too many sign-ins at once".into());
    }
    let v4 = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.map_err(|e| e.to_string())?;
    let port = v4.local_addr().map_err(|e| e.to_string())?.port();
    let v6 = TcpListener::bind((Ipv6Addr::LOCALHOST, port)).await.ok();
    let (sender, answer) = oneshot::channel();
    let task = tauri::async_runtime::spawn(serve(v4, v6, path, sender));
    PENDING.lock().unwrap().insert(port, Pending { answer: Some(answer), task });
    Ok(port)
}

/// Waits for the redirect on `port` and returns its query string (without the `?`).
#[tauri::command]
pub async fn plugin_signin_wait(port: u16) -> Result<String, String> {
    let answer = PENDING.lock().unwrap().get_mut(&port).and_then(|p| p.answer.take()).ok_or("no sign-in is waiting")?;
    let result = answer.await.map_err(|_| "sign-in timed out or was cancelled".to_string());
    PENDING.lock().unwrap().remove(&port);
    result
}

/// Stops listening on `port`; a `plugin_signin_wait` on it fails.
#[tauri::command]
pub fn plugin_signin_cancel(port: u16) {
    if let Some(pending) = PENDING.lock().unwrap().remove(&port) {
        pending.task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_callback_query_and_nothing_else() {
        let head = "GET /auth/callback?code=a%2Bb&state=x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(callback_query(head, "/auth/callback").as_deref(), Some("code=a%2Bb&state=x"));
        assert_eq!(callback_query("GET /auth/callback HTTP/1.1\r\n\r\n", "/auth/callback").as_deref(), Some(""));
        assert_eq!(callback_query("GET /favicon.ico HTTP/1.1\r\n\r\n", "/auth/callback"), None);
        assert_eq!(callback_query("GET /auth/callback-other?code=1 HTTP/1.1\r\n\r\n", "/auth/callback"), None);
        assert_eq!(callback_query("POST /auth/callback?code=1 HTTP/1.1\r\n\r\n", "/auth/callback"), None);
    }

    #[tokio::test]
    async fn hands_back_the_redirect_after_other_requests() {
        let port = plugin_signin_listen("/callback".into()).await.unwrap();
        let get = |target: &'static str| async move {
            let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await.unwrap();
            stream.write_all(format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes()).await.unwrap();
            let mut reply = String::new();
            stream.read_to_string(&mut reply).await.unwrap();
            reply
        };
        // An idle connection, like a browser's preconnect, doesn't hold up the others.
        let _idle = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await.unwrap();
        assert!(get("/favicon.ico").await.starts_with("HTTP/1.1 404"));
        assert!(get("/callback?code=abc&state=s1").await.starts_with("HTTP/1.1 200"));
        assert_eq!(plugin_signin_wait(port).await.unwrap(), "code=abc&state=s1");
        assert!(plugin_signin_wait(port).await.is_err());
    }

    #[tokio::test]
    async fn cancel_ends_the_wait() {
        let port = plugin_signin_listen("/callback".into()).await.unwrap();
        plugin_signin_cancel(port);
        assert!(plugin_signin_wait(port).await.is_err());
        assert!(plugin_signin_listen("no-slash".into()).await.is_err());
    }
}
