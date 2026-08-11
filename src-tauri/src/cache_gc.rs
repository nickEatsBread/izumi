//! Retention for everything izumi writes under the OS cache directory.
//!
//! All of these buckets regenerate on demand, so none of them is data the user would miss — but
//! until now only ONE of them was ever deleted, and only when the user found the button for it:
//!
//!   * `thumbs/`          scrub-preview tiles, ~9KB each, up to 144 per episode. Written on hover,
//!                        never removed. Every episode ever skimmed stayed on disk forever.
//!   * `direct-torrents/` the ephemeral P2P playback cache. It IS wiped — but by the torrent engine
//!                        on its NEXT startup, so a user who streams one torrent and never streams
//!                        another keeps the whole payload (hundreds of MB) indefinitely.
//!   * `subs/`            fetched subtitle sidecars, keyed by content hash. Never removed.
//!   * `gif-capture/`     frame scratch for the GIF recorder. Cleaned when a capture finishes;
//!                        leaked in full if the app was killed mid-capture.
//!
//! The policy is: drop what the session no longer needs as soon as it stops needing it, and keep a
//! size/age backstop for the cases where "as soon as" never arrived (a crash, a kill, a power cut).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};

/// Backstop only. The thumbnail cache is emptied per episode as playback moves on, so this cap is
/// what a session that ENDED BADLY leaves behind, not a steady state. Generous enough that a long
/// binge never evicts tiles it is about to re-hover.
pub const THUMB_CAP_BYTES: u64 = 250 * 1024 * 1024;

/// Subtitle sidecars are keyed by content hash, so they are re-fetchable but also re-usable across
/// rewatches. Age them out rather than dropping them with the episode.
const SUB_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// `.torrent` metadata is tiny compared with episode payloads and removes the slowest part of a
/// repeat play: exchanging metadata over DHT again. Keep it much longer than subtitle sidecars,
/// while still treating it as disposable cache data.
const TORRENT_METADATA_MAX_AGE: Duration = Duration::from_secs(90 * 24 * 60 * 60);

/// One cache bucket as reported to the Storage settings screen.
#[derive(serde::Serialize)]
pub struct CacheBucket {
    /// Stable id the frontend passes back to `clear_cache`.
    pub id: String,
    pub bytes: u64,
}

/// Buckets in the order the settings screen lists them. `downloads` is deliberately absent: it is
/// the offline library the user asked for, not a cache, and it lives under app DATA for that reason.
const BUCKETS: [&str; 5] = [
    "thumbs",
    "direct-torrents",
    "torrent-metadata",
    "subs",
    "gif-capture",
];

static GC_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map_err(|e| e.to_string())
}

pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let child = entry.path();
            if child.is_dir() {
                total += dir_size(&child);
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

/// Size of every bucket. Walks the tree, so callers run it off the event loop.
pub fn usage(app: &AppHandle) -> Result<Vec<CacheBucket>, String> {
    let root = cache_root(app)?;
    Ok(BUCKETS
        .iter()
        .map(|id| CacheBucket {
            id: (*id).to_string(),
            bytes: dir_size(&root.join(id)),
        })
        .collect())
}

/// Map a caller-supplied id onto real buckets. An arbitrary string must never be joined onto the
/// cache root — `..` segments would walk straight out of it and `remove_dir_all` something that is
/// not ours — so ids are matched against the fixed list instead of trusted as path components.
fn resolve_buckets(id: &str) -> Result<Vec<&'static str>, String> {
    if id == "all" {
        return Ok(BUCKETS.to_vec());
    }
    BUCKETS
        .iter()
        .find(|bucket| **bucket == id)
        .map(|bucket| vec![*bucket])
        .ok_or_else(|| format!("unknown cache bucket: {id}"))
}

/// Empty one bucket by id (or every bucket for `"all"`). Returns bytes freed.
pub fn clear(app: &AppHandle, id: &str) -> Result<u64, String> {
    let root = cache_root(app)?;
    let targets = resolve_buckets(id)?;
    let mut freed = 0;
    for bucket in targets {
        let dir = root.join(bucket);
        freed += dir_size(&dir);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
    }
    Ok(freed)
}

/// Delete one episode's tile directory. Called as playback leaves that episode.
pub fn drop_thumb_dir(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

/// Atomically move an abandoned direct-torrent payload out of the engine's live path. Renaming one
/// directory entry is effectively constant-time; recursively unlinking the episode can take long
/// enough to swallow the whole warm-up window on Windows. A unique name also lets a new process
/// recover a staged tree left by a kill without first waiting for it to disappear.
fn stage_direct_torrent_payload(root: &Path) -> Result<Option<PathBuf>, String> {
    let live = root.join("direct-torrents");
    if !live.exists() {
        return Ok(None);
    }
    let sequence = GC_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let staged = root.join(format!(
        "direct-torrents.gc-{}-{sequence}",
        std::process::id()
    ));
    std::fs::rename(&live, &staged)
        .map_err(|e| format!("Could not retire the old torrent cache: {e}"))?;
    Ok(Some(staged))
}

fn drop_staged_direct_torrents(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if (name == "direct-torrents.gc" || name.starts_with("direct-torrents.gc-"))
            && entry.path().is_dir()
        {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Return a fresh directory for the torrent engine without putting recursive deletion on its
/// startup path. Normal startup has already staged the previous payload; this second staging is a
/// backstop for tests/alternate entry points and for a startup sweep that could not run.
pub fn fresh_direct_torrent_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = cache_root(app)?;
    let staged = stage_direct_torrent_payload(&root)?;
    let live = root.join("direct-torrents");
    std::fs::create_dir_all(&live)
        .map_err(|e| format!("Could not create the torrent cache: {e}"))?;
    if let Some(staged) = staged {
        std::thread::Builder::new()
            .name("izumi-torrent-gc".into())
            .spawn(move || {
                let _ = std::fs::remove_dir_all(staged);
            })
            .ok();
    }
    Ok(live)
}

/// Evict least-recently-modified tile directories until `thumbs/` is under the cap. `keep` (the
/// episode currently playing) is never a candidate, however big it is — evicting the tiles being
/// hovered right now would just re-decode them a frame later.
pub fn enforce_thumb_cap(thumbs_root: &Path, keep: Option<&Path>) {
    let mut dirs: Vec<(SystemTime, u64, PathBuf)> = match std::fs::read_dir(thumbs_root) {
        Ok(entries) => entries
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter(|e| keep != Some(e.path().as_path()))
            .map(|e| {
                let modified = e
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                (modified, dir_size(&e.path()), e.path())
            })
            .collect(),
        Err(_) => return,
    };
    let mut total: u64 = dirs.iter().map(|(_, size, _)| size).sum();
    total += keep.map(dir_size).unwrap_or(0);
    if total <= THUMB_CAP_BYTES {
        return;
    }
    // Oldest first — least recently written is least likely to be hovered next.
    dirs.sort_by_key(|(modified, _, _)| *modified);
    for (_, size, path) in dirs {
        if total <= THUMB_CAP_BYTES {
            break;
        }
        if std::fs::remove_dir_all(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

/// Startup sweep: everything no longer-running session can still be using.
///
/// Runs off the main thread — it stats and unlinks whole trees, and on a cold disk the torrent
/// bucket alone can be hundreds of MB.
pub fn sweep_at_startup(app: &AppHandle) {
    let Ok(root) = cache_root(app) else { return };
    // Stage synchronously, before the webview can invoke torrent warm-up. Doing the rename inside
    // the detached worker leaves a small but real race where it can move the brand-new live folder
    // after librqbit has opened it. Only the recursive deletion belongs in the background.
    let _ = stage_direct_torrent_payload(&root);
    std::thread::Builder::new()
        .name("izumi-cache-gc".into())
        .spawn(move || {
            // Direct-torrent payloads were moved out of the live path above. This also reclaims a
            // staged tree left behind if the app was killed while an earlier sweep was unlinking it.
            drop_staged_direct_torrents(&root);

            // GIF scratch. No capture can be in flight before the window exists, so anything here
            // is from a session that was killed mid-recording.
            let _ = std::fs::remove_dir_all(root.join("gif-capture"));

            // Subtitle sidecars age out; they are shared across rewatches, so they are not tied to
            // an episode's lifetime the way tiles are.
            prune_older_than(&root.join("subs"), SUB_MAX_AGE);

            // Keep immutable metainfo across launches. This deliberately lives outside the
            // ephemeral payload directory, so starting the torrent engine cannot erase it.
            prune_older_than(&root.join("torrent-metadata"), TORRENT_METADATA_MAX_AGE);

            // Tiles are dropped per episode during a normal session. Anything left is from one that
            // ended abruptly, so apply the cap (and with no episode playing, nothing is exempt).
            enforce_thumb_cap(&root.join("thumbs"), None);
        })
        .ok();
}

fn prune_older_than(dir: &Path, max_age: Duration) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .map(|m| now.duration_since(m).unwrap_or_default() > max_age)
            .unwrap_or(false);
        if stale {
            let path = entry.path();
            let _ = if path.is_dir() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, bytes: usize) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, vec![0u8; bytes]).unwrap();
    }

    #[test]
    fn an_unknown_bucket_id_is_never_treated_as_a_path() {
        // The frontend supplies this id. Traversal must be rejected outright rather than joined
        // onto the cache root and handed to remove_dir_all.
        assert!(resolve_buckets("../..").is_err());
        assert!(resolve_buckets("thumbs/../../..").is_err());
        assert_eq!(resolve_buckets("thumbs").unwrap(), vec!["thumbs"]);
        assert_eq!(resolve_buckets("all").unwrap().len(), BUCKETS.len());
    }

    #[test]
    fn thumb_cap_evicts_oldest_first_and_spares_the_playing_episode() {
        let root = std::env::temp_dir().join(format!("izumi-gc-cap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let thumbs = root.join("thumbs");
        // Written oldest-first (mtime follows write order), each big enough that any two of them
        // breach the cap, so eviction has to choose.
        for name in ["old", "newer", "playing"] {
            write(
                &thumbs.join(name).join("t_0.jpg"),
                (THUMB_CAP_BYTES / 2 + 1) as usize,
            );
            std::thread::sleep(Duration::from_millis(20));
        }

        enforce_thumb_cap(&thumbs, Some(&thumbs.join("playing")));

        assert!(
            !thumbs.join("old").exists(),
            "the least recently written episode should go first"
        );
        assert!(
            thumbs.join("playing").exists(),
            "the episode being watched must never be evicted"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn pruning_keeps_fresh_files_and_drops_stale_ones() {
        let root = std::env::temp_dir().join(format!("izumi-gc-age-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        write(&root.join("fresh.srt"), 16);
        // Max age of zero makes every existing file stale, which is the branch worth pinning: the
        // walk must delete files it judges stale and leave the directory itself intact.
        prune_older_than(&root, Duration::from_secs(0));
        assert!(!root.join("fresh.srt").exists());
        assert!(root.exists(), "the bucket directory itself must survive");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn staging_a_torrent_payload_is_atomic_from_the_engines_point_of_view() {
        let root = std::env::temp_dir().join(format!(
            "izumi-gc-torrent-{}-{}",
            std::process::id(),
            GC_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&root);
        write(&root.join("direct-torrents").join("episode.mkv"), 16);

        let staged = stage_direct_torrent_payload(&root).unwrap().unwrap();

        assert!(!root.join("direct-torrents").exists());
        assert!(staged.join("episode.mkv").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
