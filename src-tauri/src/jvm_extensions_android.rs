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
const RUNTIME_VERSION: &str = "2.0.0";
const RUNTIME_URL: &str = "https://github.com/RyanYuuki/AnymeXExtensionRuntimeBridge/releases/download/v2.0.0/anymex_runtime_host.apk";
const RUNTIME_SHA256: &str = "b54cce2af8fda9e48cfa37d814362a41a85bde248b3519f9231410dc18b25f52";
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

async fn ensure_runtime_file(app: &AppHandle) -> Result<PathBuf, String> {
    let path = runtime_path(app)?;
    if let Ok(bytes) = tokio::fs::read(&path).await {
        if digest(&bytes) == RUNTIME_SHA256 {
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
    Ok(path)
}

async fn runtime_request(app: &AppHandle) -> Result<AniyomiRuntimeRequest, String> {
    let runtime = ensure_runtime_file(app).await?;
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

#[tauri::command]
pub async fn jvm_extension_sources(app: AppHandle) -> Result<Value, String> {
    let payload = runtime_request(&app).await?;
    let response = app
        .extplayer()
        .aniyomi_sources(payload)
        .map_err(|error| error.to_string())?;
    parse_response(response)
}

#[tauri::command]
pub async fn jvm_extension_call(
    app: AppHandle,
    method: String,
    args: Value,
) -> Result<Value, String> {
    let paths = runtime_request(&app).await?;
    let response = app
        .extplayer()
        .aniyomi_call(AniyomiCallRequest {
            runtime_path: paths.runtime_path,
            extensions_path: paths.extensions_path,
            method,
            args_json: serde_json::to_string(&args).map_err(|error| error.to_string())?,
        })
        .map_err(|error| error.to_string())?;
    parse_response(response)
}

#[tauri::command]
pub async fn jvm_extension_reload(app: AppHandle) -> Result<(), String> {
    // Prepare the verified host during installation so the first source search does not pay a
    // surprise 15 MB runtime download. The Kotlin side is then reset and will enumerate the newly
    // installed APK on demand.
    ensure_runtime_file(&app).await?;
    app.extplayer()
        .aniyomi_reload()
        .map_err(|error| error.to_string())
}
