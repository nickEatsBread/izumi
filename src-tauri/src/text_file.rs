//! Minimal UTF-8 text write for backup / history / diagnostics export.
//!
//! There is no `plugin-fs`. The frontend's save dialog returns a path, and this
//! is the one write primitive that persists it.
//!
//! On Android the frontend must not call this with a `content://` URI. The
//! picker and write are one Kotlin command (`plugin:extplayer|save_text_file`)
//! because JNI against the Activity from a worker thread kills the process.

#[derive(Debug, PartialEq, Eq)]
enum WriteTarget<'a> {
    /// Android SAF document from the system save picker.
    AndroidContentUri(&'a str),
    /// Real filesystem path (desktop, or `file://` stripped to one).
    Filesystem(&'a str),
}

fn write_target(path: &str) -> WriteTarget<'_> {
    if path.starts_with("content:") {
        WriteTarget::AndroidContentUri(path)
    } else {
        WriteTarget::Filesystem(path.strip_prefix("file://").unwrap_or(path))
    }
}

/// Write `contents` to the location returned by the save dialog.
pub fn write(path: String, contents: String) -> Result<(), String> {
    match write_target(&path) {
        WriteTarget::AndroidContentUri(uri) => write_android_content_uri(uri, contents.as_bytes()),
        WriteTarget::Filesystem(path) => std::fs::write(path, contents).map_err(|e| e.to_string()),
    }
}

fn write_android_content_uri(uri: &str, _bytes: &[u8]) -> Result<(), String> {
    Err(format!(
        "Android content URIs must be written through the save picker, not a raw path: {uri}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_dialog_content_uris_are_not_filesystem_paths() {
        // Android's ACTION_CREATE_DOCUMENT returns this. Feeding it to std::fs::write
        // is the "os error 2" backup-save failure: the URI is a relative path whose
        // `content:` parent does not exist.
        assert_eq!(
            write_target("content://com.android.providers.downloads.documents/document/msf%3A24"),
            WriteTarget::AndroidContentUri(
                "content://com.android.providers.downloads.documents/document/msf%3A24"
            )
        );
    }

    #[test]
    fn file_urls_and_plain_paths_go_to_the_filesystem() {
        assert_eq!(
            write_target("file:///tmp/izumi-backup.json"),
            WriteTarget::Filesystem("/tmp/izumi-backup.json")
        );
        assert_eq!(
            write_target("/tmp/izumi-backup.json"),
            WriteTarget::Filesystem("/tmp/izumi-backup.json")
        );
    }

    #[cfg(not(target_os = "android"))]
    #[test]
    fn content_uris_are_not_handed_to_std_fs() {
        let err = write(
            "content://com.android.providers.downloads.documents/document/1".into(),
            "{\"app\":\"izumi\"}".into(),
        )
        .unwrap_err();
        assert!(
            !err.contains("os error 2")
                && !err.contains("os error 3")
                && !err.contains("os error 123"),
            "content:// must not be treated as a filesystem path, got {err}"
        );
        assert!(
            err.to_lowercase().contains("content"),
            "error should name the URI scheme, got {err}"
        );
    }

    #[test]
    fn filesystem_paths_are_written() {
        let path = std::env::temp_dir().join(format!(
            "izumi-text-file-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        write(path.to_string_lossy().into_owned(), "{\"ok\":true}".into()).unwrap();
        let body = std::fs::read_to_string(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(body, "{\"ok\":true}");
    }
}
