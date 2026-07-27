use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex, RwLock};
use tokio::time::{timeout, Duration};

const RUNTIME_VERSION: &str = "1.9.8";
const RUNTIME_URL: &str = "https://github.com/RyanYuuki/AnymeXExtensionRuntimeBridge/releases/download/v1.9.8/anymex_desktop_runtime.jar";
const RUNTIME_SHA256: &str = "f45ccc9a0f1755db0a519abfb921abf2e9e460827aeb228418cfc4dbfb78c2ac";
const JRE_VERSION: &str = "17.0.12+7";
const MAX_JRE_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;

struct JreAsset {
    url: &'static str,
    sha256: &'static str,
    gzip: bool,
}

type Pending = HashMap<String, oneshot::Sender<Result<Value, String>>>;

struct Process {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<Pending>>,
    sequence: AtomicU64,
}

impl Process {
    async fn request(&self, method: &str, args: Value) -> Result<Value, String> {
        let id = self.sequence.fetch_add(1, Ordering::Relaxed).to_string();
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), sender);
        let request = json!({ "id": id, "method": method, "args": args });
        {
            let mut stdin = self.stdin.lock().await;
            if let Err(error) = stdin
                .write_all(format!("{request}\n").as_bytes())
                .await
                .and_then(|_| Ok(()))
            {
                self.pending.lock().await.remove(&id);
                return Err(format!("Extension runtime write failed: {error}"));
            }
            stdin
                .flush()
                .await
                .map_err(|error| format!("Extension runtime flush failed: {error}"))?;
        }
        match timeout(Duration::from_secs(120), receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Extension runtime stopped before replying".into()),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(format!("Extension runtime request timed out: {method}"))
            }
        }
    }
}

#[derive(Default)]
pub struct Runtime {
    process: Mutex<Option<Arc<Process>>>,
    sources: RwLock<Option<Value>>,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn extension_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("extensions").join("jvm"))
}

fn runtime_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?
        .join("extensions")
        .join("runtime")
        .join(format!("anymex-desktop-{RUNTIME_VERSION}.jar")))
}

fn jre_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?
        .join("extensions")
        .join("runtime")
        .join(format!("temurin-jre-{JRE_VERSION}")))
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
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
        .map_err(|error| format!("Could not download the extension runtime: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Could not download the extension runtime: {error}"))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read the extension runtime: {error}"))?;
    if digest(&bytes) != RUNTIME_SHA256 {
        return Err("Downloaded extension runtime failed its SHA-256 check".into());
    }
    let parent = path
        .parent()
        .ok_or("Extension runtime path has no parent")?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| error.to_string())?;
    let temporary = path.with_extension("jar.part");
    tokio::fs::write(&temporary, &bytes)
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

fn jre_asset() -> Result<JreAsset, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok(JreAsset {
            url: concat!(
                "https://github.com/adoptium/temurin17-binaries/releases/download/",
                "jdk-17.0.12%2B7/OpenJDK17U-jre_x64_windows_hotspot_17.0.12_7.zip"
            ),
            sha256: "646f1f60286670da309b586d0905f1df1a5c2f674d24006823d688bca65388f4",
            gzip: false,
        }),
        ("macos", "aarch64") => Ok(JreAsset {
            url: concat!(
                "https://github.com/adoptium/temurin17-binaries/releases/download/",
                "jdk-17.0.12%2B7/OpenJDK17U-jre_aarch64_mac_hotspot_17.0.12_7.tar.gz"
            ),
            sha256: "5c1cb2cbd2ef3f2b529e2733d0ab55381e10c4c3607f4d62f2bf12f0942198bf",
            gzip: true,
        }),
        ("macos", "x86_64") => Ok(JreAsset {
            url: concat!(
                "https://github.com/adoptium/temurin17-binaries/releases/download/",
                "jdk-17.0.12%2B7/OpenJDK17U-jre_x64_mac_hotspot_17.0.12_7.tar.gz"
            ),
            sha256: "331aceddc402263c5e47529234965927573ead684ea2b7a0358fbb6c279c1510",
            gzip: true,
        }),
        ("linux", "aarch64") => Ok(JreAsset {
            url: concat!(
                "https://github.com/adoptium/temurin17-binaries/releases/download/",
                "jdk-17.0.12%2B7/OpenJDK17U-jre_aarch64_linux_hotspot_17.0.12_7.tar.gz"
            ),
            sha256: "9dfe4c56463690ae67d22268980d8861eb46b907d7914f8f2e6fc7b25778c8ec",
            gzip: true,
        }),
        ("linux", "x86_64") => Ok(JreAsset {
            url: concat!(
                "https://github.com/adoptium/temurin17-binaries/releases/download/",
                "jdk-17.0.12%2B7/OpenJDK17U-jre_x64_linux_hotspot_17.0.12_7.tar.gz"
            ),
            sha256: "0e8088d7a3a7496faba7ac8787db09dc0264c2bc6f568ea8024fd775a783e13c",
            gzip: true,
        }),
        _ => Err(format!(
            "JVM-backed anime providers are not available on {} {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )),
    }
}

fn find_java(folder: &Path) -> Option<PathBuf> {
    let executable = if cfg!(windows) { "java.exe" } else { "java" };
    let mut pending = vec![(folder.to_path_buf(), 0usize)];
    while let Some((current, depth)) = pending.pop() {
        if depth > 5 {
            continue;
        }
        let entries = std::fs::read_dir(current).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
                && path.file_name().and_then(|name| name.to_str()) == Some(executable)
                && path
                    .parent()
                    .and_then(Path::file_name)
                    .and_then(|name| name.to_str())
                    == Some("bin")
            {
                return Some(path);
            }
            if path.is_dir() {
                pending.push((path, depth + 1));
            }
        }
    }
    None
}

fn extract_jre(bytes: &[u8], destination: &Path, gzip: bool) -> Result<(), String> {
    std::fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    if gzip {
        let decoder = flate2::read::GzDecoder::new(bytes);
        let mut archive = tar::Archive::new(decoder);
        archive
            .unpack(destination)
            .map_err(|error| format!("Could not unpack the private Java runtime: {error}"))?;
    } else {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
            .map_err(|error| format!("Private Java runtime is not a ZIP: {error}"))?;
        archive
            .extract(destination)
            .map_err(|error| format!("Could not unpack the private Java runtime: {error}"))?;
    }
    Ok(())
}

async fn ensure_private_java(app: &AppHandle) -> Result<PathBuf, String> {
    let destination = jre_path(app)?;
    if let Some(java) = find_java(&destination) {
        return Ok(java);
    }
    let asset = jre_asset()?;
    let response = reqwest::get(asset.url)
        .await
        .map_err(|error| format!("Could not download the private Java runtime: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Could not download the private Java runtime: {error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_JRE_ARCHIVE_BYTES)
    {
        return Err("Private Java runtime archive is too large".into());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|error| format!("Could not read the private Java runtime: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) as u64 > MAX_JRE_ARCHIVE_BYTES {
            return Err("Private Java runtime archive is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if digest(&bytes) != asset.sha256 {
        return Err("Downloaded private Java runtime failed its SHA-256 check".into());
    }
    let temporary = destination.with_extension("part");
    if temporary.exists() {
        tokio::fs::remove_dir_all(&temporary)
            .await
            .map_err(|error| error.to_string())?;
    }
    let unpack_bytes = bytes;
    let unpack_path = temporary.clone();
    tokio::task::spawn_blocking(move || extract_jre(&unpack_bytes, &unpack_path, asset.gzip))
        .await
        .map_err(|error| format!("Private Java extraction task failed: {error}"))??;
    if find_java(&temporary).is_none() {
        let _ = tokio::fs::remove_dir_all(&temporary).await;
        return Err("Private Java runtime contains no Java executable".into());
    }
    if destination.exists() {
        tokio::fs::remove_dir_all(&destination)
            .await
            .map_err(|error| error.to_string())?;
    }
    tokio::fs::rename(&temporary, &destination)
        .await
        .map_err(|error| error.to_string())?;
    find_java(&destination).ok_or_else(|| "Private Java runtime installation failed".into())
}

async fn java_command(app: &AppHandle) -> Result<PathBuf, String> {
    let java = if cfg!(windows) { "java.exe" } else { "java" };
    let output = Command::new(java)
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await;
    if let Ok(output) = output {
        let version = String::from_utf8_lossy(&output.stderr);
        let quoted = version
            .split('"')
            .nth(1)
            .and_then(|value| value.split('.').next())
            .and_then(|value| value.parse::<u32>().ok());
        if output.status.success() && quoted.is_some_and(|major| major >= 17) {
            return Ok(PathBuf::from(java));
        }
    }
    ensure_private_java(app).await
}

async fn start_process(java: &Path, runtime: &Path) -> Result<Arc<Process>, String> {
    let mut child = Command::new(java)
        .args([
            "-Dfile.encoding=UTF-8",
            "-Dsun.stdout.encoding=UTF-8",
            "-Dsun.stderr.encoding=UTF-8",
            "-Xms64m",
            "-Xmx384m",
            "-jar",
        ])
        .arg(runtime)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Could not start the extension runtime: {error}"))?;
    let stdin = child.stdin.take().ok_or("Extension runtime has no stdin")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Extension runtime has no stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Extension runtime has no stderr")?;
    let pending: Arc<Mutex<Pending>> = Arc::new(Mutex::new(HashMap::new()));

    let output_pending = pending.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(id) = message.get("id").and_then(Value::as_str) else {
                continue;
            };
            if let Some(sender) = output_pending.lock().await.remove(id) {
                let payload_error = message
                    .get("data")
                    .and_then(|data| data.get("error"))
                    .and_then(Value::as_str);
                let result = if message.get("status").and_then(Value::as_str) == Some("error") {
                    Err(message
                        .get("data")
                        .map(Value::to_string)
                        .unwrap_or_else(|| "Extension runtime error".into()))
                } else if let Some(error) = payload_error {
                    // A provider that throws is reported INSIDE `data`, with no top-level `status`.
                    // Passing that object through as a success left the caller reading a missing
                    // `episodes` field as "this show has no episodes", so a source that actually
                    // said "log in to Google Drive through webview" showed the user nothing at all.
                    Err(error.to_string())
                } else {
                    Ok(message.get("data").cloned().unwrap_or(Value::Null))
                };
                let _ = sender.send(result);
            }
        }
        for (_, sender) in output_pending.lock().await.drain() {
            let _ = sender.send(Err("Extension runtime exited".into()));
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[aniyomi-jvm] {line}");
        }
    });

    Ok(Arc::new(Process {
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        pending,
        sequence: AtomicU64::new(1),
    }))
}

impl Runtime {
    async fn ensure_started(&self, app: &AppHandle) -> Result<Arc<Process>, String> {
        let mut current = self.process.lock().await;
        if let Some(process) = current.as_ref() {
            let running = process
                .child
                .lock()
                .await
                .try_wait()
                .map_err(|error| format!("Could not inspect extension runtime: {error}"))?
                .is_none();
            if running {
                return Ok(process.clone());
            }
            current.take();
            *self.sources.write().await = None;
        }
        let runtime = ensure_runtime_file(app).await?;
        let java = java_command(app).await?;
        let process = start_process(&java, &runtime).await?;
        let folder = extension_dir(app)?;
        tokio::fs::create_dir_all(&folder)
            .await
            .map_err(|error| error.to_string())?;
        let sources = process
            .request(
                "loadExtensions",
                json!({ "folderPath": folder.to_string_lossy() }),
            )
            .await?;
        *self.sources.write().await = Some(sources);
        *current = Some(process.clone());
        Ok(process)
    }

    async fn stop(&self) {
        if let Some(process) = self.process.lock().await.take() {
            let _ = process.child.lock().await.kill().await;
        }
        *self.sources.write().await = None;
    }
}

#[tauri::command]
pub async fn jvm_extension_sources(
    app: AppHandle,
    runtime: tauri::State<'_, Runtime>,
) -> Result<Value, String> {
    runtime.ensure_started(&app).await?;
    Ok(runtime
        .sources
        .read()
        .await
        .clone()
        .unwrap_or_else(|| Value::Array(Vec::new())))
}

#[tauri::command]
pub async fn jvm_extension_call(
    app: AppHandle,
    method: String,
    args: Value,
    runtime: tauri::State<'_, Runtime>,
) -> Result<Value, String> {
    runtime
        .ensure_started(&app)
        .await?
        .request(&method, args)
        .await
}

#[tauri::command]
pub async fn jvm_extension_reload(runtime: tauri::State<'_, Runtime>) -> Result<(), String> {
    runtime.stop().await;
    Ok(())
}
