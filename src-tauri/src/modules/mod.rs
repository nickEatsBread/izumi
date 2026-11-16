//! Optional native modules izumi downloads when something asks for them (a pack, or the user from a
//! prompt), installs in the background and keeps current.
//!
//! Only the recipes compiled into this file exist. A pack names a module by id and can never point
//! izumi at native code by URL; each recipe knows where its module comes from and how to verify it.
//! A module that this device does not need (Windows and Android play protected video in the webview)
//! is reported as not needed and never downloaded.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// A module izumi knows how to fetch.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub id: &'static str,
    pub name: &'static str,
    /// What it is for, in one line.
    pub purpose: &'static str,
    pub publisher: &'static str,
    pub approx_bytes: u64,
    /// The licence the module ships with, named for the review screen.
    pub licence: &'static str,
    /// Whether this device uses it at all.
    pub needed: bool,
}

const RECIPES: &[Recipe] = &[Recipe {
    id: "widevine",
    name: "Widevine",
    purpose: "Plays protected video in izumi's own player",
    publisher: "Google",
    approx_bytes: 21_970_001,
    licence: "Google's licence for the Widevine module",
    needed: cfg!(all(target_os = "linux", target_arch = "x86_64")),
}];

pub fn recipe(id: &str) -> Option<&'static Recipe> {
    RECIPES.iter().find(|r| r.id == id)
}

/// Who asked for a module. A module stays while anyone still wants it.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    requested_by: Vec<String>,
    licence_accepted_at: u64,
    licence_accepted_via: String,
}

type Wanted = BTreeMap<String, Request>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    /// Not wanted, or not needed on this device.
    Idle,
    Checking,
    Downloading,
    Installing,
    Ready,
    /// The last attempt failed; another runs after a pause, or on Retry.
    Failed,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    pub state: State,
    pub received: u64,
    pub total: u64,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[serde(flatten)]
    pub recipe: Recipe,
    pub wanted: bool,
    pub requested_by: Vec<String>,
    #[serde(flatten)]
    pub progress: Progress,
}

struct Shared {
    app: AppHandle,
    data: PathBuf,
    live: Mutex<BTreeMap<String, Progress>>,
    wake: tokio::sync::Notify,
}

static SHARED: OnceLock<Shared> = OnceLock::new();

/// Waits after a failed attempt before the next one; the last pause repeats until a retry or restart.
const BACKOFF: [Duration; 3] = [Duration::from_secs(30), Duration::from_secs(120), Duration::from_secs(600)];
/// How often the worker wakes on its own to run update checks.
const IDLE_WAKE: Duration = Duration::from_secs(6 * 60 * 60);

fn wanted_path(data: &Path) -> PathBuf {
    data.join("modules").join("wanted.json")
}

fn read_wanted(data: &Path) -> Wanted {
    std::fs::read(wanted_path(data))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_wanted(data: &Path, wanted: &Wanted) -> Result<(), String> {
    let path = wanted_path(data);
    std::fs::create_dir_all(path.parent().expect("has a parent")).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(wanted).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn unix_now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Adds `by` to the module's requesters. `by` is `pack:<id>` or `user`. Asking for a module records
/// that its licence was accepted through `by` (a pack's review screen or the player's prompt).
fn add_request(wanted: &mut Wanted, id: &str, by: &str) {
    let entry = wanted.entry(id.to_string()).or_insert_with(|| Request {
        requested_by: Vec::new(),
        licence_accepted_at: unix_now(),
        licence_accepted_via: by.to_string(),
    });
    if !entry.requested_by.iter().any(|b| b == by) {
        entry.requested_by.push(by.to_string());
    }
}

/// Drops `by` from the module's requesters; true when nobody wants the module any more.
fn drop_request(wanted: &mut Wanted, id: &str, by: &str) -> bool {
    let Some(entry) = wanted.get_mut(id) else { return false };
    entry.requested_by.retain(|b| b != by);
    if entry.requested_by.is_empty() {
        wanted.remove(id);
        return true;
    }
    false
}

fn installed_version(data: &Path, id: &str) -> Option<String> {
    match id {
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        "widevine" => crate::widevine::fetch::installed(data).map(|i| i.version),
        _ => {
            let _ = data;
            None
        }
    }
}

fn remove_files(data: &Path, id: &str) -> Result<(), String> {
    match id {
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        "widevine" => crate::widevine::fetch::remove(data).map_err(|e| format!("{e:#}")),
        _ => {
            let _ = data;
            Ok(())
        }
    }
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|e| e.to_string())
}

/// Downloads, verifies and installs one module; returns the installed version.
async fn install(shared: &'static Shared, id: &str, via: &str) -> Result<String, String> {
    match id {
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        "widevine" => {
            use crate::widevine::fetch;
            let _one_at_a_time = crate::widevine::DOWNLOAD.lock().await;
            if let Some(v) = installed_version(&shared.data, id) {
                return Ok(v);
            }
            let client = http()?;
            let progress = |received: u64, total: u64| shared.report(id, State::Downloading, received, total, None, None);
            let staged = fetch::stage(&client, &shared.data, &progress).await.map_err(|e| format!("{e:#}"))?;
            shared.report(id, State::Installing, 0, 0, None, None);
            let installed = fetch::accept(&shared.data, &staged.version, via).map_err(|e| format!("{e:#}"))?;
            Ok(installed.version)
        }
        _ => {
            let _ = (shared, via);
            Err(format!("izumi has no module called {id}"))
        }
    }
}

/// Installs a newer build when one is due; it is used from the next start.
async fn update(shared: &'static Shared, id: &str) {
    match id {
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        "widevine" => {
            let Ok(client) = http() else { return };
            let _one_at_a_time = crate::widevine::DOWNLOAD.lock().await;
            match crate::widevine::fetch::update_if_due(&client, &shared.data).await {
                Ok(Some(v)) => eprintln!("[modules] widevine {v} installed; it is used from the next start"),
                Ok(None) => {}
                Err(e) => eprintln!("[modules] widevine update check failed: {e:#}"),
            }
        }
        _ => {
            let _ = shared;
        }
    }
}

impl Shared {
    fn report(&self, id: &str, state: State, received: u64, total: u64, version: Option<String>, error: Option<String>) {
        let progress = Progress { id: id.to_string(), state, received, total, version, error };
        if let Ok(mut live) = self.live.lock() {
            live.insert(id.to_string(), progress.clone());
        }
        let _ = self.app.emit("module-progress", progress);
    }

    fn progress(&self, id: &str) -> Progress {
        let known = self.live.lock().ok().and_then(|live| live.get(id).cloned());
        known.unwrap_or_else(|| {
            let version = installed_version(&self.data, id);
            Progress {
                id: id.to_string(),
                state: if version.is_some() { State::Ready } else { State::Idle },
                received: 0,
                total: 0,
                version,
                error: None,
            }
        })
    }
}

/// The worker: installs every wanted, needed, missing module, retrying failures with a backoff, and
/// runs update checks for installed ones. Woken early by requests and retries.
async fn worker(shared: &'static Shared) {
    let mut failures: BTreeMap<String, usize> = BTreeMap::new();
    loop {
        let mut next = IDLE_WAKE;
        for (id, request) in read_wanted(&shared.data) {
            let Some(recipe) = recipe(&id) else { continue };
            if !recipe.needed {
                continue;
            }
            if let Some(version) = installed_version(&shared.data, &id) {
                failures.remove(&id);
                shared.report(&id, State::Ready, 0, 0, Some(version), None);
                update(shared, &id).await;
                continue;
            }
            shared.report(&id, State::Checking, 0, recipe.approx_bytes, None, None);
            match install(shared, &id, &request.licence_accepted_via).await {
                Ok(version) => {
                    failures.remove(&id);
                    eprintln!("[modules] {id} {version} ready");
                    shared.report(&id, State::Ready, 0, 0, Some(version), None);
                }
                Err(error) => {
                    let count = failures.entry(id.clone()).or_insert(0);
                    let pause = BACKOFF[(*count).min(BACKOFF.len() - 1)];
                    *count += 1;
                    eprintln!("[modules] {id} failed ({error}); trying again in {}s", pause.as_secs());
                    shared.report(&id, State::Failed, 0, 0, None, Some(error));
                    next = next.min(pause);
                }
            }
        }
        tokio::select! {
            _ = shared.wake.notified() => {}
            _ = tokio::time::sleep(next) => {}
        }
    }
}

/// Starts the background worker. Call once from app setup.
pub fn start(app: &AppHandle) {
    let Ok(data) = app.path().app_data_dir() else { return };
    let shared = Shared { app: app.clone(), data, live: Mutex::new(BTreeMap::new()), wake: tokio::sync::Notify::new() };
    if SHARED.set(shared).is_err() {
        return;
    }
    let shared = SHARED.get().expect("just set");
    tauri::async_runtime::spawn(worker(shared));
}

fn shared() -> Result<&'static Shared, String> {
    SHARED.get().ok_or_else(|| "modules are not ready yet".to_string())
}

fn status_of(shared: &Shared, wanted: &Wanted, recipe: &Recipe) -> Status {
    let request = wanted.get(recipe.id);
    Status {
        recipe: recipe.clone(),
        wanted: request.is_some(),
        requested_by: request.map(|r| r.requested_by.clone()).unwrap_or_default(),
        progress: shared.progress(recipe.id),
    }
}

/// Every module izumi knows, with whether it is wanted, installed or downloading here.
pub fn module_status() -> Result<Vec<Status>, String> {
    let shared = shared()?;
    let wanted = read_wanted(&shared.data);
    Ok(RECIPES.iter().map(|r| status_of(shared, &wanted, r)).collect())
}

/// Asks for a module on behalf of `by` and wakes the worker. The caller has already shown the
/// module's licence (pack review screen or the player prompt).
pub fn module_request(id: String, by: String) -> Result<Status, String> {
    let shared = shared()?;
    let recipe = recipe(&id).ok_or_else(|| format!("izumi has no module called {id}"))?;
    if !valid_requester(&by) {
        return Err("bad requester".into());
    }
    let mut wanted = read_wanted(&shared.data);
    add_request(&mut wanted, &id, &by);
    write_wanted(&shared.data, &wanted)?;
    shared.wake.notify_one();
    Ok(status_of(shared, &wanted, recipe))
}

/// Tries a failed download again now.
pub fn module_retry() -> Result<(), String> {
    shared()?.wake.notify_one();
    Ok(())
}

/// Withdraws `by`'s request; deletes the module once nobody wants it. With `by` = None every
/// request goes and the module is deleted (the Remove button in Settings).
pub fn module_release(id: String, by: Option<String>) -> Result<(), String> {
    let shared = shared()?;
    recipe(&id).ok_or_else(|| format!("izumi has no module called {id}"))?;
    let mut wanted = read_wanted(&shared.data);
    let gone = match by.as_deref() {
        Some(by) => drop_request(&mut wanted, &id, by),
        None => {
            wanted.remove(&id);
            true
        }
    };
    write_wanted(&shared.data, &wanted)?;
    if gone {
        remove_files(&shared.data, &id)?;
        shared.report(&id, State::Idle, 0, 0, None, None);
    }
    Ok(())
}

fn valid_requester(by: &str) -> bool {
    by == "user"
        || by.strip_prefix("pack:").is_some_and(|id| {
            !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_accumulate_and_release_in_any_order() {
        let mut wanted = Wanted::new();
        add_request(&mut wanted, "widevine", "pack:a");
        add_request(&mut wanted, "widevine", "user");
        add_request(&mut wanted, "widevine", "pack:a");
        assert_eq!(wanted["widevine"].requested_by, vec!["pack:a", "user"]);
        assert_eq!(wanted["widevine"].licence_accepted_via, "pack:a");
        assert!(!drop_request(&mut wanted, "widevine", "pack:a"));
        assert!(drop_request(&mut wanted, "widevine", "user"));
        assert!(wanted.is_empty());
        assert!(!drop_request(&mut wanted, "widevine", "user"));
    }

    #[test]
    fn requesters_are_users_or_pack_ids() {
        assert!(valid_requester("user"));
        assert!(valid_requester("pack:io.github.example.pack"));
        assert!(!valid_requester("pack:"));
        assert!(!valid_requester("pack:../x"));
        assert!(!valid_requester("someone"));
    }

    #[test]
    fn only_compiled_recipes_exist() {
        assert!(recipe("widevine").is_some());
        assert!(recipe("https://example.com/x.so").is_none());
        assert_eq!(recipe("widevine").unwrap().needed, cfg!(all(target_os = "linux", target_arch = "x86_64")));
    }

    #[test]
    fn wanted_list_survives_a_round_trip() {
        let dir = std::env::temp_dir().join(format!("izumi-modules-{}", std::process::id()));
        let mut wanted = Wanted::new();
        add_request(&mut wanted, "widevine", "pack:a");
        write_wanted(&dir, &wanted).unwrap();
        let back = read_wanted(&dir);
        assert_eq!(back["widevine"].requested_by, vec!["pack:a"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
