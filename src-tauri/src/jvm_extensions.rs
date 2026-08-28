use base64::Engine;
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::net::SocketAddr;
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
const CONSCRYPT_VERSION: &str = "2.6.2";
const CONSCRYPT_URL: &str = "https://repo1.maven.org/maven2/org/conscrypt/conscrypt-openjdk-uber/2.6.2/conscrypt-openjdk-uber-2.6.2.jar";
const CONSCRYPT_SHA256: &str = "f8a8f5020c66abc53a3d33cbc855ef8fc06187fa652fb3c0eda6c94e4335b2e9";
const MAX_EXTENSION_APK_BYTES: u64 = 32 * 1024 * 1024;
const MAX_EXTENSION_ICON_BYTES: u64 = 512 * 1024;
const MAX_CONVERTED_JAR_BYTES: u64 = 128 * 1024 * 1024;
static CONVERSION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[path = "jvm_runtime_args.rs"]
mod jvm_runtime_args;
use jvm_runtime_args::{
    java_runtime_jvm_args, tls_provider_security_path, tls_provider_security_properties,
};

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
        self.request_with_id(method, args, None).await
    }

    async fn request_with_id(
        &self,
        method: &str,
        args: Value,
        request_id: Option<String>,
    ) -> Result<Value, String> {
        let id =
            request_id.unwrap_or_else(|| self.sequence.fetch_add(1, Ordering::Relaxed).to_string());
        if id.is_empty()
            || id.len() > 128
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
        {
            return Err("Extension runtime request id is invalid".into());
        }
        let started = Instant::now();
        self.logger.emit(
            "aniyomi-jvm",
            "debug",
            &format!("request {id} started: {method}"),
        );
        let (sender, receiver) = oneshot::channel();
        let mut pending = self.pending.lock().await;
        if pending.contains_key(&id) {
            return Err("Extension runtime request id is already active".into());
        }
        pending.insert(id.clone(), sender);
        drop(pending);
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
                let _ = self.cancel(&id).await;
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

    async fn cancel(&self, request_id: &str) -> Result<(), String> {
        let request = json!({
            "id": format!("cancel-{}", self.sequence.fetch_add(1, Ordering::Relaxed)),
            "method": "cancel",
            "args": { "id": request_id },
        });
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(format!("{request}\n").as_bytes())
            .await
            .map_err(|error| format!("Extension runtime cancellation failed: {error}"))?;
        stdin
            .flush()
            .await
            .map_err(|error| format!("Extension runtime cancellation failed: {error}"))?;
        self.pending.lock().await.remove(request_id);
        Ok(())
    }
}

#[derive(Default)]
pub struct Runtime {
    startup: Mutex<()>,
    process: Mutex<Option<Arc<Process>>>,
    sources: RwLock<Option<Value>>,
    developer_logging: Arc<AtomicBool>,
    socks_proxy: RwLock<Option<SocketAddr>>,
    generation: AtomicU64,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn extension_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("extensions").join("jvm"))
}

fn safe_package_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else {
        None
    }
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || image_mime(bytes) != Some("image/png") || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    (width > 0 && height > 0 && width <= 4096 && height <= 4096).then_some((width, height))
}

/// Aniyomi's desktop runtime loads the converted JAR and therefore cannot expose the APK launcher
/// icon like the Android bridge does. The original APK is still inside the installed package,
/// though. Its density variants are ordinary images under `res/`; choose the largest square PNG
/// (or the largest recognised image when an extension uses WebP/JPEG) and return a webview-safe URL.
fn apk_icon_data_url(apk_bytes: &[u8]) -> Option<String> {
    let mut apk = zip::ZipArchive::new(Cursor::new(apk_bytes)).ok()?;
    let mut best: Option<((bool, u64, usize), &'static str, Vec<u8>)> = None;

    for index in 0..apk.len() {
        let mut entry = apk.by_index(index).ok()?;
        if entry.is_dir()
            || !entry.name().starts_with("res/")
            || entry.size() == 0
            || entry.size() > MAX_EXTENSION_ICON_BYTES
        {
            continue;
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        (&mut entry)
            .take(MAX_EXTENSION_ICON_BYTES + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        if bytes.len() as u64 > MAX_EXTENSION_ICON_BYTES {
            continue;
        }
        let Some(mime) = image_mime(&bytes) else {
            continue;
        };
        let dimensions = png_dimensions(&bytes);
        let score = (
            dimensions.is_some_and(|(width, height)| width == height),
            dimensions
                .map(|(width, height)| u64::from(width) * u64::from(height))
                .unwrap_or_default(),
            bytes.len(),
        );
        if best.as_ref().is_none_or(|(current, _, _)| score > *current) {
            best = Some((score, mime, bytes));
        }
    }

    let (_, mime, bytes) = best?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn packaged_extension_icon(app: &AppHandle, package_id: &str) -> Option<String> {
    if !safe_package_id(package_id) {
        return None;
    }
    let path = data_dir(app)
        .ok()?
        .join("extensions")
        .join(format!("{package_id}.izumi-ext"));
    let file = std::fs::File::open(path).ok()?;
    let mut package = zip::ZipArchive::new(file).ok()?;
    let mut apk = package.by_name("extension.apk").ok()?;
    if apk.is_dir() || apk.size() == 0 || apk.size() > MAX_EXTENSION_APK_BYTES {
        return None;
    }
    let mut bytes = Vec::with_capacity(apk.size() as usize);
    (&mut apk)
        .take(MAX_EXTENSION_APK_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_EXTENSION_APK_BYTES {
        return None;
    }
    apk_icon_data_url(&bytes)
}

fn inline_desktop_source_icons(app: &AppHandle, sources: &mut Value) {
    let Some(sources) = sources.as_array_mut() else {
        return;
    };
    for source in sources {
        if source
            .get("iconUrl")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty())
        {
            continue;
        }
        let Some(package_id) = source
            .get("pkgName")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            continue;
        };
        if let Some(icon) = packaged_extension_icon(app, &package_id) {
            source["iconUrl"] = Value::String(icon);
        }
    }
}

fn runtime_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?
        .join("extensions")
        .join("runtime")
        .join(format!("anymex-desktop-{RUNTIME_VERSION}.jar")))
}

fn conscrypt_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?
        .join("extensions")
        .join("runtime")
        .join(format!("conscrypt-openjdk-uber-{CONSCRYPT_VERSION}.jar")))
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

async fn ensure_hashed_file(
    path: PathBuf,
    url: &str,
    sha256: &str,
    what: &str,
) -> Result<PathBuf, String> {
    if let Ok(bytes) = tokio::fs::read(&path).await {
        if digest(&bytes) == sha256 {
            return Ok(path);
        }
    }
    let response = reqwest::get(url)
        .await
        .map_err(|error| format!("Could not download the {what}: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Could not download the {what}: {error}"))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read the {what}: {error}"))?;
    if digest(&bytes) != sha256 {
        return Err(format!("Downloaded {what} failed its SHA-256 check"));
    }
    let parent = path.parent().ok_or(format!("{what} path has no parent"))?;
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

async fn ensure_runtime_file(app: &AppHandle) -> Result<PathBuf, String> {
    ensure_hashed_file(
        runtime_path(app)?,
        RUNTIME_URL,
        RUNTIME_SHA256,
        "extension runtime",
    )
    .await
}

async fn ensure_macos_tls_provider(app: &AppHandle) -> Result<PathBuf, String> {
    let jar = ensure_hashed_file(
        conscrypt_path(app)?,
        CONSCRYPT_URL,
        CONSCRYPT_SHA256,
        "JVM TLS provider",
    )
    .await?;
    tokio::fs::write(
        tls_provider_security_path(&jar),
        tls_provider_security_properties(),
    )
    .await
    .map_err(|error| format!("Could not install the JVM TLS provider: {error}"))?;
    Ok(jar)
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
    tls_provider_jar: Option<&Path>,
    developer_logging: Arc<AtomicBool>,
    socks_proxy: Option<SocketAddr>,
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
    if let Some(jar) = tls_provider_jar {
        logger.emit(
            "aniyomi-jvm",
            "info",
            &format!("using Conscrypt TLS provider {}", jar.display()),
        );
    }
    let args = runtime_jvm_args(std::env::consts::OS, tls_provider_jar, socks_proxy);
    if let Some(proxy) = socks_proxy {
        logger.emit(
            "aniyomi-jvm",
            "info",
            &format!("routing extension DNS through local DoH bridge {proxy}"),
        );
    }
    let mut command = Command::new(java);
    command
        .args(args)
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

/// The upstream converter embedded in runtime 2.3 extracts only `classes.dex` before invoking
/// dex2jar. Invoke dex2jar's own APK-aware CLI for multidex extensions instead; its
/// `MultiDexFileReader` consumes every `classesN.dex`. The verified APK is recovered from the
/// signed package, and extension_package adds its classpath assets to the generated JAR.
async fn ensure_multidex_extensions(
    app: &AppHandle,
    java: &Path,
    runtime: &Path,
) -> Result<(), String> {
    let app_for_read = app.clone();
    let packages = tauri::async_runtime::spawn_blocking(move || {
        crate::extension_package::aniyomi_multidex_packages(&app_for_read)
    })
    .await
    .map_err(|error| error.to_string())??;
    if packages.is_empty() {
        return Ok(());
    }

    let work_dir = data_dir(app)?
        .join("extensions")
        .join("runtime")
        .join("conversion");
    tokio::fs::create_dir_all(&work_dir)
        .await
        .map_err(|error| error.to_string())?;

    for (id, apk, apk_digest) in packages {
        if !safe_package_id(&id) {
            return Err("Aniyomi extension id is unsafe".into());
        }
        let marker = extension_dir(app)?.join(format!("{id}.multidex.sha256"));
        let installed_jar = extension_dir(app)?.join(format!("{id}.jar"));
        if installed_jar.is_file()
            && tokio::fs::read_to_string(&marker)
                .await
                .is_ok_and(|value| value.trim() == apk_digest)
        {
            continue;
        }

        let apk_path = work_dir.join(format!("{id}.apk"));
        let converted_path = work_dir.join(format!("{id}.converted.jar"));
        tokio::fs::write(&apk_path, &apk)
            .await
            .map_err(|error| error.to_string())?;
        if converted_path.exists() {
            tokio::fs::remove_file(&converted_path)
                .await
                .map_err(|error| error.to_string())?;
        }

        let mut command = Command::new(java);
        command
            .arg("-cp")
            .arg(runtime)
            .arg("com.googlecode.dex2jar.tools.Dex2jarCmd")
            .arg("--force")
            .arg("--dont-sanitize-names")
            .arg("--output")
            .arg(&converted_path)
            .arg(&apk_path)
            .current_dir(&work_dir)
            .kill_on_drop(true);
        hide_console(&mut command);
        let output = timeout(Duration::from_secs(180), command.output())
            .await
            .map_err(|_| format!("Converting multidex Aniyomi extension {id} timed out"))?
            .map_err(|error| {
                format!("Could not convert multidex Aniyomi extension {id}: {error}")
            })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Could not convert multidex Aniyomi extension {id}: {}",
                stderr.trim()
            ));
        }
        let metadata = tokio::fs::metadata(&converted_path)
            .await
            .map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_CONVERTED_JAR_BYTES {
            return Err(format!(
                "Converted Aniyomi extension {id} is invalid or too large"
            ));
        }
        let converted = tokio::fs::read(&converted_path)
            .await
            .map_err(|error| error.to_string())?;
        let app_for_store = app.clone();
        let store_id = id.clone();
        let store_apk = apk.clone();
        tauri::async_runtime::spawn_blocking(move || {
            crate::extension_package::store_converted_aniyomi_jar(
                &app_for_store,
                &store_id,
                &converted,
                &store_apk,
            )
        })
        .await
        .map_err(|error| error.to_string())??;
        let marker_temporary = marker.with_extension("sha256.part");
        tokio::fs::write(&marker_temporary, format!("{apk_digest}\n"))
            .await
            .map_err(|error| error.to_string())?;
        if marker.exists() {
            tokio::fs::remove_file(&marker)
                .await
                .map_err(|error| error.to_string())?;
        }
        tokio::fs::rename(marker_temporary, marker)
            .await
            .map_err(|error| error.to_string())?;
        let _ = tokio::fs::remove_file(apk_path).await;
        let _ = tokio::fs::remove_file(converted_path).await;
    }
    Ok(())
}

/// Convert an APK selected from a native Aniyomi repository into the desktop runtime's JAR form.
/// dex2jar receives the APK itself so its MultiDex reader includes every `classesN.dex` file.
pub(crate) async fn convert_aniyomi_apk(
    app: &AppHandle,
    id: &str,
    apk: &[u8],
) -> Result<Vec<u8>, String> {
    if !safe_package_id(id) {
        return Err("Aniyomi extension id is unsafe".into());
    }
    if apk.is_empty() || apk.len() as u64 > MAX_EXTENSION_APK_BYTES {
        return Err("Aniyomi extension APK is invalid or too large".into());
    }
    let runtime = ensure_runtime_file(app).await?;
    let java = java_command(app).await?;
    let work_dir = data_dir(app)?
        .join("extensions")
        .join("runtime")
        .join("conversion");
    tokio::fs::create_dir_all(&work_dir)
        .await
        .map_err(|error| error.to_string())?;
    let sequence = CONVERSION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let stem = format!("{id}-{}-{sequence}", std::process::id());
    let apk_path = work_dir.join(format!("{stem}.apk"));
    let converted_path = work_dir.join(format!("{stem}.jar"));
    tokio::fs::write(&apk_path, apk)
        .await
        .map_err(|error| error.to_string())?;

    let result = async {
        let mut command = Command::new(java);
        command
            .arg("-cp")
            .arg(runtime)
            .arg("com.googlecode.dex2jar.tools.Dex2jarCmd")
            .arg("--force")
            .arg("--dont-sanitize-names")
            .arg("--output")
            .arg(&converted_path)
            .arg(&apk_path)
            .current_dir(&work_dir)
            .kill_on_drop(true);
        hide_console(&mut command);
        let output = timeout(Duration::from_secs(180), command.output())
            .await
            .map_err(|_| format!("Converting Aniyomi extension {id} timed out"))?
            .map_err(|error| format!("Could not convert Aniyomi extension {id}: {error}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Could not convert Aniyomi extension {id}: {}",
                stderr.trim()
            ));
        }
        let metadata = tokio::fs::metadata(&converted_path)
            .await
            .map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_CONVERTED_JAR_BYTES {
            return Err(format!(
                "Converted Aniyomi extension {id} is invalid or too large"
            ));
        }
        tokio::fs::read(&converted_path)
            .await
            .map_err(|error| error.to_string())
    }
    .await;

    let _ = tokio::fs::remove_file(apk_path).await;
    let _ = tokio::fs::remove_file(converted_path).await;
    result
}

fn runtime_jvm_args(
    os: &str,
    tls_provider_jar: Option<&Path>,
    socks_proxy: Option<SocketAddr>,
) -> Vec<String> {
    let mut args = java_runtime_jvm_args(os, tls_provider_jar);
    if let Some(proxy) = socks_proxy {
        let insert_at = args
            .iter()
            .position(|arg| arg == "-jar")
            .unwrap_or(args.len());
        args.splice(
            insert_at..insert_at,
            [
                format!("-DsocksProxyHost={}", proxy.ip()),
                format!("-DsocksProxyPort={}", proxy.port()),
                "-DsocksProxyVersion=5".to_string(),
            ],
        );
    }
    args
}

fn java_home_from_executable(java: &Path) -> Option<PathBuf> {
    let bin = java.parent()?;
    (bin.file_name().and_then(|name| name.to_str()) == Some("bin"))
        .then(|| bin.parent().map(Path::to_path_buf))
        .flatten()
}

impl Runtime {
    async fn ensure_started(&self, app: &AppHandle) -> Result<Arc<Process>, String> {
        // Only one caller may launch/load the host, but do not hold `process` across that work:
        // cancellation needs to take it immediately when an extension or loadExtensions wedges.
        let _startup = self.startup.lock().await;
        let generation = self.generation.load(Ordering::Acquire);
        {
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
        }
        let runtime = ensure_runtime_file(app).await?;
        let java = java_command(app).await?;
        ensure_multidex_extensions(app, &java, &runtime).await?;
        let tls_provider = if cfg!(target_os = "macos") {
            match ensure_macos_tls_provider(app).await {
                Ok(path) => Some(path),
                Err(error) => {
                    // Sources that do not need Android-like TLS still work on the bundled JSSE.
                    eprintln!("[aniyomi-jvm] Could not install the JVM TLS provider: {error}");
                    None
                }
            }
        } else {
            None
        };
        let folder = extension_dir(app)?;
        tokio::fs::create_dir_all(&folder)
            .await
            .map_err(|error| error.to_string())?;
        if self.generation.load(Ordering::Acquire) != generation {
            return Err("Extension runtime startup was cancelled".into());
        }
        let process = start_process(
            app,
            &java,
            &runtime,
            tls_provider.as_deref(),
            self.developer_logging.clone(),
            *self.socks_proxy.read().await,
        )
        .await?;
        if self.generation.load(Ordering::Acquire) != generation {
            let _ = process.child.lock().await.kill().await;
            return Err("Extension runtime startup was cancelled".into());
        }
        // Publish the child before loadExtensions so cancellation can terminate a runtime whose
        // extension initialization itself has become unresponsive. `startup` still prevents other
        // callers from using the process until initialization finishes.
        *self.process.lock().await = Some(process.clone());
        let sources = match process
            .request(
                "loadExtensions",
                json!({ "folderPath": folder.to_string_lossy() }),
            )
            .await
        {
            Ok(sources) => sources,
            Err(error) => {
                let mut current = self.process.lock().await;
                let owns_process = current
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &process));
                if owns_process {
                    current.take();
                }
                drop(current);
                if owns_process {
                    let _ = process.child.lock().await.kill().await;
                }
                *self.sources.write().await = None;
                return Err(error);
            }
        };
        let current = self.process.lock().await;
        let still_current = self.generation.load(Ordering::Acquire) == generation
            && current
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &process));
        if !still_current {
            drop(current);
            return Err("Extension runtime startup was cancelled".into());
        }
        *self.sources.write().await = Some(sources);
        drop(current);
        Ok(process)
    }

    async fn stop(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        if let Some(process) = self.process.lock().await.take() {
            let _ = process.child.lock().await.kill().await;
        }
        *self.sources.write().await = None;
    }

    async fn cancel_request(&self, request_id: &str) -> Result<(), String> {
        // Some converted Aniyomi extensions block inside their own HTTP stack and do not observe
        // the runtime's cooperative cancel message. Remove and terminate the current process while
        // holding the runtime lock so another request cannot reuse it during teardown. The next
        // call starts a clean host and reloads the already-converted extensions.
        self.generation.fetch_add(1, Ordering::AcqRel);
        let mut current = self.process.lock().await;
        let Some(process) = current.take() else {
            return Ok(());
        };
        let _ = process.cancel(request_id).await;
        let kill_result = process
            .child
            .lock()
            .await
            .kill()
            .await
            .map_err(|error| format!("Could not stop unresponsive extension runtime: {error}"));
        *self.sources.write().await = None;
        kill_result
    }

    pub(crate) async fn set_socks_proxy(&self, address: Option<SocketAddr>) {
        // Keep the same lock order as ensure_started so a setting change cannot
        // race a process launch using the previous resolver configuration.
        let mut process = self.process.lock().await;
        let mut configured = self.socks_proxy.write().await;
        if *configured == address {
            return;
        }
        self.generation.fetch_add(1, Ordering::AcqRel);
        *configured = address;
        if let Some(active) = process.take() {
            let _ = active.child.lock().await.kill().await;
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
    let mut sources = runtime
        .sources
        .read()
        .await
        .clone()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    inline_desktop_source_icons(&app, &mut sources);
    Ok(sources)
}

#[tauri::command]
pub async fn jvm_extension_call(
    app: AppHandle,
    method: String,
    args: Value,
    request_id: Option<String>,
    runtime: tauri::State<'_, Runtime>,
) -> Result<Value, String> {
    runtime
        .ensure_started(&app)
        .await?
        .request_with_id(&method, args, request_id)
        .await
}

#[tauri::command]
pub async fn jvm_extension_cancel(
    request_id: String,
    runtime: tauri::State<'_, Runtime>,
) -> Result<(), String> {
    runtime.cancel_request(&request_id).await
}

#[tauri::command]
pub async fn jvm_extension_reload(runtime: tauri::State<'_, Runtime>) -> Result<(), String> {
    runtime.stop().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        apk_icon_data_url, java_home_from_executable, macos_homebrew_java_candidates,
        parse_java_major, runtime_jvm_args,
    };
    use base64::Engine;
    use std::io::{Cursor, Write};
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};
    use std::path::{Path, PathBuf};
    use zip::write::SimpleFileOptions;

    fn png_header(width: u32, height: u32, marker: u8) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.push(marker);
        bytes
    }

    fn apk_fixture(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, bytes) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn recovers_largest_launcher_icon_from_obfuscated_apk_resources() {
        let small = png_header(48, 48, 1);
        let large = png_header(192, 192, 2);
        let unrelated = png_header(512, 256, 3);
        let apk = apk_fixture(&[
            ("res/9w.png", &small),
            ("res/o-.png", &large),
            ("res/banner.png", &unrelated),
            ("assets/not-an-icon.png", &unrelated),
        ]);

        assert_eq!(
            apk_icon_data_url(&apk),
            Some(format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(large)
            ))
        );
    }

    #[test]
    fn ignores_apks_without_a_renderable_resource_icon() {
        let apk = apk_fixture(&[("res/icon.xml", b"binary android xml")]);
        assert_eq!(apk_icon_data_url(&apk), None);
    }

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

    #[test]
    fn inserts_doh_bridge_properties_before_the_runtime_jar() {
        let proxy = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 43123);
        let args = runtime_jvm_args("windows", None, Some(proxy));
        let jar = args.iter().position(|arg| arg == "-jar").unwrap();
        assert!(args[..jar].contains(&"-DsocksProxyHost=127.0.0.1".to_string()));
        assert!(args[..jar].contains(&"-DsocksProxyPort=43123".to_string()));
        assert!(args[..jar].contains(&"-DsocksProxyVersion=5".to_string()));
    }
}
