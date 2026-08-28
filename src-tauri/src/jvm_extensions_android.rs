use futures_util::StreamExt;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_extplayer::{
    AniyomiCallRequest, AniyomiRuntimeRequest, ExtPlayerExt, JsonResponse,
};

// Android cannot launch the desktop Java 17 process. The upstream runtime publishes a dedicated
// Android host APK which is loaded inside Izumi's process through DexClassLoader. Pin both its
// version and digest: executable code never runs merely because "latest" changed upstream.
const RUNTIME_VERSION: &str = "2.3.0";
const RUNTIME_URL: &str = "https://github.com/RyanYuuki/AnymeXExtensionRuntimeBridge/releases/download/v2.3.0/anymex_runtime_host.apk";
const RUNTIME_SHA256: &str = "0c062265e3eca14f68597785dfd03e814229a5c5de961fc85f50220c7c0a252c";
const MAX_RUNTIME_BYTES: usize = 20 * 1024 * 1024;

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn runtime_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|path| {
            path.join("extensions")
                .join("runtime")
                .join(format!("anymex-android-{RUNTIME_VERSION}.apk"))
        })
}

// The verified runtime path, remembered per process. Every bridge hop used to re-read and
// re-SHA256 the ~15-20 MB APK (100-400ms of pure overhead per call, on a phone, while resolving).
// The file is verified ONCE; afterwards only its existence is checked. The pinned version is a
// compile-time constant, so a new runtime version means a new binary and a fresh cache.
static RUNTIME_VERIFIED: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

async fn ensure_runtime_file(app: &AppHandle) -> Result<PathBuf, String> {
    let path = runtime_path(app)?;
    if let Some(verified) = RUNTIME_VERIFIED.get() {
        if verified == &path && path.exists() {
            return Ok(path);
        }
    }
    if let Ok(bytes) = tokio::fs::read(&path).await {
        if digest(&bytes) == RUNTIME_SHA256 {
            let _ = RUNTIME_VERIFIED.set(path.clone());
            return Ok(path);
        }
    }

    let response = reqwest::get(RUNTIME_URL)
        .await
        .map_err(|error| format!("Could not download the Android extension runtime: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Could not download the Android extension runtime: {error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RUNTIME_BYTES as u64)
    {
        return Err("The Android extension runtime is unexpectedly large".into());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|error| format!("Could not read the Android extension runtime: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_RUNTIME_BYTES {
            return Err("The Android extension runtime is unexpectedly large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if digest(&bytes) != RUNTIME_SHA256 {
        return Err("Downloaded Android extension runtime failed its SHA-256 check".into());
    }

    let parent = path.parent().ok_or("Android runtime path has no parent")?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| error.to_string())?;
    let temporary = path.with_extension("apk.part");
    tokio::fs::write(&temporary, bytes)
        .await
        .map_err(|error| error.to_string())?;
    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|error| error.to_string())?;
    }
    tokio::fs::rename(temporary, &path)
        .await
        .map_err(|error| error.to_string())?;
    let _ = RUNTIME_VERIFIED.set(path.clone());
    Ok(path)
}

async fn runtime_request(app: &AppHandle) -> Result<AniyomiRuntimeRequest, String> {
    // Bounded: `reqwest::get` has no default timeout, so a stalled runtime download used to hang
    // this (and everything awaiting it) indefinitely.
    let runtime = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        ensure_runtime_file(app),
    )
    .await
    .map_err(|_| "Downloading the Android extension runtime timed out.".to_string())??;
    let extensions = crate::extension_package::android_runtime_root(app)?;
    tokio::fs::create_dir_all(extensions.join("exts"))
        .await
        .map_err(|error| error.to_string())?;
    Ok(AniyomiRuntimeRequest {
        runtime_path: runtime.to_string_lossy().into_owned(),
        extensions_path: extensions.to_string_lossy().into_owned(),
    })
}

fn parse_response(response: JsonResponse) -> Result<Value, String> {
    serde_json::from_str(&response.json)
        .map_err(|error| format!("Android extension runtime returned invalid JSON: {error}"))
}

// `run_mobile_plugin` (inside every `aniyomi_*` bridge call) parks its thread on a channel until
// Kotlin answers — a genuinely BLOCKING wait. Run on tauri's blocking pool, never on the shared
// async workers: a wedged extension call used to permanently occupy one core-sized async worker
// per attempt, and once the pool was gone even mpv's own commands could no longer be dispatched
// (Android's "player controls stopped responding" report). The deadline is a belt on top of the
// Kotlin side's own (the timeout abandons the blocking thread; Kotlin's watchdog settles it).
async fn call_bridge<T: Send + 'static>(
    seconds: u64,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let handle = tauri::async_runtime::spawn_blocking(work);
    tokio::time::timeout(std::time::Duration::from_secs(seconds), handle)
        .await
        .map_err(|_| "The extension runtime did not answer in time.".to_string())?
        .map_err(|error| error.to_string())?
}

/// Largest extension icon we will inline. These are launcher icons (tens of KB); the cap only
/// stops a pathological file from being base64'd across the IPC bridge.
const MAX_ICON_BYTES: u64 = 512 * 1024;

/// Turn each source's `iconUrl` into something the webview can actually render.
///
/// The bridge decodes the extension APK's launcher icon and writes it into ITS cache dir, then
/// hands back a bare filesystem path — which an `<img src>` cannot load (no asset protocol is
/// configured, and the path is outside any scope we would want to open). Read the PNG here and
/// replace the path with base64, matching the convention the rest of the extension UI already
/// uses (`iconSrc` treats a bare string as base64 PNG). Values that are already an http(s) or
/// data URL are left alone, so a future bridge that returns those keeps working.
fn inline_source_icons(sources: &mut Value) {
    use base64::Engine;
    let Some(list) = sources.as_array_mut() else {
        return;
    };
    for source in list {
        let Some(path) = source.get("iconUrl").and_then(Value::as_str) else {
            continue;
        };
        if path.is_empty() || path.starts_with("http") || path.starts_with("data:") {
            continue;
        }
        let encoded = std::fs::metadata(path)
            .ok()
            .filter(|meta| meta.is_file() && meta.len() > 0 && meta.len() <= MAX_ICON_BYTES)
            .and_then(|_| std::fs::read(path).ok())
            .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes));
        // A missing/oversized icon becomes null rather than a dangling path the UI would try to
        // load: the frontend already falls back to a generated tile.
        source["iconUrl"] = match encoded {
            Some(data) => Value::String(data),
            None => Value::Null,
        };
    }
}

#[tauri::command]
pub async fn jvm_extension_sources(app: AppHandle) -> Result<Value, String> {
    let payload = runtime_request(&app).await?;
    let response = call_bridge(70, move || {
        app.extplayer()
            .aniyomi_sources(payload)
            .map_err(|error| error.to_string())
    })
    .await?;
    let mut sources = parse_response(response)?;
    inline_source_icons(&mut sources);
    Ok(sources)
}

#[tauri::command]
pub async fn jvm_extension_call(
    app: AppHandle,
    method: String,
    mut args: Value,
    request_id: Option<String>,
) -> Result<Value, String> {
    if let Some(request_id) = request_id {
        if request_id.is_empty()
            || request_id.len() > 128
            || !request_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
        {
            return Err("Extension runtime request id is invalid".into());
        }
        args.as_object_mut()
            .ok_or("Extension runtime arguments must be an object")?
            .insert("requestId".into(), Value::String(request_id));
    }
    let paths = runtime_request(&app).await?;
    let args_json = serde_json::to_string(&args).map_err(|error| error.to_string())?;
    let response = call_bridge(85, move || {
        app.extplayer()
            .aniyomi_call(AniyomiCallRequest {
                runtime_path: paths.runtime_path,
                extensions_path: paths.extensions_path,
                method,
                args_json,
            })
            .map_err(|error| error.to_string())
    })
    .await?;
    parse_response(response)
}

#[tauri::command]
pub async fn jvm_extension_cancel(app: AppHandle, request_id: String) -> Result<(), String> {
    let paths = runtime_request(&app).await?;
    let args_json = serde_json::to_string(&serde_json::json!({ "requestId": request_id }))
        .map_err(|error| error.to_string())?;
    call_bridge(10, move || {
        app.extplayer()
            .aniyomi_call(AniyomiCallRequest {
                runtime_path: paths.runtime_path,
                extensions_path: paths.extensions_path,
                method: "cancel".into(),
                args_json,
            })
            .map_err(|error| error.to_string())
    })
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn jvm_extension_reload(app: AppHandle) -> Result<(), String> {
    // Prepare the verified host during installation so the first source search does not pay a
    // surprise 15 MB runtime download. The Kotlin side is then reset and will enumerate the newly
    // installed APK on demand.
    tokio::time::timeout(
        std::time::Duration::from_secs(120),
        ensure_runtime_file(&app),
    )
    .await
    .map_err(|_| "Downloading the Android extension runtime timed out.".to_string())??;
    call_bridge(30, move || {
        app.extplayer()
            .aniyomi_reload()
            .map_err(|error| error.to_string())
    })
    .await
}
