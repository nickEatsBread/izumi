//! Lifecycle bounds for the in-memory HTTP bridge.
//!
//! Downloads deliberately do not use this module: they stream directly to disk and have their
//! own cooperative cancellation/read-idle policy. These controls are for responses materialized
//! into IPC strings (`http_get`, `http_post`, and `ext_fetch`).

use futures_util::StreamExt;
use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::sync::{watch, Semaphore};

const GLOBAL_CONCURRENCY: usize = 12;
const EXTENSION_CONCURRENCY: usize = 6;

static GLOBAL_GATE: OnceLock<Arc<Semaphore>> = OnceLock::new();
static EXTENSION_GATE: OnceLock<Arc<Semaphore>> = OnceLock::new();
static ACTIVE: OnceLock<Mutex<HashMap<String, watch::Sender<bool>>>> = OnceLock::new();

#[derive(Clone, Copy)]
pub(crate) enum RequestClass {
    Metadata,
    Extension,
}

fn global_gate() -> Arc<Semaphore> {
    GLOBAL_GATE
        .get_or_init(|| Arc::new(Semaphore::new(GLOBAL_CONCURRENCY)))
        .clone()
}

fn extension_gate() -> Arc<Semaphore> {
    EXTENSION_GATE
        .get_or_init(|| Arc::new(Semaphore::new(EXTENSION_CONCURRENCY)))
        .clone()
}

fn active() -> &'static Mutex<HashMap<String, watch::Sender<bool>>> {
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

struct Registration {
    id: Option<String>,
}

impl Registration {
    fn new(id: Option<String>) -> Result<(Self, watch::Receiver<bool>), String> {
        let (sender, receiver) = watch::channel(false);
        if let Some(id) = id.as_ref() {
            let mut requests = active().lock().unwrap();
            if requests.contains_key(id) {
                return Err("duplicate request id".into());
            }
            requests.insert(id.clone(), sender);
        }
        Ok((Self { id }, receiver))
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        if let Some(id) = self.id.as_ref() {
            active().lock().unwrap().remove(id);
        }
    }
}

async fn cancelled(receiver: &mut watch::Receiver<bool>) {
    if *receiver.borrow() {
        return;
    }
    while receiver.changed().await.is_ok() {
        if *receiver.borrow() {
            return;
        }
    }
}

/// Run one materialized request behind the shared gates, with a whole-operation deadline and
/// optional cancellation ID. Dropping `work` cancels reqwest's in-flight future.
pub(crate) async fn run<T, F>(
    request_id: Option<String>,
    timeout: Duration,
    class: RequestClass,
    work: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    let (_registration, mut cancel) = Registration::new(request_id)?;
    let guarded = async move {
        let _global = global_gate()
            .acquire_owned()
            .await
            .map_err(|_| "request gate closed".to_string())?;
        let _extension = match class {
            RequestClass::Metadata => None,
            RequestClass::Extension => Some(
                extension_gate()
                    .acquire_owned()
                    .await
                    .map_err(|_| "extension request gate closed".to_string())?,
            ),
        };
        work.await
    };

    tokio::select! {
        _ = cancelled(&mut cancel) => Err("request cancelled".into()),
        result = tokio::time::timeout(timeout, guarded) => {
            result.map_err(|_| "request timed out".to_string())?
        }
    }
}

/// Signal an in-flight request. Returns false when it already completed or never existed.
pub(crate) fn cancel(request_id: &str) -> bool {
    active()
        .lock()
        .unwrap()
        .get(request_id)
        .map(|sender| sender.send(true).is_ok())
        .unwrap_or(false)
}

pub(crate) fn timeout_ms(value: Option<u64>, default_ms: u64) -> Duration {
    Duration::from_millis(value.unwrap_or(default_ms).clamp(1_000, 60_000))
}

pub(crate) fn body_limit(value: Option<u64>, default: usize, hard_max: usize) -> usize {
    value
        .and_then(|n| usize::try_from(n).ok())
        .unwrap_or(default)
        .clamp(1_024, hard_max)
}

fn response_charset(content_type: Option<&str>) -> &'static encoding_rs::Encoding {
    let label = content_type.and_then(|value| {
        value.split(';').skip(1).find_map(|part| {
            let (name, value) = part.trim().split_once('=')?;
            name.eq_ignore_ascii_case("charset")
                .then(|| value.trim().trim_matches(['"', '\'']))
        })
    });
    label
        .and_then(|value| encoding_rs::Encoding::for_label(value.as_bytes()))
        .unwrap_or(encoding_rs::UTF_8)
}

pub(crate) async fn read_limited_text(
    response: reqwest::Response,
    max_bytes: usize,
) -> Result<String, String> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(format!("response exceeds {max_bytes} byte limit"));
    }
    let encoding = response_charset(
        response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
    );
    let mut bytes =
        Vec::with_capacity(response.content_length().unwrap_or(0).min(max_bytes as u64) as usize);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "read failed".to_string())?;
        push_limited(&mut bytes, &chunk, max_bytes)?;
    }
    let (text, _, _) = encoding.decode(&bytes);
    Ok(text.into_owned())
}

fn push_limited(bytes: &mut Vec<u8>, chunk: &[u8], max_bytes: usize) -> Result<(), String> {
    if bytes.len().saturating_add(chunk.len()) > max_bytes {
        return Err(format!("response exceeds {max_bytes} byte limit"));
    }
    bytes.extend_from_slice(chunk);
    Ok(())
}

#[cfg(test)]
fn is_active(id: &str) -> bool {
    active().lock().unwrap().contains_key(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_limits_with_defaults_and_hard_caps() {
        assert_eq!(body_limit(None, 4_096, 8_192), 4_096);
        assert_eq!(body_limit(Some(512), 4_096, 8_192), 1_024);
        assert_eq!(body_limit(Some(99_999), 4_096, 8_192), 8_192);
    }

    #[test]
    fn parses_declared_response_charset() {
        assert_eq!(
            response_charset(Some("text/html; charset=shift_jis")),
            encoding_rs::SHIFT_JIS
        );
        assert_eq!(
            response_charset(Some("application/json")),
            encoding_rs::UTF_8
        );
    }

    #[test]
    fn rejects_the_chunk_that_crosses_the_body_limit() {
        let mut bytes = b"1234".to_vec();
        push_limited(&mut bytes, b"56", 5).unwrap_err();
        assert_eq!(bytes, b"1234");
        push_limited(&mut bytes, b"5", 5).unwrap();
        assert_eq!(bytes, b"12345");
    }

    #[tokio::test]
    async fn timeout_cleans_active_request() {
        let result = run(
            Some("timeout-test".into()),
            Duration::from_millis(5),
            RequestClass::Metadata,
            std::future::pending::<Result<(), String>>(),
        )
        .await;
        assert_eq!(result.unwrap_err(), "request timed out");
        assert!(!is_active("timeout-test"));
    }

    #[tokio::test]
    async fn cancellation_stops_and_cleans_active_request() {
        let task = tokio::spawn(run(
            Some("cancel-test".into()),
            Duration::from_secs(1),
            RequestClass::Metadata,
            std::future::pending::<Result<(), String>>(),
        ));
        tokio::task::yield_now().await;
        assert!(cancel("cancel-test"));
        assert_eq!(task.await.unwrap().unwrap_err(), "request cancelled");
        assert!(!is_active("cancel-test"));
        assert!(!cancel("cancel-test"));
    }
}
