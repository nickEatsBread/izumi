//! Durable on-disk mirror of the webview's preference storage.
//!
//! Every setting the app has lives in the webview's `localStorage` and nowhere else, which makes it
//! the least durable storage the app uses. WebKit and WebView2 both treat it as evictable cache:
//! the OS reclaims it under disk pressure, "clear website data" removes it, and a webview data
//! migration can drop it. When that happens the user does not get an error, they get an app that
//! has silently forgotten every preference, sign-in and watch position — with no local copy to go
//! back to, because the only existing backup is a file the user had to remember to export by hand.
//!
//! This keeps a plain, pretty-printed JSON copy beside the app's own config so a wipe of webview
//! storage is recoverable, and so preferences can actually be read (and diffed) during development
//! instead of being locked inside an opaque WebKit database.
//!
//! It lives in `app_config_dir`, which is deliberate: `reset::directories` wipes that directory, so
//! "Reset izumi to defaults" removes this snapshot in the same pass. A snapshot that outlived a
//! factory reset would be restored on the next boot and quietly undo it.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Current snapshot. Named plainly because a human looking for their settings should find it.
pub const SNAPSHOT: &str = "preferences.json";
/// Previous generation, kept so a snapshot written from already-damaged storage is not the only
/// copy left. Restore falls back to this when the current file is missing or unreadable.
pub const SNAPSHOT_PREVIOUS: &str = "preferences.previous.json";
/// Scratch file for the write-then-rename below. Never read.
const SNAPSHOT_TEMP: &str = "preferences.json.tmp";

/// Preferences are small (tens of KB). A snapshot far past that is a bug or a caller pushing
/// library data through the wrong door, and writing it every time would cost more than it saves.
const MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    /// Absolute path, surfaced in Settings so the file can be found without guessing.
    pub path: String,
    pub bytes: usize,
    /// Epoch millis of the write, or of the file's mtime when loading.
    pub saved_at: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSnapshot {
    pub contents: String,
    #[serde(flatten)]
    pub meta: SnapshotMeta,
    /// True when the current file was unusable and the previous generation was read instead.
    pub recovered_from_previous: bool,
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|error| error.to_string())
}

fn modified_millis(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let since = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    u64::try_from(since.as_millis()).ok()
}

/// Write via temp file + rename so a crash, power cut or full disk mid-write can never leave a
/// half-written snapshot in place. Without this the recovery path is strictly worse than no
/// snapshot at all: it would restore truncated JSON over storage that was merely evicted.
fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "snapshot has no parent directory"))?;
    std::fs::create_dir_all(dir)?;
    let temp = dir.join(SNAPSHOT_TEMP);
    {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(contents.as_bytes())?;
        // Flush the bytes to the platter before the rename publishes them. A rename that lands
        // before its own data is exactly how an empty-but-present snapshot appears after a crash.
        file.sync_all()?;
    }
    std::fs::rename(&temp, path)?;
    // The rename is only durable once the directory entry is too.
    #[cfg(unix)]
    if let Ok(handle) = std::fs::File::open(dir) {
        let _ = handle.sync_all();
    }
    Ok(())
}

fn read_if_usable(path: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(path).ok()?;
    // A present-but-empty file is the signature of an interrupted write by some older build or an
    // external tool. Treat it as absent so the caller falls through to the previous generation.
    if contents.trim().is_empty() {
        return None;
    }
    // Refuse to hand back anything that is not parseable, for the same reason.
    serde_json::from_str::<serde::de::IgnoredAny>(&contents).ok()?;
    Some(contents)
}

/// Read the newest usable snapshot, falling back to the previous generation.
#[tauri::command]
pub fn prefs_snapshot_load(app: AppHandle) -> Result<Option<LoadedSnapshot>, String> {
    let dir = config_dir(&app)?;
    for (name, recovered) in [(SNAPSHOT, false), (SNAPSHOT_PREVIOUS, true)] {
        let path = dir.join(name);
        if let Some(contents) = read_if_usable(&path) {
            return Ok(Some(LoadedSnapshot {
                meta: SnapshotMeta {
                    path: path.to_string_lossy().into_owned(),
                    bytes: contents.len(),
                    saved_at: modified_millis(&path),
                },
                contents,
                recovered_from_previous: recovered,
            }));
        }
    }
    Ok(None)
}

/// Replace the snapshot, rotating the current one to the previous generation first.
#[tauri::command]
pub fn prefs_snapshot_save(app: AppHandle, contents: String) -> Result<SnapshotMeta, String> {
    if contents.len() > MAX_BYTES {
        return Err(format!(
            "Preference snapshot is {} bytes, over the {MAX_BYTES} byte limit.",
            contents.len()
        ));
    }
    // Validate before touching either file. Rotating first and failing second would spend the one
    // good copy that exists to store a bad one.
    serde_json::from_str::<serde::de::IgnoredAny>(&contents)
        .map_err(|error| format!("Refusing to save a snapshot that is not valid JSON: {error}"))?;

    let dir = config_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(SNAPSHOT);

    if read_if_usable(&path).is_some() {
        // Best effort: losing the previous generation is survivable, refusing to save is not.
        let _ = std::fs::rename(&path, dir.join(SNAPSHOT_PREVIOUS));
    }
    write_atomic(&path, &contents).map_err(|error| error.to_string())?;
    Ok(SnapshotMeta {
        path: path.to_string_lossy().into_owned(),
        bytes: contents.len(),
        saved_at: modified_millis(&path),
    })
}

/// Remove both generations. Used by the preferences-only wipe, which must not leave a snapshot
/// behind for the next boot to restore.
#[tauri::command]
pub fn prefs_snapshot_clear(app: AppHandle) -> Result<(), String> {
    let dir = config_dir(&app)?;
    for name in [SNAPSHOT, SNAPSHOT_PREVIOUS, SNAPSHOT_TEMP] {
        match std::fs::remove_file(dir.join(name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("izumi-prefs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn write_atomic_leaves_no_temp_file_behind() {
        let dir = temp_dir("atomic");
        let path = dir.join(SNAPSHOT);
        write_atomic(&path, "{\"a\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":1}");
        assert!(!dir.join(SNAPSHOT_TEMP).exists());
    }

    #[test]
    fn write_atomic_replaces_existing_contents() {
        let dir = temp_dir("replace");
        let path = dir.join(SNAPSHOT);
        write_atomic(&path, "{\"a\":1}").unwrap();
        write_atomic(&path, "{\"b\":2}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"b\":2}");
    }

    #[test]
    fn empty_and_malformed_snapshots_read_as_absent() {
        let dir = temp_dir("damaged");
        let path = dir.join(SNAPSHOT);
        std::fs::write(&path, "").unwrap();
        assert!(read_if_usable(&path).is_none(), "empty file must not be restored over live storage");
        std::fs::write(&path, "{\"a\":").unwrap();
        assert!(read_if_usable(&path).is_none(), "truncated JSON must not be restored over live storage");
        std::fs::write(&path, "   \n ").unwrap();
        assert!(read_if_usable(&path).is_none());
    }

    #[test]
    fn valid_snapshot_reads_back() {
        let dir = temp_dir("valid");
        let path = dir.join(SNAPSHOT);
        std::fs::write(&path, "{\"localStorage\":{}}").unwrap();
        assert_eq!(read_if_usable(&path).as_deref(), Some("{\"localStorage\":{}}"));
    }

    #[test]
    fn missing_file_reads_as_absent() {
        let dir = temp_dir("missing");
        assert!(read_if_usable(&dir.join(SNAPSHOT)).is_none());
    }
}
