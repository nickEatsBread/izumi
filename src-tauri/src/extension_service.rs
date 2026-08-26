//! Generic process runtime for signed `.izumi-ext` local-service packages.
//!
//! The host knows nothing about individual providers. A service receives an assigned loopback
//! port and private data directory, then exposes the ordinary Izumi extension manifest at
//! `/index.json`. From that point on it travels through the same manifest, worker, provider and
//! picker pipeline as every remote extension. A service may also expose `GET/POST
//! /__izumi/settings`; Tauri proxies that typed schema into Izumi's native settings dialog so the
//! loopback origin is never user-facing.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};

struct RunningService {
    child: Child,
    port: u16,
}

#[derive(Default)]
pub struct ExtensionServices(Mutex<HashMap<String, RunningService>>);

fn allocate_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|e| e.to_string())
}

fn manifest_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/index.json")
}

fn service_endpoint(manifest: &str, path: &str) -> Result<String, String> {
    let base = manifest
        .strip_suffix("/index.json")
        .ok_or("Extension service returned an invalid manifest URL")?;
    Ok(format!("{base}{path}"))
}

async fn healthy(port: u16) -> bool {
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(300))
        .timeout(Duration::from_millis(800))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    let Ok(response) = client.get(manifest_url(port)).send().await else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    response
        .text()
        .await
        .ok()
        .and_then(|body| serde_json::from_str::<serde_json::Value>(&body).ok())
        .is_some_and(|value| value.is_object() || value.is_array())
}

fn spawn_service(app: &AppHandle, id: &str, port: u16) -> Result<Child, String> {
    let executable = crate::extension_package::extension_service_entry(app, id)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("extension-services")
        .join(id);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let mut command = Command::new(&executable);
    command
        .current_dir(executable.parent().unwrap_or(&data_dir))
        .env("IZUMI_EXTENSION_ID", id)
        .env("IZUMI_EXTENSION_PORT", port.to_string())
        .env("IZUMI_EXTENSION_DATA_DIR", data_dir)
        .env("IZUMI_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null());
    if cfg!(debug_assertions) {
        command.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    } else {
        command.stdout(Stdio::null()).stderr(Stdio::null());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .map_err(|e| format!("Could not start extension service {id}: {e}"))
}

#[tauri::command]
pub async fn extension_service_ensure(
    app: AppHandle,
    id: String,
    services: tauri::State<'_, ExtensionServices>,
) -> Result<String, String> {
    let existing_port = {
        let mut running = services.0.lock().map_err(|e| e.to_string())?;
        if let Some(service) = running.get_mut(&id) {
            if service
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_none()
            {
                Some(service.port)
            } else {
                running.remove(&id);
                None
            }
        } else {
            None
        }
    };
    if let Some(port) = existing_port {
        if healthy(port).await {
            return Ok(manifest_url(port));
        }
    }

    let port = {
        let mut running = services.0.lock().map_err(|e| e.to_string())?;
        if let Some(service) = running.get(&id) {
            service.port
        } else {
            let port = allocate_port()?;
            let child = spawn_service(&app, &id, port)?;
            running.insert(id.clone(), RunningService { child, port });
            port
        }
    };

    for _ in 0..150 {
        if healthy(port).await {
            return Ok(manifest_url(port));
        }
        {
            let mut running = services.0.lock().map_err(|e| e.to_string())?;
            if let Some(service) = running.get_mut(&id) {
                if let Some(status) = service.child.try_wait().map_err(|e| e.to_string())? {
                    running.remove(&id);
                    return Err(format!(
                        "Extension service {id} exited during startup ({status})."
                    ));
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let service = services.0.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(service) = service {
        tauri::async_runtime::spawn_blocking(move || stop(service))
            .await
            .map_err(|e| e.to_string())?;
    }
    Err(format!(
        "Extension service {id} did not become ready within 15 seconds."
    ))
}

const MAX_SETTINGS_BYTES: usize = 1024 * 1024;

async fn settings_request(
    manifest: &str,
    values: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let url = service_endpoint(manifest, "/__izumi/settings")?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let request = if let Some(values) = values {
        client
            .post(&url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serde_json::json!({ "values": values }).to_string())
    } else {
        client.get(&url)
    };
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_SETTINGS_BYTES {
        return Err("Extension settings response is too large".into());
    }
    if !status.is_success() {
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err("This local service does not support Izumi-native settings yet.".into());
        }
        let detail = String::from_utf8_lossy(&bytes);
        let detail = detail.trim();
        return Err(if detail.is_empty() {
            format!("Extension settings request failed ({status})")
        } else {
            format!("Extension settings request failed ({status}): {detail}")
        });
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| "Extension settings response is not valid JSON".into())
}

/// Read a service's versioned settings schema and current values through native IPC. The private
/// ephemeral loopback address is not returned by this command and never appears in the settings UI.
#[tauri::command]
pub async fn extension_service_settings(
    app: AppHandle,
    id: String,
    services: tauri::State<'_, ExtensionServices>,
) -> Result<serde_json::Value, String> {
    let manifest = extension_service_ensure(app, id, services).await?;
    settings_request(&manifest, None).await
}

/// Persist values using the same private protocol. Services may return a refreshed schema or a
/// compact `{ ok, message, restartRequired }` result; the native dialog understands both.
#[tauri::command]
pub async fn extension_service_settings_save(
    app: AppHandle,
    id: String,
    values: serde_json::Value,
    services: tauri::State<'_, ExtensionServices>,
) -> Result<serde_json::Value, String> {
    if !values.is_object() {
        return Err("Extension settings values must be an object".into());
    }
    let manifest = extension_service_ensure(app, id, services).await?;
    settings_request(&manifest, Some(values)).await
}

fn request_shutdown(port: u16) {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(200)) else {
        return;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let request = b"POST /__izumi/shutdown HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_ok() {
        let mut response = [0_u8; 128];
        let _ = stream.read(&mut response);
    }
}

fn stop(mut service: RunningService) {
    request_shutdown(service.port);
    for _ in 0..30 {
        if service.child.try_wait().ok().flatten().is_some() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = service.child.kill();
    let _ = service.child.wait();
}

#[tauri::command]
pub async fn extension_service_stop(
    id: String,
    services: tauri::State<'_, ExtensionServices>,
) -> Result<(), String> {
    let service = services.0.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(service) = service {
        tauri::async_runtime::spawn_blocking(move || stop(service))
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

impl Drop for ExtensionServices {
    fn drop(&mut self) {
        let Ok(running) = self.0.get_mut() else {
            return;
        };
        for (_, service) in running.drain() {
            stop(service);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_always_loopback() {
        assert_eq!(manifest_url(43210), "http://127.0.0.1:43210/index.json");
    }

    #[test]
    fn settings_endpoint_stays_on_the_service_origin() {
        assert_eq!(
            service_endpoint(&manifest_url(43210), "/__izumi/settings").unwrap(),
            "http://127.0.0.1:43210/__izumi/settings"
        );
        assert!(
            service_endpoint("https://example.test/not-a-manifest", "/__izumi/settings").is_err()
        );
    }

    #[test]
    fn allocated_port_is_ephemeral_and_nonzero() {
        assert_ne!(allocate_port().unwrap(), 0);
    }
}
