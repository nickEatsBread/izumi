use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex, RwLock};
use tokio::time::{timeout, Duration};

// Keep the desktop bridge current with the extension formats shipped by the store. 1.9.8 predates
// the desktop APK/JAR loader, child-first class loading, and several network/WebView compatibility
// fixes used by current Aniyomi sources.
const RUNTIME_VERSION: &str = "2.3.0";
const RUNTIME_URL: &str = "https://github.com/RyanYuuki/AnymeXExtensionRuntimeBridge/releases/download/v2.3.0/anymex_desktop_runtime.jar";
const RUNTIME_SHA256: &str = "32ff822ea3475aeafd0c6f987d1549c8cc30fc535a44d07bc7338b75c44a1d0e";
const JRE_VERSION: &str = "17.0.12+7";
const MAX_JRE_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;

#[path = "jvm_runtime_args.rs"]
mod jvm_runtime_args;
use jvm_runtime_args::java_runtime_jvm_args;

struct JreAsset {
    url: &'static str,
    sha256: &'static str,
    gzip: bool,
}

type Pending = HashMap<String, oneshot::Sender<Result<Value, String>>>;

#[derive(Clone)]
struct DeveloperLogger {
    app: AppHandle,
    enabled: Arc<AtomicBool>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeveloperLog<'a> {
    target: &'a str,
    level: &'a str,
    message: &'a str,
}

impl DeveloperLogger {
    fn emit(&self, target: &str, level: &str, message: &str) {
        if self.enabled.load(Ordering::Relaxed) {
            let _ = self.app.emit(
                "developer-log",
                DeveloperLog {
                    target,
                    level,
                    message,
                },
            );
        }
    }
}

struct Process {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<Pending>>,
    sequence: AtomicU64,
    logger: DeveloperLogger,
}

impl Process {
    async fn request(&self, method: &str, args: Value) -> Result<Value, String> {
        let id = self.sequence.fetch_add(1, Ordering::Relaxed).to_string();
        let started = Instant::now();
        self.logger.emit(
            "aniyomi-jvm",
            "debug",
            &format!("request {id} started: {method}"),
        );
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
        let result = match timeout(Duration::from_secs(120), receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Extension runtime stopped before replying".into()),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(format!("Extension runtime request timed out: {method}"))
            }
        };
        let outcome = if result.is_ok() {
            "completed"
        } else {
            "failed"
        };
        self.logger.emit(
            "aniyomi-jvm",
            if result.is_ok() { "debug" } else { "error" },
            &format!(
                "request {id} {outcome}: {method} ({} ms)",
                started.elapsed().as_millis()
            ),
        );
        result
    }
}

#[derive(Default)]
pub struct Runtime {
    process: Mutex<Option<Arc<Process>>>,
    sources: RwLock<Option<Value>>,
    developer_logging: Arc<AtomicBool>,
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
    find_java_executables(folder).into_iter().next()
}

fn find_java_executables(folder: &Path) -> Vec<PathBuf> {
    let executable = if cfg!(windows) { "java.exe" } else { "java" };
    let mut pending = vec![(folder.to_path_buf(), 0usize)];
    let mut found = Vec::new();
    while let Some((current, depth)) = pending.pop() {
        if depth > 5 {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(current) else {
            continue;
        };
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
                found.push(path.clone());
            }
            if path.is_dir() {
                pending.push((path, depth + 1));
            }
        }
    }
    found
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
        prepare_java_executable(&java)?;
        if supported_java(&java).await {
            return Ok(java);
        }
        // A partial/corrupt cache used to be returned without ever probing it. Remove it so the
        // verified Temurin archive below can repair the installation in the same launch.
        tokio::fs::remove_dir_all(&destination)
            .await
            .map_err(|error| format!("Could not replace the private Java runtime: {error}"))?;
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
    let Some(temporary_java) = find_java(&temporary) else {
        let _ = tokio::fs::remove_dir_all(&temporary).await;
        return Err("Private Java runtime contains no Java executable".into());
    };
    prepare_java_executable(&temporary_java)?;
    if destination.exists() {
        tokio::fs::remove_dir_all(&destination)
            .await
            .map_err(|error| error.to_string())?;
    }
    tokio::fs::rename(&temporary, &destination)
        .await
        .map_err(|error| error.to_string())?;
    let java = find_java(&destination)
        .ok_or_else(|| "Private Java runtime installation failed".to_string())?;
    if !supported_java(&java).await {
        let _ = tokio::fs::remove_dir_all(&destination).await;
        return Err("Private Java runtime could not be started after installation".into());
    }
    Ok(java)
}

// ZIP extraction on Windows does not carry Unix mode bits, and archives can also lose them while
// passing through packaging/caches. A Java file without an execute bit is discoverable on macOS
// but fails only when the user first opens a JVM source. Repair our private, hash-verified runtime
// before probing it. (System Java installations are deliberately left untouched.)
#[cfg(unix)]
fn prepare_java_executable(java: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = std::fs::metadata(java)
        .map_err(|error| format!("Could not inspect the private Java executable: {error}"))?;
    let mode = metadata.permissions().mode();
    if mode & 0o111 == 0 {
        let mut permissions = metadata.permissions();
        permissions.set_mode(mode | 0o111);
        std::fs::set_permissions(java, permissions).map_err(|error| {
            format!("Could not make the private Java runtime executable: {error}")
        })?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn prepare_java_executable(_java: &Path) -> Result<(), String> {
    Ok(())
}

/// Windows opens a console window for any console-subsystem child, and `java.exe` is one — so the
/// extension runtime put a cmd window on screen for as long as it lived, and even the version probe
/// flashed one up. Nothing here is interactive: the runtime speaks JSON over stdio and its output is
/// already piped.
#[cfg(windows)]
fn hide_console(command: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

async fn java_command(app: &AppHandle) -> Result<PathBuf, String> {
    let candidates = tokio::task::spawn_blocking(installed_java_candidates)
        .await
        .map_err(|error| format!("Installed Java discovery failed: {error}"))?;
    for java in candidates {
        if supported_java(&java).await {
            return Ok(java);
        }
    }
    ensure_private_java(app).await
}

fn installed_java_candidates() -> Vec<PathBuf> {
    let executable = if cfg!(windows) { "java.exe" } else { "java" };
    let mut candidates = Vec::new();

    // Honour explicit Java locations first, even when the user did not add them to PATH.
    for variable in ["JAVA_HOME", "JRE_HOME"] {
        if let Some(home) = std::env::var_os(variable) {
            push_unique(
                &mut candidates,
                PathBuf::from(home).join("bin").join(executable),
            );
        }
    }

    // Inspect every PATH entry instead of asking the OS for only the first `java`. An old Java 8
    // earlier in PATH must not hide a usable Java 17+ later in it.
    if let Some(path) = std::env::var_os("PATH") {
        for folder in std::env::split_paths(&path) {
            push_unique(&mut candidates, folder.join(executable));
        }
    }
    // Keep the normal process lookup as a final PATH/App Paths fallback.
    push_unique(&mut candidates, PathBuf::from(executable));

    // Finder-launched apps do not inherit the interactive shell PATH. Homebrew's OpenJDK formula
    // is also intentionally not linked into /Library/Java/JavaVirtualMachines by default, so it
    // was invisible even though Java 17+ was installed and usable from Terminal.
    if cfg!(target_os = "macos") {
        for java in macos_homebrew_java_candidates() {
            push_unique(&mut candidates, java);
        }
    }

    for root in standard_java_roots() {
        for java in find_java_executables(&root) {
            push_unique(&mut candidates, java);
        }
    }
    candidates
}

fn macos_homebrew_java_candidates() -> Vec<PathBuf> {
    ["/opt/homebrew/opt", "/usr/local/opt"]
        .into_iter()
        .flat_map(|prefix| {
            ["openjdk@17", "openjdk@21", "openjdk"]
                .into_iter()
                .map(move |formula| {
                    PathBuf::from(prefix)
                        .join(formula)
                        .join("libexec")
                        .join("openjdk.jdk")
                        .join("Contents")
                        .join("Home")
                        .join("bin")
                        .join("java")
                })
        })
        .collect()
}

fn standard_java_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if cfg!(windows) {
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            let Some(folder) = std::env::var_os(variable).map(PathBuf::from) else {
                continue;
            };
            for vendor in [
                "Eclipse Adoptium",
                "Java",
                "Microsoft",
                "BellSoft",
                "Zulu",
                "Amazon Corretto",
            ] {
                push_unique(&mut roots, folder.join(vendor));
            }
        }
        if let Some(folder) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            push_unique(&mut roots, folder.join("Programs").join("Eclipse Adoptium"));
        }
    } else if cfg!(target_os = "macos") {
        push_unique(
            &mut roots,
            PathBuf::from("/Library/Java/JavaVirtualMachines"),
        );
        if let Some(folder) = std::env::var_os("HOME").map(PathBuf::from) {
            push_unique(&mut roots, folder.join("Library/Java/JavaVirtualMachines"));
        }
    } else {
        push_unique(&mut roots, PathBuf::from("/usr/lib/jvm"));
        push_unique(&mut roots, PathBuf::from("/usr/java"));
    }
    roots
}

fn push_unique(values: &mut Vec<PathBuf>, value: PathBuf) {
    if !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

async fn supported_java(java: &Path) -> bool {
    let mut probe = Command::new(java);
    probe
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut probe);
    let Ok(output) = probe.output().await else {
        return false;
    };
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    output.status.success()
        && parse_java_major(&stderr)
            .or_else(|| parse_java_major(&stdout))
            .is_some_and(|major| major >= 17)
}

fn parse_java_major(version_output: &str) -> Option<u32> {
    let value = version_output.split('"').nth(1).or_else(|| {
        version_output
            .split_whitespace()
            .map(|token| token.trim_matches('"'))
            .find(|token| {
                token
                    .chars()
                    .next()
                    .is_some_and(|character| character.is_ascii_digit())
            })
    })?;
    let mut parts = value.split('.');
    let first = parts.next()?.parse::<u32>().ok()?;
    if first == 1 {
        parts.next()?.parse().ok()
    } else {
        Some(first)
    }
}

async fn start_process(
    app: &AppHandle,
    java: &Path,
    runtime: &Path,
    developer_logging: Arc<AtomicBool>,
) -> Result<Arc<Process>, String> {
    let logger = DeveloperLogger {
        app: app.clone(),
        enabled: developer_logging,
    };
    logger.emit(
        "aniyomi-jvm",
        "info",
        &format!("starting Java extension runtime with {}", java.display()),
    );
    let mut command = Command::new(java);
    command
        .args(java_runtime_jvm_args(std::env::consts::OS))
        .arg(runtime)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(home) = java_home_from_executable(java) {
        command.env("JAVA_HOME", &home);
        if let Some(bin) = java.parent() {
            let mut paths = vec![bin.to_path_buf()];
            if let Some(existing) = std::env::var_os("PATH") {
                paths.extend(std::env::split_paths(&existing));
            }
            if let Ok(path) = std::env::join_paths(paths) {
                command.env("PATH", path);
            }
        }
    }
    if let Some(folder) = runtime.parent() {
        command.current_dir(folder);
    }
    hide_console(&mut command);
    let mut child = command
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
    let output_logger = logger.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                output_logger.emit("aniyomi-jvm:stdout", "debug", &line);
                continue;
            };
            let Some(id) = message.get("id").and_then(Value::as_str) else {
                output_logger.emit("aniyomi-jvm:stdout", "debug", &line);
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
    let error_logger = logger.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[aniyomi-jvm] {line}");
            error_logger.emit("aniyomi-jvm:stderr", "warn", &line);
        }
    });

    Ok(Arc::new(Process {
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        pending,
        sequence: AtomicU64::new(1),
        logger,
    }))
}

fn java_home_from_executable(java: &Path) -> Option<PathBuf> {
    let bin = java.parent()?;
    (bin.file_name().and_then(|name| name.to_str()) == Some("bin"))
        .then(|| bin.parent().map(Path::to_path_buf))
        .flatten()
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
        let process = start_process(app, &java, &runtime, self.developer_logging.clone()).await?;
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
pub fn jvm_extension_set_debug(enabled: bool, runtime: tauri::State<'_, Runtime>) {
    runtime.developer_logging.store(enabled, Ordering::Relaxed);
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

#[cfg(test)]
mod tests {
    use super::{java_home_from_executable, macos_homebrew_java_candidates, parse_java_major};
    use std::path::{Path, PathBuf};

    #[test]
    fn parses_modern_and_legacy_java_versions() {
        assert_eq!(
            parse_java_major(r#"openjdk version "21.0.7" 2025-04-15"#),
            Some(21)
        );
        assert_eq!(
            parse_java_major(r#"java version "17.0.12" 2024-07-16 LTS"#),
            Some(17)
        );
        assert_eq!(parse_java_major(r#"java version "1.8.0_451""#), Some(8));
        assert_eq!(parse_java_major("not a Java version"), None);
    }

    #[test]
    fn derives_java_home_from_macos_bundle_executable() {
        assert_eq!(
            java_home_from_executable(Path::new(
                "/Library/Java/JavaVirtualMachines/temurin-17.jre/Contents/Home/bin/java"
            )),
            Some(PathBuf::from(
                "/Library/Java/JavaVirtualMachines/temurin-17.jre/Contents/Home"
            ))
        );
        assert_eq!(java_home_from_executable(Path::new("java")), None);
    }

    #[test]
    fn includes_apple_silicon_and_intel_homebrew_java() {
        let candidates = macos_homebrew_java_candidates();
        assert!(candidates.contains(&PathBuf::from(
            "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/java"
        )));
        assert!(candidates.contains(&PathBuf::from(
            "/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/java"
        )));
    }
}
