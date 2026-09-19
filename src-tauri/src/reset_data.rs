//! Filesystem half of factory reset. Called before plugins or WebViews open any app files.
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const MARKER: &str = ".izumi-reset-pending";

fn path_error(action: &str, path: &Path, error: io::Error) -> io::Error {
    io::Error::new(
        error.kind(),
        format!("Could not {action} '{}': {error}", path.display()),
    )
}

fn name_allowed(name: &std::ffi::OsStr, allowed_names: &[&str]) -> bool {
    allowed_names.iter().any(|allowed| name == *allowed)
}

pub fn validate_roots(roots: &[PathBuf], allowed_names: &[&str]) -> io::Result<()> {
    for root in roots {
        // Only fixed, app-scoped directories supplied by the native path resolver are accepted.
        // Never accept download locations or any other path from frontend settings.
        let app_directory = root
            .file_name()
            .is_some_and(|name| name_allowed(name, allowed_names));
        let app_logs = root.file_name().is_some_and(|name| name == "logs")
            && root
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|name| name_allowed(name, allowed_names));
        if !root.is_absolute() || (!app_directory && !app_logs) {
            return Err(io::Error::other(
                "Refusing to reset a directory outside izumi's app folders",
            ));
        }
        match fs::symlink_metadata(root) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(io::Error::other(
                    "An izumi app folder is a link or is not a directory",
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(path_error("inspect app folder", root, error)),
            _ => {}
        }
    }
    Ok(())
}

pub fn clear_app_directories(roots: &[PathBuf], marker: &Path, allowed_names: &[&str]) -> io::Result<()> {
    // Validate ALL roots before deleting anything. Keep the marker until every directory succeeds,
    // so a locked file, crash or power loss retries the reset instead of booting partial old data.
    validate_roots(roots, allowed_names)?;
    for root in roots {
        let entries = match fs::read_dir(root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(path_error("read app folder", root, error)),
        };
        for entry in entries {
            let entry = entry.map_err(|error| path_error("read app folder entry", root, error))?;
            let path = entry.path();
            if path == marker {
                continue;
            }
            // remove_dir_all does not follow symlinks/junctions. A directory link itself is
            // removed using the directory API on Windows; Unix links use remove_file.
            let kind = entry
                .file_type()
                .map_err(|error| path_error("inspect", &path, error))?;
            if kind.is_dir() || (cfg!(windows) && kind.is_symlink() && path.is_dir()) {
                fs::remove_dir_all(&path)
                    .map_err(|error| path_error("remove directory", &path, error))?;
            } else {
                fs::remove_file(&path).map_err(|error| path_error("remove file", &path, error))?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static SEQUENCE: AtomicUsize = AtomicUsize::new(0);

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "izumi-reset-test-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }
        fn app(&self, parent: &str) -> PathBuf {
            let root = self.0.join(parent).join("com.nicho.izumi");
            fs::create_dir_all(&root).unwrap();
            root
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn clears_every_app_file_but_keeps_the_marker_and_external_files() {
        let fixture = Fixture::new();
        let config = fixture.app("config");
        let cache = fixture.app("cache");
        let marker = config.join(MARKER);
        fs::write(&marker, "pending").unwrap();
        for name in [
            "downloads/episode.mkv",
            "extensions/service/auth.json",
            "iroh-sync/sync-ticket",
            "EBWebView/Default/Local Storage/data",
            "logs/app.log",
        ] {
            let path = config.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "private data").unwrap();
        }
        fs::write(cache.join("subtitle.srt"), "cached").unwrap();
        let external = fixture.0.join("exported-backup.json");
        fs::write(&external, "keep").unwrap();
        // Windows/macOS can resolve several kinds of app directory to the same path.
        let roots = vec![
            config.clone(),
            cache.clone(),
            config.clone(),
            config.join("logs"),
        ];
        clear_app_directories(&roots, &marker, &["com.nicho.izumi"]).unwrap();
        assert!(marker.exists());
        assert_eq!(fs::read_dir(&config).unwrap().count(), 1);
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);
        assert_eq!(fs::read_to_string(external).unwrap(), "keep");
        clear_app_directories(&roots, &marker, &["com.nicho.izumi"]).unwrap();
    }

    #[test]
    fn rejects_an_unscoped_directory_before_any_deletion() {
        let fixture = Fixture::new();
        let config = fixture.app("config");
        fs::write(config.join("credentials"), "keep").unwrap();
        assert!(clear_app_directories(
            &[config.clone(), fixture.0.clone()],
            &config.join(MARKER),
            &["com.nicho.izumi"]
        )
        .is_err());
        assert!(config.join("credentials").exists());
    }

    #[cfg(unix)]
    #[test]
    fn removes_links_without_following_them() {
        let fixture = Fixture::new();
        let config = fixture.app("config");
        let external = fixture.0.join("external");
        fs::create_dir_all(&external).unwrap();
        fs::write(external.join("keep"), "keep").unwrap();
        std::os::unix::fs::symlink(&external, config.join("downloads")).unwrap();
        clear_app_directories(&[config.clone()], &config.join(MARKER), &["com.nicho.izumi"]).unwrap();
        assert!(external.join("keep").exists());
        assert!(!config.join("downloads").exists());
    }

    #[cfg(windows)]
    #[test]
    fn keeps_reset_pending_when_a_file_is_locked_and_retries_after_release() {
        use std::os::windows::fs::OpenOptionsExt;
        let fixture = Fixture::new();
        let config = fixture.app("config");
        let marker = config.join(MARKER);
        fs::write(&marker, "pending").unwrap();
        let path = config.join("locked-database");
        fs::write(&path, "private").unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        let error =
            clear_app_directories(&[config.clone()], &marker, &["com.nicho.izumi"]).unwrap_err();
        assert!(error.to_string().contains(&path.display().to_string()));
        assert!(error.to_string().contains("remove file"));
        assert!(marker.exists());
        drop(lock);
        clear_app_directories(&[config.clone()], &marker, &["com.nicho.izumi"]).unwrap();
        assert!(!path.exists());
        assert!(marker.exists());
    }

    #[test]
    fn allows_the_macos_product_name_and_custom_webkit_store() {
        let fixture = Fixture::new();
        let identifier = fixture.app("Application Support");
        let product = fixture.0.join("WebKit").join("izumi-dev");
        let store = fixture
            .0
            .join("WebKit")
            .join("WebsiteDataStore")
            .join("5C8A1D72-9E44-4F0B-B36A-2CD187F04E19");
        fs::create_dir_all(&product).unwrap();
        fs::create_dir_all(&store).unwrap();
        fs::write(product.join("localstorage"), "dev").unwrap();
        fs::write(store.join("IndexedDB"), "dev").unwrap();
        let marker = identifier.join(MARKER);
        fs::write(&marker, "pending").unwrap();
        let roots = vec![identifier.clone(), product.clone(), store.clone()];
        clear_app_directories(
            &roots,
            &marker,
            &[
                "com.nicho.izumi",
                "izumi-dev",
                "5C8A1D72-9E44-4F0B-B36A-2CD187F04E19",
            ],
        )
        .unwrap();
        assert_eq!(fs::read_dir(&product).unwrap().count(), 0);
        assert_eq!(fs::read_dir(&store).unwrap().count(), 0);
        assert!(clear_app_directories(
            &[fixture.0.join("WebKit").join("izumi")],
            &marker,
            &[
                "com.nicho.izumi",
                "izumi-dev",
                "5C8A1D72-9E44-4F0B-B36A-2CD187F04E19",
            ],
        )
        .is_err());
    }
}
