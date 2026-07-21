//! Ephemeral Watch Together transport.
//!
//! Rooms deliberately do not use the persistent device-sync document. A room
//! owns a short-lived Iroh endpoint and exchanges only watch-party JSON state.

use std::{
    collections::HashMap,
    fmt,
    str::FromStr,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use iroh::{
    endpoint::Connection,
    protocol::{AcceptError, ProtocolHandler, Router},
    Endpoint, RelayMode, RelayUrl, SecretKey,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    sync::Mutex,
};

const WATCH_ALPN: &[u8] = b"/izumi/watch-room/1";
const MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;
const LIVE_PARTICIPANT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Default)]
pub struct WatchRoomState {
    inner: Mutex<Option<WatchRoomRuntime>>,
}

struct WatchRoomRuntime {
    code: String,
    _endpoint: Endpoint,
    router: Router,
    role: WatchRoomRole,
}

enum WatchRoomRole {
    Host(Arc<RoomHub>),
    Guest { connection: Connection },
}

#[derive(Default)]
struct RoomHub {
    code: String,
    records: Mutex<HashMap<String, RoomRecord>>,
}

struct RoomRecord {
    payload: String,
    seen: Instant,
}

#[derive(Clone)]
struct WatchProtocol(Arc<RoomHub>);

impl fmt::Debug for WatchProtocol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WatchProtocol")
            .field("code", &self.0.code)
            .finish()
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeRequest {
    room_code: String,
    payload: String,
}

#[derive(Deserialize, Serialize)]
struct ExchangeResponse {
    ok: bool,
    error: Option<String>,
    records: Vec<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelaySettings {
    custom_url: Option<String>,
}

impl RoomHub {
    fn new(code: String) -> Self {
        Self {
            code,
            records: Mutex::new(HashMap::new()),
        }
    }

    async fn exchange(&self, request: ExchangeRequest) -> Result<Vec<String>> {
        anyhow::ensure!(
            request.room_code == self.code,
            "room code does not match this host"
        );
        let device_id = validate_payload(&request.payload, &self.code)?;
        let mut records = self.records.lock().await;
        records.retain(|_, record| record.seen.elapsed() < LIVE_PARTICIPANT);
        records.insert(
            device_id,
            RoomRecord {
                payload: request.payload,
                seen: Instant::now(),
            },
        );
        Ok(records
            .values()
            .map(|record| record.payload.clone())
            .collect())
    }
}

impl WatchProtocol {
    async fn handle(&self, connection: Connection) -> Result<()> {
        loop {
            let (mut send, mut recv) = match connection.accept_bi().await {
                Ok(streams) => streams,
                Err(_) => return Ok(()),
            };
            let response = match read_frame::<_, ExchangeRequest>(&mut recv).await {
                Ok(request) => match self.0.exchange(request).await {
                    Ok(records) => ExchangeResponse {
                        ok: true,
                        error: None,
                        records,
                    },
                    Err(error) => ExchangeResponse {
                        ok: false,
                        error: Some(error.to_string()),
                        records: Vec::new(),
                    },
                },
                Err(error) => ExchangeResponse {
                    ok: false,
                    error: Some(error.to_string()),
                    records: Vec::new(),
                },
            };
            write_frame(&mut send, &response).await?;
            send.finish()?;
        }
    }
}

impl ProtocolHandler for WatchProtocol {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        self.handle(connection).await.map_err(|error| {
            eprintln!("[watch-room] exchange failed: {error:#}");
            AcceptError::from_boxed(error.into())
        })
    }
}

fn clean_code(code: &str) -> Result<String> {
    let code = code.trim().to_ascii_uppercase();
    anyhow::ensure!(
        code.len() == 6
            && code
                .bytes()
                .all(|byte| matches!(byte, b'A'..=b'H' | b'J'..=b'N' | b'P'..=b'Z' | b'2'..=b'9')),
        "Enter the six-character room code."
    );
    Ok(code)
}

fn room_secret(code: &str) -> SecretKey {
    let digest = blake3::hash(format!("izumi-watch-room-v1:{code}").as_bytes());
    SecretKey::from(*digest.as_bytes())
}

fn validate_payload(payload: &str, code: &str) -> Result<String> {
    anyhow::ensure!(payload.len() <= MAX_FRAME_BYTES, "room state is too large");
    let value: Value = serde_json::from_str(payload).context("room state is not valid JSON")?;
    anyhow::ensure!(
        value.get("app").and_then(Value::as_str) == Some("izumi"),
        "invalid room state app"
    );
    anyhow::ensure!(
        value.get("kind").and_then(Value::as_str) == Some("watch-party"),
        "invalid room state kind"
    );
    anyhow::ensure!(
        value.get("version").and_then(Value::as_u64) == Some(1),
        "unsupported room state version"
    );
    anyhow::ensure!(
        value.get("roomCode").and_then(Value::as_str) == Some(code),
        "room state code does not match"
    );
    let device_id = value
        .get("deviceId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    anyhow::ensure!(
        !device_id.is_empty() && device_id.len() <= 128,
        "invalid room participant identity"
    );
    Ok(device_id.to_string())
}

async fn endpoint(app: &AppHandle, key: SecretKey) -> Result<Endpoint> {
    let root = app.path().app_data_dir()?.join("iroh-sync");
    let relay = match tokio::fs::read(root.join("relay.json")).await {
        Ok(raw) => serde_json::from_slice::<RelaySettings>(&raw)
            .context("invalid saved relay configuration")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => RelaySettings::default(),
        Err(error) => return Err(error.into()),
    };
    let mut builder = Endpoint::builder(iroh::endpoint::presets::N0).secret_key(key);
    if let Some(url) = relay.custom_url {
        builder = builder.relay_mode(RelayMode::custom([
            RelayUrl::from_str(&url).context("invalid custom relay URL")?
        ]));
    }
    builder
        .bind()
        .await
        .context("could not start Watch Together networking")
}

async fn shutdown(runtime: WatchRoomRuntime) {
    let _ = runtime.router.shutdown().await;
}

async fn replace_runtime(state: &WatchRoomState, next: WatchRoomRuntime) {
    let old = state.inner.lock().await.replace(next);
    if let Some(old) = old {
        shutdown(old).await;
    }
}

async fn guest_exchange(
    connection: &Connection,
    code: &str,
    payload: String,
) -> Result<Vec<String>> {
    validate_payload(&payload, code)?;
    let (mut send, mut recv) = connection.open_bi().await?;
    write_frame(
        &mut send,
        &ExchangeRequest {
            room_code: code.to_string(),
            payload,
        },
    )
    .await?;
    send.finish()?;
    let response: ExchangeResponse = tokio::time::timeout(CONNECT_TIMEOUT, read_frame(&mut recv))
        .await
        .context("room response timed out")??;
    anyhow::ensure!(
        response.ok,
        "{}",
        response
            .error
            .unwrap_or_else(|| "The room rejected this device.".into())
    );
    Ok(response.records)
}

#[tauri::command]
pub async fn watch_room_host(
    code: String,
    payload: String,
    app: AppHandle,
    state: tauri::State<'_, WatchRoomState>,
) -> Result<Vec<String>, String> {
    let code = clean_code(&code).map_err(|error| error.to_string())?;
    validate_payload(&payload, &code).map_err(|error| error.to_string())?;
    let hub = Arc::new(RoomHub::new(code.clone()));
    let endpoint = endpoint(&app, room_secret(&code))
        .await
        .map_err(|error| error.to_string())?;
    let router = Router::builder(endpoint.clone())
        .accept(WATCH_ALPN, WatchProtocol(hub.clone()))
        .spawn();
    let records = hub
        .exchange(ExchangeRequest {
            room_code: code.clone(),
            payload,
        })
        .await
        .map_err(|error| error.to_string())?;
    replace_runtime(
        &state,
        WatchRoomRuntime {
            code,
            _endpoint: endpoint,
            router,
            role: WatchRoomRole::Host(hub),
        },
    )
    .await;
    Ok(records)
}

#[tauri::command]
pub async fn watch_room_join(
    code: String,
    payload: String,
    app: AppHandle,
    state: tauri::State<'_, WatchRoomState>,
) -> Result<Vec<String>, String> {
    let code = clean_code(&code).map_err(|error| error.to_string())?;
    let host = room_secret(&code).public();
    let endpoint = endpoint(&app, SecretKey::generate())
        .await
        .map_err(|error| error.to_string())?;
    let router = Router::builder(endpoint.clone()).spawn();
    let connection = match tokio::time::timeout(CONNECT_TIMEOUT, endpoint.connect(host, WATCH_ALPN))
        .await
    {
        Ok(Ok(connection)) => connection,
        Ok(Err(error)) => {
            let _ = router.shutdown().await;
            return Err(format!("Room not found or the host cannot be reached. Check the code, relay, and host connection. ({error})"));
        }
        Err(_) => {
            let _ = router.shutdown().await;
            return Err("Room not found or the host cannot be reached. Check the code, relay, and host connection. (connection timed out)".into());
        }
    };
    let records = match guest_exchange(&connection, &code, payload).await {
        Ok(records) => records,
        Err(error) => {
            let _ = router.shutdown().await;
            return Err(format!("Room not found or the host cannot be reached. Check the code, relay, and host connection. ({error})"));
        }
    };
    replace_runtime(
        &state,
        WatchRoomRuntime {
            code,
            _endpoint: endpoint,
            router,
            role: WatchRoomRole::Guest { connection },
        },
    )
    .await;
    Ok(records)
}

#[tauri::command]
pub async fn watch_room_exchange(
    payload: String,
    state: tauri::State<'_, WatchRoomState>,
) -> Result<Vec<String>, String> {
    let (code, role) = {
        let guard = state.inner.lock().await;
        let runtime = guard
            .as_ref()
            .ok_or("This device is not in a Watch Together room.")?;
        let role = match &runtime.role {
            WatchRoomRole::Host(hub) => EitherRole::Host(hub.clone()),
            WatchRoomRole::Guest { connection } => EitherRole::Guest(connection.clone()),
        };
        (runtime.code.clone(), role)
    };
    match role {
        EitherRole::Host(hub) => hub
            .exchange(ExchangeRequest {
                room_code: code,
                payload,
            })
            .await
            .map_err(|error| error.to_string()),
        EitherRole::Guest(connection) => guest_exchange(&connection, &code, payload)
            .await
            .map_err(|error| error.to_string()),
    }
}

enum EitherRole {
    Host(Arc<RoomHub>),
    Guest(Connection),
}

#[tauri::command]
pub async fn watch_room_leave(state: tauri::State<'_, WatchRoomState>) -> Result<(), String> {
    let runtime = { state.inner.lock().await.take() };
    if let Some(runtime) = runtime {
        shutdown(runtime).await;
    }
    Ok(())
}

async fn write_frame<W: AsyncWrite + Unpin, T: Serialize>(writer: &mut W, value: &T) -> Result<()> {
    let payload = serde_json::to_vec(value)?;
    anyhow::ensure!(payload.len() <= MAX_FRAME_BYTES, "room frame is too large");
    writer
        .write_all(&(payload.len() as u32).to_be_bytes())
        .await?;
    writer.write_all(&payload).await?;
    writer.flush().await?;
    Ok(())
}

async fn read_frame<R: AsyncRead + Unpin, T: DeserializeOwned>(reader: &mut R) -> Result<T> {
    let mut length = [0u8; 4];
    reader.read_exact(&mut length).await?;
    let length = u32::from_be_bytes(length) as usize;
    anyhow::ensure!(length <= MAX_FRAME_BYTES, "room frame is too large");
    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload).await?;
    Ok(serde_json::from_slice(&payload)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_code_determines_only_the_ephemeral_host() {
        assert_eq!(
            room_secret("ABC234").public(),
            room_secret("ABC234").public()
        );
        assert_ne!(
            room_secret("ABC234").public(),
            room_secret("ABC235").public()
        );
    }

    #[test]
    fn room_payload_cannot_cross_rooms() {
        let payload = r#"{"app":"izumi","kind":"watch-party","version":1,"roomCode":"ABC234","deviceId":"guest"}"#;
        assert_eq!(validate_payload(payload, "ABC234").unwrap(), "guest");
        assert!(validate_payload(payload, "ZZZ999").is_err());
    }
}
