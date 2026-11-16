//! Where the decrypting downloader's Widevine device *optionally* comes from.
//!
//! A device is NOT required. The primary decrypt path is izumi's own Widevine module, which needs
//! no `.wvd` identity at all; where the module is unavailable (macOS and the webview builds, or a
//! machine without it), playback falls back to Shaka through platform EME — the pre-DRM behaviour.
//! A resolved device is only an *accelerator* for the module path: it lets the engine skip the
//! decode/encode and write a clear fMP4 copy losslessly and near-instantly. So "no device" is an
//! ordinary, expected outcome — never a degraded mode — and nothing here may become a hard
//! dependency on a shipped identity.
//!
//! Resolution order (first hit wins), used only when a device is wanted:
//!   1. `IZUMI_WVD_PATH` — an explicit user-supplied device.
//!   2. A cached pool member under `<app data>/widevine/devices/<id>.wvd`, tracked in
//!      `<app data>/widevine/state.json` (fewest refusals first, then newest verified).
//!   3. A fresh pool member fetched from the gated device pool and cached (only when the pool is
//!      configured and no usable cache entry exists).
//!   4. A bundled `resources/widevine/device.wvd`, if a build or a user drops one in — always last
//!      and entirely OPTIONAL. No identity ships by default; a missing bundle is skipped, not fatal.
//!
//! With none of the four present, resolution returns a typed "no device" outcome ([`Resolution::None`]),
//! which the caller treats as "use the normal path" (module, else Shaka) — not as an error.
//!
//! The pool is configured by two build-time values, `IZUMI_CDM_BASE_URL` and `IZUMI_CDM_KEY`
//! (runtime env vars of the same names win, for development). Without both, the pool is disabled and
//! only the override and any bundle are considered — so a fork build behaves exactly as before.
//!
//! A pool fetch failure never breaks a download: it is logged and resolution carries on. A member
//! the licence server refuses (403/429) is counted, rotated away from for one automatic retry, and
//! deleted after its second refusal. `state.json` never holds keys or the gate secret.
//! See docs/drm-offline-downloads.md ("Device supply").

use std::future::Future;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::drm_download::LICENSE_FORBIDDEN_PREFIX;

/// At most this many pool members are cached; a third evicts the worst one.
const MAX_MEMBERS: usize = 2;
/// Hard cap for one member, applied to the downloaded pair and to the assembled `.wvd`. A real
/// device is ~3.5 KB, so anything near this is not a device.
const MAX_MEMBER_BYTES: usize = 64 * 1024;
/// The index lists a handful of devices; anything this large is not an index.
const MAX_INDEX_BYTES: usize = 256 * 1024;
/// A member refused this many times (without an acceptance in between) is deleted.
const REFUSALS_BEFORE_DELETE: u32 = 2;
/// The index is re-read when the cached state is older than this (at most once per process).
const INDEX_MAX_AGE_SECS: u64 = 24 * 60 * 60;
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
/// The gate accepts `exp` within 300 s; 120 s leaves room for clock skew without long-lived URLs.
const SIG_LIFETIME_SECS: u64 = 120;
/// Fresh members tried per resolution; each costs two requests, so a broken pool stays cheap.
const MAX_FRESH_ATTEMPTS: usize = 2;

// ----------------------------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------------------------

/// The gated device pool endpoint and its shared secret.
#[derive(Clone)]
pub(crate) struct PoolConfig {
    base: String,
    key: String,
}

/// A runtime value wins over the baked one; blank values count as absent.
fn pick_value(runtime: Option<String>, baked: Option<&str>) -> Option<String> {
    let runtime = runtime.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    runtime.or_else(|| {
        baked
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    })
}

/// Both the base URL and the key are required; either missing disables the pool.
fn pool_config_from(
    base_runtime: Option<String>,
    base_baked: Option<&str>,
    key_runtime: Option<String>,
    key_baked: Option<&str>,
) -> Option<PoolConfig> {
    let base = pick_value(base_runtime, base_baked)?;
    let key = pick_value(key_runtime, key_baked)?;
    Some(PoolConfig {
        base: base.trim_end_matches('/').to_string(),
        key,
    })
}

/// The pool configuration for this build: `option_env!` bakes the release values in, and the
/// same-named runtime env vars override them for development.
fn pool_config() -> Option<PoolConfig> {
    pool_config_from(
        std::env::var("IZUMI_CDM_BASE_URL").ok(),
        option_env!("IZUMI_CDM_BASE_URL"),
        std::env::var("IZUMI_CDM_KEY").ok(),
        option_env!("IZUMI_CDM_KEY"),
    )
}

// ----------------------------------------------------------------------------------------------
// Index model and validation
// ----------------------------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawIndex {
    schema: u32,
    cdm_version: Option<String>,
    #[serde(default)]
    devices: Vec<RawDevice>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawDevice {
    id: String,
    platform: String,
    sha256: Option<RawPair<String>>,
    bytes: Option<RawPair<u64>>,
    verified_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPair<T> {
    client_id: Option<T>,
    private_key: Option<T>,
}

/// One validated index entry: what to fetch and what it must hash to.
#[derive(Clone, Debug)]
pub(crate) struct PoolDevice {
    id: String,
    verified_at: String,
    client_id_sha: Vec<u8>,
    private_key_sha: Vec<u8>,
    client_id_len: usize,
    private_key_len: usize,
}

/// A validated index: devices newest-verified first.
#[derive(Clone, Debug)]
pub(crate) struct PoolIndex {
    cdm_version: String,
    devices: Vec<PoolDevice>,
}

/// Parse and validate `index.json`. Malformed entries are dropped; an index with no usable entry
/// is an error, which the caller treats as "pool unavailable" (never as "no devices").
fn parse_index(body: &[u8]) -> Result<PoolIndex, String> {
    let raw: RawIndex =
        serde_json::from_slice(body).map_err(|e| format!("index is not valid JSON: {e}"))?;
    if raw.schema != 1 {
        return Err(format!("unsupported index schema {}", raw.schema));
    }
    if raw.devices.is_empty() {
        return Err("index lists no devices".into());
    }
    let mut devices = Vec::new();
    for entry in raw.devices {
        match validate_device(entry) {
            Ok(device) => devices.push(device),
            Err(reason) => eprintln!("[wvd] skipping an index entry: {reason}"),
        }
    }
    if devices.is_empty() {
        return Err("index has no valid device entries".into());
    }
    devices.sort_by(|a, b| b.verified_at.cmp(&a.verified_at));
    Ok(PoolIndex {
        cdm_version: raw.cdm_version.unwrap_or_default(),
        devices,
    })
}

fn validate_device(entry: RawDevice) -> Result<PoolDevice, String> {
    let id = entry.id.to_ascii_lowercase();
    // The id becomes a file name and a URL path segment, so it must be exactly 16 hex digits.
    if id.len() != 16 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(format!("device id {:?} is not 16 hex digits", entry.id));
    }
    if !(entry.platform.starts_with("linux") || entry.platform.starts_with("win")) {
        return Err(format!("device {id} has unsupported platform {:?}", entry.platform));
    }
    let sha = entry.sha256.ok_or_else(|| format!("device {id} has no sha256"))?;
    let bytes = entry.bytes.ok_or_else(|| format!("device {id} has no byte sizes"))?;
    let client_id_sha = sha256_hex(sha.client_id.as_deref(), &id, "clientId")?;
    let private_key_sha = sha256_hex(sha.private_key.as_deref(), &id, "privateKey")?;
    let client_id_len = declared_len(bytes.client_id, &id, "clientId")?;
    let private_key_len = declared_len(bytes.private_key, &id, "privateKey")?;
    if client_id_len + private_key_len > MAX_MEMBER_BYTES {
        return Err(format!("device {id} declares more than {MAX_MEMBER_BYTES} bytes"));
    }
    Ok(PoolDevice {
        id,
        verified_at: entry.verified_at.unwrap_or_default(),
        client_id_sha,
        private_key_sha,
        client_id_len,
        private_key_len,
    })
}

fn sha256_hex(value: Option<&str>, id: &str, field: &str) -> Result<Vec<u8>, String> {
    let value = value.ok_or_else(|| format!("device {id} has no sha256.{field}"))?;
    let decoded = data_encoding::HEXLOWER_PERMISSIVE
        .decode(value.as_bytes())
        .map_err(|_| format!("device {id} sha256.{field} is not hex"))?;
    if decoded.len() != 32 {
        return Err(format!("device {id} sha256.{field} is not a SHA-256"));
    }
    Ok(decoded)
}

fn declared_len(value: Option<u64>, id: &str, field: &str) -> Result<usize, String> {
    match value {
        Some(n) if n > 0 && n <= MAX_MEMBER_BYTES as u64 => Ok(n as usize),
        Some(_) => Err(format!("device {id} bytes.{field} is out of range")),
        None => Err(format!("device {id} has no bytes.{field}")),
    }
}

// ----------------------------------------------------------------------------------------------
// Fetching (the gated pool)
// ----------------------------------------------------------------------------------------------

/// Lowercase hex HMAC-SHA256 over `<subject>.<exp>`, the gate's request signature.
fn sign(secret: &str, subject: &str, exp: u64) -> Result<String, String> {
    use hmac::{Hmac, Mac};
    let mut mac = <Hmac<sha2::Sha256> as Mac>::new_from_slice(secret.as_bytes())
        .map_err(|_| "could not key the request signature".to_string())?;
    mac.update(format!("{subject}.{exp}").as_bytes());
    Ok(data_encoding::HEXLOWER.encode(&mac.finalize().into_bytes()))
}

/// The two reads the resolver needs from the pool. A trait so tests can stand in for the network.
pub(crate) trait PoolSource {
    async fn index(&self) -> Result<PoolIndex, String>;
    /// `(client_id.bin, private_key.pem)` for one validated device.
    async fn pair(&self, device: &PoolDevice) -> Result<(Vec<u8>, Vec<u8>), String>;
}

/// The real pool over HTTPS through the shared client.
pub(crate) struct HttpPool {
    config: PoolConfig,
}

impl HttpPool {
    fn signed_url(&self, path: &str, subject: &str) -> Result<String, String> {
        let exp = unix_now() + SIG_LIFETIME_SECS;
        let sig = sign(&self.config.key, subject, exp)?;
        Ok(format!("{}/api/{path}?exp={exp}&sig={sig}", self.config.base))
    }

    /// GET with the gate header and a hard body cap. Errors never include the URL (it carries the
    /// signature) or the key.
    async fn get_capped(&self, url: &str, cap: usize) -> Result<Vec<u8>, String> {
        let mut response = crate::http_client()
            .get(url)
            .header("X-Izumi-Key", &self.config.key)
            .timeout(FETCH_TIMEOUT)
            .send()
            .await
            .map_err(|e| format!("request failed: {}", e.without_url()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }
        if response.content_length().is_some_and(|n| n > cap as u64) {
            return Err(format!("response is larger than {cap} bytes"));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("read failed: {}", e.without_url()))?
        {
            if body.len() + chunk.len() > cap {
                return Err(format!("response is larger than {cap} bytes"));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }
}

impl PoolSource for HttpPool {
    async fn index(&self) -> Result<PoolIndex, String> {
        let url = self.signed_url("index", "index")?;
        let body = self.get_capped(&url, MAX_INDEX_BYTES).await?;
        parse_index(&body)
    }

    async fn pair(&self, device: &PoolDevice) -> Result<(Vec<u8>, Vec<u8>), String> {
        let id = &device.id;
        let client_url = self.signed_url(&format!("device/{id}/client_id.bin"), id)?;
        let client_id = self.get_capped(&client_url, device.client_id_len).await?;
        let key_url = self.signed_url(&format!("device/{id}/private_key.pem"), id)?;
        let private_key = self.get_capped(&key_url, device.private_key_len).await?;
        Ok((client_id, private_key))
    }
}

/// Verify the pair against the index and build the `.wvd` in memory (the pair never touches disk).
/// The pool provisions Android-class L3 identities, so the device is typed accordingly.
fn assemble_wvd(device: &PoolDevice, client_id: &[u8], private_key_pem: &[u8]) -> Result<Vec<u8>, String> {
    use sha2::{Digest, Sha256};
    use widevine::device::{DeviceType, SecurityLevel};

    if client_id.len() + private_key_pem.len() > MAX_MEMBER_BYTES {
        return Err(format!("device {} is larger than {MAX_MEMBER_BYTES} bytes", device.id));
    }
    if Sha256::digest(client_id).as_slice() != device.client_id_sha.as_slice() {
        return Err(format!("device {} client id does not match the index hash", device.id));
    }
    if Sha256::digest(private_key_pem).as_slice() != device.private_key_sha.as_slice() {
        return Err(format!("device {} private key does not match the index hash", device.id));
    }
    let key = parse_private_key(private_key_pem)
        .map_err(|e| format!("device {} private key is unreadable: {e}", device.id))?;
    let built = widevine::Device::new(DeviceType::ANDROID, SecurityLevel::L3, key, client_id)
        .map_err(|e| format!("device {} is not a valid identity: {e}", device.id))?;
    let mut wvd = Vec::new();
    built
        .write_wvd(&mut wvd)
        .map_err(|e| format!("device {} could not be serialised: {e}", device.id))?;
    if wvd.len() > MAX_MEMBER_BYTES {
        return Err(format!("device {} is larger than {MAX_MEMBER_BYTES} bytes", device.id));
    }
    Ok(wvd)
}

/// Provisioning tools emit PKCS#1 (`RSA PRIVATE KEY`); accept PKCS#8 as well.
fn parse_private_key(pem: &[u8]) -> Result<rsa::RsaPrivateKey, String> {
    use rsa::pkcs1::DecodeRsaPrivateKey;
    use rsa::pkcs8::DecodePrivateKey;
    let text = std::str::from_utf8(pem).map_err(|_| "not UTF-8 PEM".to_string())?;
    rsa::RsaPrivateKey::from_pkcs1_pem(text)
        .or_else(|_| rsa::RsaPrivateKey::from_pkcs8_pem(text))
        .map_err(|e| e.to_string())
}

// ----------------------------------------------------------------------------------------------
// Cache state
// ----------------------------------------------------------------------------------------------

/// `state.json`: bookkeeping only — never keys, never the gate secret.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PoolState {
    /// When the index was last read successfully (unix seconds).
    #[serde(default)]
    index_checked_at: u64,
    #[serde(default)]
    members: Vec<Member>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Member {
    id: String,
    cdm_version: String,
    fetched_at: u64,
    last_used_at: u64,
    failures: u32,
    /// The index's `verifiedAt` (ISO 8601 sorts lexically), for newest-verified-first ordering.
    #[serde(default)]
    verified_at: String,
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn state_path(dir: &Path) -> PathBuf {
    dir.join("state.json")
}

fn member_path(dir: &Path, id: &str) -> PathBuf {
    dir.join("devices").join(format!("{id}.wvd"))
}

/// A missing or unreadable state is an empty cache, never an error.
fn load_state(dir: &Path) -> PoolState {
    std::fs::read(state_path(dir))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_state(dir: &Path, state: &PoolState) {
    let written = serde_json::to_vec_pretty(state)
        .map_err(|e| e.to_string())
        .and_then(|bytes| write_atomic(&state_path(dir), &bytes));
    if let Err(error) = written {
        eprintln!("[wvd] could not save the device cache state: {error}");
    }
}

/// Write via a temp file and rename, so a crash never leaves a half-written device or state.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    let written = std::fs::File::create(&tmp).and_then(|mut file| {
        file.write_all(bytes)?;
        file.sync_all()
    });
    if let Err(error) = written.and_then(|_| std::fs::rename(&tmp, path)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error.to_string());
    }
    Ok(())
}

/// Read a cached member, rejecting anything oversized or not a parseable device.
fn read_member(path: &Path) -> Result<Vec<u8>, String> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > MAX_MEMBER_BYTES as u64 {
        return Err("cached device is oversized".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    widevine::Device::read_wvd(bytes.as_slice()).map_err(|e| e.to_string())?;
    Ok(bytes)
}

fn remove_member(dir: &Path, state: &mut PoolState, id: &str) {
    let _ = std::fs::remove_file(member_path(dir, id));
    state.members.retain(|m| m.id != id);
}

/// Keep the slot count: drop the most-refused, least recently used member first.
fn evict_for_one_more(dir: &Path, state: &mut PoolState) {
    while state.members.len() >= MAX_MEMBERS {
        let worst = state
            .members
            .iter()
            .max_by(|a, b| {
                a.failures
                    .cmp(&b.failures)
                    .then(b.last_used_at.cmp(&a.last_used_at))
            })
            .map(|m| m.id.clone());
        match worst {
            Some(id) => remove_member(dir, state, &id),
            None => break,
        }
    }
}

/// Write a verified member atomically and record it.
fn store_member(
    dir: &Path,
    state: &mut PoolState,
    device: &PoolDevice,
    cdm_version: &str,
    wvd: &[u8],
    now: u64,
) -> Result<(), String> {
    if wvd.len() > MAX_MEMBER_BYTES {
        return Err(format!("device {} is larger than {MAX_MEMBER_BYTES} bytes", device.id));
    }
    // Write first: a failed write must not have evicted a working member already.
    write_atomic(&member_path(dir, &device.id), wvd)?;
    state.members.retain(|m| m.id != device.id);
    evict_for_one_more(dir, state);
    state.members.push(Member {
        id: device.id.clone(),
        cdm_version: cdm_version.to_string(),
        fetched_at: now,
        last_used_at: now,
        failures: 0,
        verified_at: device.verified_at.clone(),
    });
    Ok(())
}

// ----------------------------------------------------------------------------------------------
// Resolution
// ----------------------------------------------------------------------------------------------

/// Which slot a resolved device came from; also the identity a refusal is charged to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum DeviceOrigin {
    Override,
    Pool(String),
    Seed,
}

impl DeviceOrigin {
    fn label(&self) -> String {
        match self {
            Self::Override => "IZUMI_WVD_PATH".into(),
            Self::Pool(id) => format!("pool member {id}"),
            Self::Seed => "bundled seed".into(),
        }
    }
}

pub(crate) struct ResolvedDevice {
    pub(crate) bytes: Vec<u8>,
    pub(crate) origin: DeviceOrigin,
}

// Hand-written so a debug print never dumps the private key inside `bytes`.
impl std::fmt::Debug for ResolvedDevice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResolvedDevice")
            .field("origin", &self.origin)
            .field("bytes", &self.bytes.len())
            .finish()
    }
}

/// Everything resolution needs, gathered once per licence exchange.
pub(crate) struct DeviceSupply<P: PoolSource = HttpPool> {
    override_path: Option<PathBuf>,
    cache_dir: Option<PathBuf>,
    seed: Option<PathBuf>,
    pool: Option<P>,
    /// Set once the index has been refreshed this process, so it happens at most once.
    refresh_done: &'static AtomicBool,
}

static INDEX_REFRESHED: AtomicBool = AtomicBool::new(false);

/// Serialises cache reads/writes so two concurrent jobs cannot interleave `state.json` updates.
fn cache_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// The bundled seed, next to the capture ffmpeg resource (or flattened by some bundlers).
fn seed_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    use tauri::Manager;
    let resources = app.path().resource_dir().ok()?;
    [
        resources.join("resources").join("widevine").join("device.wvd"),
        resources.join("widevine").join("device.wvd"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

impl DeviceSupply<HttpPool> {
    pub(crate) fn from_app<R: Runtime>(app: &AppHandle<R>) -> Self {
        use tauri::Manager;
        Self {
            override_path: std::env::var_os("IZUMI_WVD_PATH").map(PathBuf::from),
            cache_dir: app.path().app_data_dir().ok().map(|d| d.join("widevine")),
            seed: seed_path(app),
            pool: pool_config().map(|config| HttpPool { config }),
            refresh_done: &INDEX_REFRESHED,
        }
    }
}

/// The outcome of a resolution: either a device to accelerate the module path, or none available.
///
/// `None` is not an error — it is the expected result on a machine with no override, no cache, no
/// configured pool and no bundled file. The caller simply uses the normal path (the module, else
/// Shaka). A genuine misconfiguration (`IZUMI_WVD_PATH` pointing at nothing, an unreadable file) is
/// still reported as `Err` so it is not silently ignored.
#[derive(Debug)]
pub(crate) enum Resolution {
    /// A usable device was found; use it to skip the module's decode/encode.
    Device(ResolvedDevice),
    /// No device is available. Decrypt through the module, falling back to Shaka — never an error.
    None,
}

impl<P: PoolSource> DeviceSupply<P> {
    /// Resolve the device to use, skipping origins already tried in this job.
    ///
    /// Returns [`Resolution::None`] (never an `Err`) when no device is available, so the caller is
    /// not forced to unwrap a stringly-typed "no device" error. An `Err` means a real problem the
    /// user should see, e.g. `IZUMI_WVD_PATH` set but unreadable.
    pub(crate) async fn resolve(&self, exclude: &[DeviceOrigin]) -> Result<Resolution, String> {
        let _guard = cache_lock().lock().await;
        if let Some(path) = &self.override_path {
            // An explicit device is authoritative: never silently swap it for another one.
            if exclude.contains(&DeviceOrigin::Override) {
                return Ok(Resolution::None);
            }
            if !path.is_file() {
                return Err("IZUMI_WVD_PATH is set but does not point at a readable device file.".into());
            }
            let bytes = std::fs::read(path)
                .map_err(|e| format!("Could not read the Widevine device: {e}"))?;
            return Ok(Resolution::Device(ResolvedDevice { bytes, origin: DeviceOrigin::Override }));
        }
        if let Some(dir) = &self.cache_dir {
            if let Some(device) = self.from_pool(dir, exclude).await {
                return Ok(Resolution::Device(device));
            }
        }
        // The bundled seed is entirely optional: a missing resource is simply skipped here, never a
        // failure. No identity ships by default.
        if !exclude.contains(&DeviceOrigin::Seed) {
            if let Some(bytes) = self.seed.as_ref().and_then(|p| std::fs::read(p).ok()) {
                return Ok(Resolution::Device(ResolvedDevice { bytes, origin: DeviceOrigin::Seed }));
            }
        }
        Ok(Resolution::None)
    }

    /// Cache first, then a fresh fetch. `None` means "fall through to the seed".
    async fn from_pool(&self, dir: &Path, exclude: &[DeviceOrigin]) -> Option<ResolvedDevice> {
        let now = unix_now();
        let mut state = load_state(dir);
        let had = state.members.len();
        state.members.retain(|m| member_path(dir, &m.id).is_file());
        let mut dirty = state.members.len() != had;

        let mut index = None;
        if let Some(pool) = &self.pool {
            let stale = now.saturating_sub(state.index_checked_at) > INDEX_MAX_AGE_SECS;
            if stale && !self.refresh_done.swap(true, Ordering::SeqCst) {
                index = refresh_index(pool, dir, &mut state, now).await;
                dirty = true;
            }
        }

        let picked = pick_cached(dir, &mut state, exclude, now);
        let picked = match (picked, &self.pool) {
            (Some(device), _) => Some(device),
            (None, Some(pool)) => {
                let index = match index {
                    Some(index) => Some(index),
                    None => pool
                        .index()
                        .await
                        .map_err(|e| eprintln!("[wvd] device pool unavailable: {e}"))
                        .ok(),
                };
                match index {
                    Some(index) => fetch_fresh(pool, dir, &mut state, &index, exclude, now).await,
                    None => None,
                }
            }
            (None, None) => None,
        };
        if dirty || picked.is_some() {
            save_state(dir, &state);
        }
        picked
    }

    /// A refusal: count it against a pool member (deleting it on the second) — the override and
    /// the seed are not ours to rotate, so they are left alone.
    pub(crate) async fn refused(&self, origin: &DeviceOrigin) {
        let (DeviceOrigin::Pool(id), Some(dir)) = (origin, &self.cache_dir) else {
            return;
        };
        let _guard = cache_lock().lock().await;
        let mut state = load_state(dir);
        let Some(member) = state.members.iter_mut().find(|m| &m.id == id) else {
            return;
        };
        member.failures += 1;
        if member.failures >= REFUSALS_BEFORE_DELETE {
            eprintln!("[wvd] pool member {id} refused twice; deleting it");
            remove_member(dir, &mut state, id);
        }
        save_state(dir, &state);
    }

    /// An accepted licence clears the member's refusal count, so only consecutive refusals delete it.
    pub(crate) async fn accepted(&self, origin: &DeviceOrigin) {
        let (DeviceOrigin::Pool(id), Some(dir)) = (origin, &self.cache_dir) else {
            return;
        };
        let _guard = cache_lock().lock().await;
        let mut state = load_state(dir);
        if let Some(member) = state.members.iter_mut().find(|m| &m.id == id && m.failures > 0) {
            member.failures = 0;
            save_state(dir, &state);
        }
    }
}

/// Re-read the index; on success drop members it no longer lists (retired by the publisher). Any
/// failure — including 401 or a malformed body — means "pool unavailable": the cache is kept.
async fn refresh_index<P: PoolSource>(
    pool: &P,
    dir: &Path,
    state: &mut PoolState,
    now: u64,
) -> Option<PoolIndex> {
    match pool.index().await {
        Ok(index) => {
            let retired: Vec<String> = state
                .members
                .iter()
                .filter(|m| !index.devices.iter().any(|d| d.id == m.id))
                .map(|m| m.id.clone())
                .collect();
            for id in retired {
                eprintln!("[wvd] pool member {id} is no longer published; dropping it");
                remove_member(dir, state, &id);
            }
            state.index_checked_at = now;
            Some(index)
        }
        Err(error) => {
            eprintln!("[wvd] device index refresh failed, keeping the cache: {error}");
            None
        }
    }
}

/// The best cached member not yet tried this job: fewest refusals, then newest verified.
fn pick_cached(
    dir: &Path,
    state: &mut PoolState,
    exclude: &[DeviceOrigin],
    now: u64,
) -> Option<ResolvedDevice> {
    let mut order: Vec<Member> = state
        .members
        .iter()
        .filter(|m| !exclude.contains(&DeviceOrigin::Pool(m.id.clone())))
        .cloned()
        .collect();
    order.sort_by(|a, b| {
        a.failures
            .cmp(&b.failures)
            .then(b.verified_at.cmp(&a.verified_at))
            .then(b.fetched_at.cmp(&a.fetched_at))
    });
    for member in order {
        match read_member(&member_path(dir, &member.id)) {
            Ok(bytes) => {
                if let Some(entry) = state.members.iter_mut().find(|m| m.id == member.id) {
                    entry.last_used_at = now;
                }
                return Some(ResolvedDevice { bytes, origin: DeviceOrigin::Pool(member.id) });
            }
            Err(error) => {
                eprintln!("[wvd] dropping unusable cached member {}: {error}", member.id);
                remove_member(dir, state, &member.id);
            }
        }
    }
    None
}

/// Fetch, verify, assemble and cache the newest published member not already cached or tried.
async fn fetch_fresh<P: PoolSource>(
    pool: &P,
    dir: &Path,
    state: &mut PoolState,
    index: &PoolIndex,
    exclude: &[DeviceOrigin],
    now: u64,
) -> Option<ResolvedDevice> {
    let candidates: Vec<&PoolDevice> = index
        .devices
        .iter()
        .filter(|d| {
            !state.members.iter().any(|m| m.id == d.id)
                && !exclude.contains(&DeviceOrigin::Pool(d.id.clone()))
        })
        .take(MAX_FRESH_ATTEMPTS)
        .collect();
    for device in candidates {
        let assembled = match pool.pair(device).await {
            Ok((client_id, key)) => assemble_wvd(device, &client_id, &key),
            Err(error) => Err(format!("device {} fetch failed: {error}", device.id)),
        };
        let bytes = match assembled {
            Ok(bytes) => bytes,
            Err(error) => {
                eprintln!("[wvd] {error}");
                continue;
            }
        };
        // A verified member is still used for this job when the cache cannot be written (read-only
        // or full data dir): the write failure must not cost the download.
        match store_member(dir, state, device, &index.cdm_version, &bytes, now) {
            Ok(()) => eprintln!("[wvd] cached pool member {}", device.id),
            Err(error) => eprintln!("[wvd] using pool member {} uncached: {error}", device.id),
        }
        return Some(ResolvedDevice { bytes, origin: DeviceOrigin::Pool(device.id.clone()) });
    }
    None
}

// ----------------------------------------------------------------------------------------------
// Licence exchange with one automatic rotation
// ----------------------------------------------------------------------------------------------

fn is_refusal(error: &str) -> bool {
    error.starts_with(LICENSE_FORBIDDEN_PREFIX)
}

/// Run `exchange` with a resolved device, if one is available.
///
/// `Ok(None)` is the typed "no device — use the normal path" outcome: it is returned when nothing
/// resolves (no override, cache, pool or bundle), and also when the only device(s) are refused by
/// the licence server. The caller treats it exactly like the licence-forbidden path: decrypt with
/// the module, falling back to Shaka. It is NOT an error.
///
/// `Ok(Some(value))` is a successful licence exchange. If the licence server refuses the first
/// device, the refusal is charged and the exchange is retried exactly once with the next device, so
/// a dead member costs one extra round trip instead of a failed download. A non-refusal error (a
/// genuine failure) is surfaced as `Err`.
pub(crate) async fn exchange_with_rotation<P, T, F, Fut>(
    supply: &DeviceSupply<P>,
    mut exchange: F,
) -> Result<Option<T>, String>
where
    P: PoolSource,
    F: FnMut(Vec<u8>) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    // No device at all is the normal case: hand straight back to the module / Shaka path.
    let first = match supply.resolve(&[]).await? {
        Resolution::Device(device) => device,
        Resolution::None => return Ok(None),
    };
    let first_error = match exchange(first.bytes).await {
        Ok(value) => {
            supply.accepted(&first.origin).await;
            return Ok(Some(value));
        }
        Err(error) => error,
    };
    if !is_refusal(&first_error) {
        return Err(first_error);
    }
    supply.refused(&first.origin).await;
    // The refused device had no replacement: there is effectively no usable device, so route to the
    // normal path rather than surfacing a refusal the caller would have to pattern-match on a string.
    let next = match supply.resolve(std::slice::from_ref(&first.origin)).await {
        Ok(Resolution::Device(device)) => device,
        Ok(Resolution::None) | Err(_) => return Ok(None),
    };
    eprintln!(
        "[wvd] {} was refused; retrying once with {}",
        first.origin.label(),
        next.origin.label()
    );
    match exchange(next.bytes).await {
        Ok(value) => {
            supply.accepted(&next.origin).await;
            Ok(Some(value))
        }
        Err(error) => {
            if is_refusal(&error) {
                supply.refused(&next.origin).await;
                // The second device was also refused: no usable device remains → normal path.
                return Ok(None);
            }
            Err(error)
        }
    }
}

// ----------------------------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // ---- fixtures ---------------------------------------------------------------------------

    /// A `getrandom`-backed RNG so the test can mint an RSA key without pulling in `rand`. It is
    /// cryptographically sound (every byte comes from the OS CSPRNG), which satisfies the
    /// `CryptoRngCore` bound `RsaPrivateKey::new` requires.
    struct OsCsprng;

    impl rsa::rand_core::RngCore for OsCsprng {
        fn next_u32(&mut self) -> u32 {
            let mut b = [0u8; 4];
            self.fill_bytes(&mut b);
            u32::from_le_bytes(b)
        }
        fn next_u64(&mut self) -> u64 {
            let mut b = [0u8; 8];
            self.fill_bytes(&mut b);
            u64::from_le_bytes(b)
        }
        fn fill_bytes(&mut self, dest: &mut [u8]) {
            getrandom::fill(dest).expect("OS CSPRNG");
        }
        fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rsa::rand_core::Error> {
            self.fill_bytes(dest);
            Ok(())
        }
    }
    impl rsa::rand_core::CryptoRng for OsCsprng {}

    /// A minimal but non-empty `ClientIdentification` protobuf: one `client_info` NameValue entry
    /// (`name = "izumi"`, `value = "test"`). Hand-encoded so the test needs no proto crate; it is a
    /// valid message that round-trips byte-for-byte through the encoder, and crucially it is
    /// non-empty, so the pool index's `bytes.clientId` stays within the `> 0` range the resolver
    /// requires. `client_info` is field 3 (length-delimited); NameValue uses field 1/2 strings.
    fn minimal_client_id() -> Vec<u8> {
        /// A length-delimited protobuf field: `(field_number << 3) | 2`, then a varint length, then
        /// the bytes. Lengths here are tiny, so a single-byte varint is enough.
        fn ld(field: u8, bytes: &[u8]) -> Vec<u8> {
            assert!(bytes.len() < 0x80, "fixture fields stay single-byte-length");
            let mut out = vec![(field << 3) | 2, bytes.len() as u8];
            out.extend_from_slice(bytes);
            out
        }
        let mut name_value = ld(1, b"izumi"); // NameValue.name
        name_value.extend(ld(2, b"test")); // NameValue.value
        ld(3, &name_value) // ClientIdentification.client_info[0]
    }

    /// A valid `.wvd` minted in-process, independent of any repo file. The identity is a freshly
    /// generated RSA private key plus the minimal `ClientIdentification` above, serialised exactly
    /// like a real Android L3 device. Generated once per test run — keygen is not free — and reused,
    /// standing in for the old bundled seed everywhere.
    fn seed_bytes() -> Vec<u8> {
        use std::sync::OnceLock;
        use widevine::device::{DeviceType, SecurityLevel};
        static WVD: OnceLock<Vec<u8>> = OnceLock::new();
        WVD.get_or_init(|| {
            // 2048-bit matches a real device; the `.wvd` stays ~1.2 KB, well under the size cap.
            let key = rsa::RsaPrivateKey::new(&mut OsCsprng, 2048).expect("generate an RSA key");
            let device = widevine::Device::new(
                DeviceType::ANDROID,
                SecurityLevel::L3,
                key,
                &minimal_client_id(),
            )
            .expect("build a device");
            let mut wvd = Vec::new();
            device.write_wvd(&mut wvd).expect("serialise the device");
            wvd
        })
        .clone()
    }

    /// Split a v2 `.wvd` back into the pool's published pair: (client_id.bin, PKCS#1 PEM).
    fn pair_from_wvd(wvd: &[u8]) -> (Vec<u8>, Vec<u8>) {
        use rsa::pkcs1::{DecodeRsaPrivateKey, EncodeRsaPrivateKey, LineEnding};
        assert_eq!(&wvd[..3], b"WVD");
        let key_len = u16::from_be_bytes([wvd[7], wvd[8]]) as usize;
        let key_der = &wvd[9..9 + key_len];
        let at = 9 + key_len;
        let cid_len = u16::from_be_bytes([wvd[at], wvd[at + 1]]) as usize;
        let client_id = wvd[at + 2..at + 2 + cid_len].to_vec();
        let key = rsa::RsaPrivateKey::from_pkcs1_der(key_der).unwrap();
        let pem = key.to_pkcs1_pem(LineEnding::LF).unwrap().as_bytes().to_vec();
        (client_id, pem)
    }

    fn sha_hex(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        data_encoding::HEXLOWER.encode(&Sha256::digest(bytes))
    }

    fn device_json(id: &str, verified: &str, client_id: &[u8], pem: &[u8]) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "platform": "linux-x64",
            "createdAt": "2026-11-01T00:00:00Z",
            "sha256": { "clientId": sha_hex(client_id), "privateKey": sha_hex(pem) },
            "bytes": { "clientId": client_id.len(), "privateKey": pem.len() },
            "verifiedAt": verified,
        })
    }

    fn index_json(devices: Vec<serde_json::Value>) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "schema": 1,
            "cdmVersion": "4.10.3112.0",
            "generatedAt": "2026-11-15T00:00:00Z",
            "devices": devices,
        }))
        .unwrap()
    }

    /// A fresh directory under `target/`, removed again by `Drop`.
    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("wvd-tests")
                .join(name);
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// An in-memory pool: a fixed index result and pairs by id, counting requests.
    struct FakePool {
        index: Result<Vec<u8>, String>,
        pairs: Vec<(String, Vec<u8>, Vec<u8>)>,
        index_calls: Mutex<u32>,
        pair_calls: Mutex<u32>,
    }

    impl FakePool {
        fn new(index: Result<Vec<u8>, String>, pairs: Vec<(&str, Vec<u8>, Vec<u8>)>) -> Self {
            Self {
                index,
                pairs: pairs
                    .into_iter()
                    .map(|(id, c, k)| (id.to_string(), c, k))
                    .collect(),
                index_calls: Mutex::new(0),
                pair_calls: Mutex::new(0),
            }
        }
    }

    impl PoolSource for FakePool {
        async fn index(&self) -> Result<PoolIndex, String> {
            *self.index_calls.lock().unwrap() += 1;
            parse_index(self.index.as_ref().map_err(Clone::clone)?)
        }

        async fn pair(&self, device: &PoolDevice) -> Result<(Vec<u8>, Vec<u8>), String> {
            *self.pair_calls.lock().unwrap() += 1;
            self.pairs
                .iter()
                .find(|(id, _, _)| *id == device.id)
                .map(|(_, c, k)| (c.clone(), k.clone()))
                .ok_or_else(|| "HTTP 404".to_string())
        }
    }

    fn supply(
        override_path: Option<PathBuf>,
        cache: Option<&Path>,
        seed: Option<PathBuf>,
        pool: Option<FakePool>,
    ) -> DeviceSupply<FakePool> {
        DeviceSupply {
            override_path,
            cache_dir: cache.map(Path::to_path_buf),
            seed,
            pool,
            // A fresh gate per test so the once-per-process refresh rule is observable.
            refresh_done: Box::leak(Box::new(AtomicBool::new(false))),
        }
    }

    /// Resolve and expect a device, so tests that assert an origin stay terse.
    async fn resolve_device<P: PoolSource>(
        s: &DeviceSupply<P>,
        exclude: &[DeviceOrigin],
    ) -> ResolvedDevice {
        match s.resolve(exclude).await.expect("resolution did not error") {
            Resolution::Device(device) => device,
            Resolution::None => panic!("expected a device, got no device"),
        }
    }

    /// Resolve and expect the typed "no device" outcome.
    async fn resolve_none<P: PoolSource>(s: &DeviceSupply<P>, exclude: &[DeviceOrigin]) {
        match s.resolve(exclude).await.expect("resolution did not error") {
            Resolution::None => {}
            Resolution::Device(device) => panic!("expected no device, got {:?}", device.origin),
        }
    }

    /// Write the bundled seed into the cache as member `id`, with the given refusal count.
    fn cache_member(dir: &Path, id: &str, failures: u32, verified: &str) {
        let mut state = load_state(dir);
        write_atomic(&member_path(dir, id), &seed_bytes()).unwrap();
        state.members.push(Member {
            id: id.into(),
            cdm_version: "4.10.3112.0".into(),
            fetched_at: 1,
            last_used_at: 1,
            failures,
            verified_at: verified.into(),
        });
        state.index_checked_at = unix_now();
        save_state(dir, &state);
    }

    fn seed_file(dir: &Path) -> PathBuf {
        let path = dir.join("seed.wvd");
        std::fs::write(&path, seed_bytes()).unwrap();
        path
    }

    // ---- configuration ----------------------------------------------------------------------

    #[test]
    fn pool_needs_both_values_and_runtime_wins() {
        assert!(pool_config_from(None, None, None, None).is_none());
        assert!(pool_config_from(None, Some("https://pool.example"), None, None).is_none());
        assert!(pool_config_from(Some(" ".into()), None, None, Some("k")).is_none());
        let config = pool_config_from(
            Some("https://dev.example/".into()),
            Some("https://baked.example"),
            None,
            Some("baked-key"),
        )
        .unwrap();
        assert_eq!(config.base, "https://dev.example");
        assert_eq!(config.key, "baked-key");
    }

    #[test]
    fn signature_matches_the_gate_vector() {
        // Computed once with node: createHmac('sha256', secret).update(`${subject}.${exp}`).
        assert_eq!(
            sign("izumi-test-secret", "index", 1_800_000_000).unwrap(),
            "9ef9a36a217f00947c56b5e688712155b1e500e12ed6e2c0096e96fb8988350f"
        );
        assert_eq!(
            sign("izumi-test-secret", "0123456789abcdef", 1_800_000_000).unwrap(),
            "10603394e12e75f0bb2cc1ab7dc8aa823cdb1d059cc4792a84f105a35a9ba8e6"
        );
    }

    // ---- index validation -------------------------------------------------------------------

    #[test]
    fn index_validation_rejects_bad_payloads() {
        let (cid, pem) = pair_from_wvd(&seed_bytes());
        let good = device_json("00112233445566aa", "2026-11-10T00:00:00Z", &cid, &pem);

        let ok = parse_index(&index_json(vec![good.clone()])).unwrap();
        assert_eq!(ok.devices.len(), 1);
        assert_eq!(ok.cdm_version, "4.10.3112.0");

        let mut schema2: serde_json::Value = serde_json::from_slice(&index_json(vec![good.clone()])).unwrap();
        schema2["schema"] = 2.into();
        assert!(parse_index(&serde_json::to_vec(&schema2).unwrap()).is_err(), "schema 2");

        assert!(parse_index(&index_json(vec![])).is_err(), "empty devices");

        let mut oversized = good.clone();
        oversized["bytes"]["privateKey"] = (MAX_MEMBER_BYTES as u64).into();
        assert!(parse_index(&index_json(vec![oversized.clone()])).is_err(), "oversized member");

        let mut bad_hex = good.clone();
        bad_hex["sha256"]["clientId"] = "zz".repeat(32).into();
        assert!(parse_index(&index_json(vec![bad_hex])).is_err(), "bad hex");

        let mut bad_platform = good.clone();
        bad_platform["platform"] = "darwin-arm64".into();
        assert!(parse_index(&index_json(vec![bad_platform])).is_err(), "platform");

        let mut bad_id = good.clone();
        bad_id["id"] = "../../etc".into();
        assert!(parse_index(&index_json(vec![bad_id])).is_err(), "id");

        assert!(parse_index(b"<html>").is_err(), "not JSON");

        // A bad entry beside a good one is dropped, not fatal.
        let mixed = parse_index(&index_json(vec![oversized, good])).unwrap();
        assert_eq!(mixed.devices.len(), 1);
        assert_eq!(mixed.devices[0].id, "00112233445566aa");
    }

    // ---- assembly + cache writes ------------------------------------------------------------

    #[test]
    fn assembles_a_device_that_reads_back() {
        let (cid, pem) = pair_from_wvd(&seed_bytes());
        let index = parse_index(&index_json(vec![device_json("aa00000000000001", "x", &cid, &pem)])).unwrap();
        let wvd = assemble_wvd(&index.devices[0], &cid, &pem).unwrap();
        let device = widevine::Device::read_wvd(wvd.as_slice()).unwrap();
        assert_eq!(device.device_type(), widevine::device::DeviceType::ANDROID);
        assert_eq!(device.security_level(), widevine::device::SecurityLevel::L3);
        // Same identity as the seed it was split from.
        assert_eq!(wvd, seed_bytes());
    }

    #[test]
    fn sha_mismatch_and_size_cap_are_rejected_before_writing() {
        let (cid, pem) = pair_from_wvd(&seed_bytes());
        let index = parse_index(&index_json(vec![device_json("aa00000000000002", "x", &cid, &pem)])).unwrap();
        let device = &index.devices[0];

        let mut tampered = cid.clone();
        tampered[10] ^= 0xff;
        assert!(assemble_wvd(device, &tampered, &pem).unwrap_err().contains("hash"));
        assert!(assemble_wvd(device, &cid, &[b'x'; MAX_MEMBER_BYTES]).unwrap_err().contains("larger"));

        let dir = TestDir::new("store-cap");
        let mut state = PoolState::default();
        let too_big = vec![0u8; MAX_MEMBER_BYTES + 1];
        assert!(store_member(&dir.0, &mut state, device, "v", &too_big, 1).is_err());
        assert!(!member_path(&dir.0, &device.id).exists(), "nothing written");
        assert!(state.members.is_empty());
    }

    #[test]
    fn writes_are_atomic_and_leave_no_temp_file() {
        let dir = TestDir::new("atomic");
        let path = member_path(&dir.0, "aa00000000000003");
        write_atomic(&path, b"first").unwrap();
        write_atomic(&path, b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");
        let names: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["aa00000000000003.wvd".to_string()]);
    }

    #[test]
    fn cache_holds_at_most_two_members() {
        let (cid, pem) = pair_from_wvd(&seed_bytes());
        let dir = TestDir::new("cap-two");
        let mut state = PoolState::default();
        let ids = ["aa00000000000011", "aa00000000000012", "aa00000000000013"];
        let index = parse_index(&index_json(
            ids.iter().map(|id| device_json(id, "x", &cid, &pem)).collect(),
        ))
        .unwrap();
        for (n, device) in index.devices.iter().enumerate() {
            store_member(&dir.0, &mut state, device, "v", &seed_bytes(), n as u64 + 1).unwrap();
        }
        assert_eq!(state.members.len(), MAX_MEMBERS);
        let files = std::fs::read_dir(dir.0.join("devices")).unwrap().count();
        assert_eq!(files, MAX_MEMBERS);
        // state.json carries bookkeeping only.
        save_state(&dir.0, &state);
        let text = std::fs::read_to_string(state_path(&dir.0)).unwrap();
        assert!(!text.contains("PRIVATE") && text.contains("failures") && text.contains("cdmVersion"));
    }

    // ---- resolution order -------------------------------------------------------------------

    #[tokio::test]
    async fn override_beats_cache_beats_seed() {
        let dir = TestDir::new("order");
        let cache = dir.0.join("cache");
        cache_member(&cache, "aa00000000000021", 0, "x");
        let seed = seed_file(&dir.0);
        let override_path = dir.0.join("override.wvd");
        std::fs::write(&override_path, seed_bytes()).unwrap();

        let all = supply(Some(override_path), Some(&cache), Some(seed.clone()), None);
        assert_eq!(resolve_device(&all, &[]).await.origin, DeviceOrigin::Override);

        let no_override = supply(None, Some(&cache), Some(seed.clone()), None);
        assert_eq!(
            resolve_device(&no_override, &[]).await.origin,
            DeviceOrigin::Pool("aa00000000000021".into())
        );

        // A bundled file present on disk is still preferred over having no device at all.
        let empty = dir.0.join("empty-cache");
        let seed_only = supply(None, Some(&empty), Some(seed), None);
        assert_eq!(resolve_device(&seed_only, &[]).await.origin, DeviceOrigin::Seed);

        // Nothing at all: the typed "no device" outcome, not an error.
        let nothing = supply(None, Some(&empty), None, None);
        resolve_none(&nothing, &[]).await;
    }

    #[tokio::test]
    async fn disabled_pool_uses_the_seed_without_touching_the_cache() {
        let dir = TestDir::new("disabled");
        let cache = dir.0.join("cache");
        let s = supply(None, Some(&cache), Some(seed_file(&dir.0)), None);
        assert_eq!(resolve_device(&s, &[]).await.origin, DeviceOrigin::Seed);
        assert!(!cache.exists(), "no cache directory is created without a pool");
    }

    #[tokio::test]
    async fn fetches_and_caches_a_member_when_the_cache_is_empty() {
        let (cid, pem) = pair_from_wvd(&seed_bytes());
        let dir = TestDir::new("fetch");
        let cache = dir.0.join("cache");
        let pool = FakePool::new(
            Ok(index_json(vec![
                device_json("aa00000000000031", "2026-11-01T00:00:00Z", &cid, &pem),
                device_json("aa00000000000032", "2026-11-12T00:00:00Z", &cid, &pem),
            ])),
            vec![("aa00000000000031", cid.clone(), pem.clone()), ("aa00000000000032", cid, pem)],
        );
        let s = supply(None, Some(&cache), Some(seed_file(&dir.0)), Some(pool));
        let first = resolve_device(&s, &[]).await;
        // Newest verified first.
        assert_eq!(first.origin, DeviceOrigin::Pool("aa00000000000032".into()));
        assert!(member_path(&cache, "aa00000000000032").is_file());
        assert_eq!(*s.pool.as_ref().unwrap().index_calls.lock().unwrap(), 1, "one index read");
        // The second resolution is served from the cache, with no more requests.
        let again = resolve_device(&s, &[]).await;
        assert_eq!(again.origin, first.origin);
        assert_eq!(*s.pool.as_ref().unwrap().pair_calls.lock().unwrap(), 1);
        let state = load_state(&cache);
        assert_eq!(state.members.len(), 1);
        assert_eq!(state.members[0].cdm_version, "4.10.3112.0");
    }

    #[tokio::test]
    async fn tampered_pair_falls_back_to_the_seed() {
        let (cid, pem) = pair_from_wvd(&seed_bytes());
        let dir = TestDir::new("tampered");
        let cache = dir.0.join("cache");
        let mut bad = cid.clone();
        bad[5] ^= 1;
        let pool = FakePool::new(
            Ok(index_json(vec![device_json("aa00000000000041", "x", &cid, &pem)])),
            vec![("aa00000000000041", bad, pem)],
        );
        let s = supply(None, Some(&cache), Some(seed_file(&dir.0)), Some(pool));
        assert_eq!(resolve_device(&s, &[]).await.origin, DeviceOrigin::Seed);
        assert!(!member_path(&cache, "aa00000000000041").exists());
    }

    #[tokio::test]
    async fn an_unwritable_cache_still_uses_the_fetched_member() {
        let (cid, pem) = pair_from_wvd(&seed_bytes());
        let dir = TestDir::new("unwritable");
        let cache = dir.0.join("cache");
        std::fs::create_dir_all(&cache).unwrap();
        // `devices` is a file, so the member cannot be written.
        std::fs::write(cache.join("devices"), b"not a directory").unwrap();
        let pool = FakePool::new(
            Ok(index_json(vec![device_json("aa00000000000045", "x", &cid, &pem)])),
            vec![("aa00000000000045", cid, pem)],
        );
        let s = supply(None, Some(&cache), Some(seed_file(&dir.0)), Some(pool));
        let device = resolve_device(&s, &[]).await;
        assert_eq!(device.origin, DeviceOrigin::Pool("aa00000000000045".into()));
        assert!(load_state(&cache).members.is_empty(), "not recorded as cached");
    }

    #[tokio::test]
    async fn unauthorised_index_keeps_the_cache_in_play() {
        let dir = TestDir::new("unauthorised");
        let cache = dir.0.join("cache");
        cache_member(&cache, "aa00000000000051", 0, "x");
        // Force the 24 h refresh so the failing index read is actually attempted.
        let mut state = load_state(&cache);
        state.index_checked_at = 0;
        save_state(&cache, &state);

        let pool = FakePool::new(Err("HTTP 401".into()), vec![]);
        let s = supply(None, Some(&cache), Some(seed_file(&dir.0)), Some(pool));
        let device = resolve_device(&s, &[]).await;
        assert_eq!(device.origin, DeviceOrigin::Pool("aa00000000000051".into()));
        assert_eq!(*s.pool.as_ref().unwrap().index_calls.lock().unwrap(), 1);
        assert!(member_path(&cache, "aa00000000000051").is_file(), "cache untouched");
        // A parse failure is treated the same way.
        let garbled = FakePool::new(Ok(b"{\"schema\":1,\"devices\":[]}".to_vec()), vec![]);
        let s = supply(None, Some(&cache), None, Some(garbled));
        assert_eq!(
            resolve_device(&s, &[]).await.origin,
            DeviceOrigin::Pool("aa00000000000051".into())
        );
    }

    #[tokio::test]
    async fn refresh_drops_retired_members_once_per_process() {
        let (cid, pem) = pair_from_wvd(&seed_bytes());
        let dir = TestDir::new("refresh");
        let cache = dir.0.join("cache");
        cache_member(&cache, "aa00000000000061", 0, "x");
        let mut state = load_state(&cache);
        state.index_checked_at = 0;
        save_state(&cache, &state);
        let pool = FakePool::new(
            Ok(index_json(vec![device_json("aa00000000000062", "x", &cid, &pem)])),
            vec![("aa00000000000062", cid, pem)],
        );
        let s = supply(None, Some(&cache), None, Some(pool));
        let device = resolve_device(&s, &[]).await;
        assert_eq!(device.origin, DeviceOrigin::Pool("aa00000000000062".into()));
        assert!(!member_path(&cache, "aa00000000000061").exists(), "retired member deleted");
        assert!(load_state(&cache).index_checked_at > 0);
        // Stale again, but this process already refreshed: no further index read.
        let mut state = load_state(&cache);
        state.index_checked_at = 0;
        save_state(&cache, &state);
        resolve_device(&s, &[]).await;
        assert_eq!(*s.pool.as_ref().unwrap().index_calls.lock().unwrap(), 1);
    }

    // ---- refusals and rotation --------------------------------------------------------------

    #[tokio::test]
    async fn refusals_rotate_and_delete_at_two() {
        let dir = TestDir::new("refusals");
        let cache = dir.0.join("cache");
        cache_member(&cache, "aa00000000000071", 0, "2026-11-12");
        cache_member(&cache, "aa00000000000072", 0, "2026-11-01");
        let s = supply(None, Some(&cache), Some(seed_file(&dir.0)), None);
        let a = DeviceOrigin::Pool("aa00000000000071".into());
        let b = DeviceOrigin::Pool("aa00000000000072".into());

        assert_eq!(resolve_device(&s, &[]).await.origin, a, "newest verified first");
        s.refused(&a).await;
        assert_eq!(load_state(&cache).members.iter().find(|m| m.id == "aa00000000000071").unwrap().failures, 1);
        assert_eq!(resolve_device(&s, &[]).await.origin, b, "a refused member goes to the back");

        s.refused(&a).await;
        assert!(!member_path(&cache, "aa00000000000071").exists(), "deleted at two refusals");
        assert_eq!(load_state(&cache).members.len(), 1);
        assert_eq!(resolve_device(&s, &[]).await.origin, b);

        // An acceptance clears the count, so refusals must be consecutive to delete.
        s.refused(&b).await;
        s.accepted(&b).await;
        s.refused(&b).await;
        assert!(member_path(&cache, "aa00000000000072").is_file());
    }

    fn forbidden() -> String {
        format!("{LICENSE_FORBIDDEN_PREFIX} refused (403)")
    }

    #[tokio::test]
    async fn a_refused_member_is_retried_once_with_the_next() {
        let dir = TestDir::new("rotation");
        let cache = dir.0.join("cache");
        cache_member(&cache, "aa00000000000081", 0, "2026-11-12");
        let s = supply(None, Some(&cache), Some(seed_file(&dir.0)), None);
        let calls = Mutex::new(0u32);
        let out = exchange_with_rotation(&s, |_device| {
            let n = {
                let mut c = calls.lock().unwrap();
                *c += 1;
                *c
            };
            async move { if n == 1 { Err(forbidden()) } else { Ok("keys") } }
        })
        .await;
        assert_eq!(out.unwrap(), Some("keys"), "the next device served the licence");
        assert_eq!(*calls.lock().unwrap(), 2, "exactly one extra licence round trip");
        assert_eq!(load_state(&cache).members[0].failures, 1);
    }

    #[tokio::test]
    async fn a_second_refusal_hands_back_to_the_normal_path() {
        let dir = TestDir::new("terminal");
        let cache = dir.0.join("cache");
        cache_member(&cache, "aa00000000000091", 0, "2026-11-12");
        let s = supply(None, Some(&cache), Some(seed_file(&dir.0)), None);
        let calls = Mutex::new(0u32);
        let out: Result<Option<()>, String> = exchange_with_rotation(&s, |_| {
            *calls.lock().unwrap() += 1;
            async { Err(forbidden()) }
        })
        .await;
        // Every device was refused, so there is no accelerator to use: the typed "no device"
        // outcome, which the caller routes to the normal path (module, else Shaka).
        assert_eq!(out.unwrap(), None);
        assert_eq!(*calls.lock().unwrap(), 2, "retried once, then handed to the normal path");

        // Other failures are not rotated and remain real errors.
        let calls = Mutex::new(0u32);
        let out: Result<Option<()>, String> = exchange_with_rotation(&s, |_| {
            *calls.lock().unwrap() += 1;
            async { Err("licence HTTP 400".to_string()) }
        })
        .await;
        assert!(out.is_err());
        assert_eq!(*calls.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn an_override_is_never_rotated() {
        let dir = TestDir::new("override-no-rotate");
        let override_path = seed_file(&dir.0);
        let s = supply(Some(override_path), None, Some(seed_file(&dir.0)), None);
        let calls = Mutex::new(0u32);
        let out: Result<Option<()>, String> = exchange_with_rotation(&s, |_| {
            *calls.lock().unwrap() += 1;
            async { Err(forbidden()) }
        })
        .await;
        // The override is refused and never swapped; with no second device the outcome is the
        // typed "no device" value, not an error — and the override was tried exactly once.
        assert_eq!(out.unwrap(), None);
        assert_eq!(*calls.lock().unwrap(), 1);
    }

    /// The headline requirement: a machine with no env override, no cache, no pool and no bundled
    /// file resolves cleanly to the typed "no device" outcome — never an error.
    #[tokio::test]
    async fn resolves_with_no_env_no_cache_and_no_bundle() {
        let dir = TestDir::new("no-device");
        let empty = dir.0.join("empty-cache");
        let s = supply(None, Some(&empty), None, None);
        resolve_none(&s, &[]).await;
        // And the exchange simply hands back to the normal path without calling the licence server.
        let calls = Mutex::new(0u32);
        let out: Result<Option<()>, String> = exchange_with_rotation(&s, |_| {
            *calls.lock().unwrap() += 1;
            async { Ok(()) }
        })
        .await;
        assert_eq!(out.unwrap(), None, "no device → no accelerator, use the normal path");
        assert_eq!(*calls.lock().unwrap(), 0, "no licence exchange is attempted without a device");
        assert!(!empty.exists(), "no cache directory is created when the pool is disabled");
    }

    /// A bundled file is still preferred when one is actually present (whether shipped by a build or
    /// dropped in by the user). Written in the test so it never depends on a repo resource.
    #[tokio::test]
    async fn a_present_bundle_is_still_preferred() {
        let dir = TestDir::new("present-bundle");
        let empty = dir.0.join("empty-cache");
        // Drop a real device file in, exactly as a user supplying their own would.
        let bundle = seed_file(&dir.0);
        let s = supply(None, Some(&empty), Some(bundle), None);
        assert_eq!(
            resolve_device(&s, &[]).await.origin,
            DeviceOrigin::Seed,
            "a present bundle is used in preference to no device"
        );
    }

    /// Fetch one member from a real pool (or a local stub) into `target/wvd-live`. Ignored by
    /// default; reads `IZUMI_CDM_BASE_URL` and `IZUMI_CDM_KEY` at runtime.
    #[tokio::test]
    #[ignore]
    async fn live_pool_fetch_caches_a_member() {
        let config = pool_config().expect("IZUMI_CDM_BASE_URL and IZUMI_CDM_KEY");
        let dir = TestDir::new("live");
        let s = DeviceSupply {
            override_path: None,
            cache_dir: Some(dir.0.clone()),
            seed: None,
            pool: Some(HttpPool { config }),
            refresh_done: Box::leak(Box::new(AtomicBool::new(false))),
        };
        let device = resolve_device(&s, &[]).await;
        let DeviceOrigin::Pool(id) = &device.origin else {
            panic!("expected a pool member, got {:?}", device.origin);
        };
        widevine::Device::read_wvd(device.bytes.as_slice()).expect("parseable device");
        let state = std::fs::read_to_string(state_path(&dir.0)).unwrap();
        eprintln!("live pool: cached {id} ({} bytes); state.json = {state}", device.bytes.len());
        assert!(member_path(&dir.0, id).is_file());
    }
}
