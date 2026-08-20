//! Minimal UTF-8 text write for backup / history / diagnostics export.
//!
//! There is no `plugin-fs`. The frontend's save dialog returns a path, and this
//! is the one write primitive that persists it.
//!
//! On Android that "path" is a Storage Access Framework `content://` URI from
//! `ACTION_CREATE_DOCUMENT`, not a filesystem location. `std::fs::write` treats
//! the URI as a relative path whose parent (`content:`) does not exist, which
//! surfaces as "os error 2". Those URIs have to go through
//! `ContentResolver.openOutputStream`.

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

#[cfg(target_os = "android")]
fn write_android_content_uri(uri: &str, bytes: &[u8]) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    use jni::sys::jobject;
    use jni::{jni_sig, jni_str, JavaVM};

    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) };
    vm.attach_current_thread(|env| {
        // wry owns this Activity jobject for the process lifetime. JObject has no Drop
        // side-effects, so wrapping it here does not delete the ref.
        let activity = unsafe { JObject::from_raw(env, ctx.context() as jobject) };
        let resolver = env
            .call_method(
                &activity,
                jni_str!("getContentResolver"),
                jni_sig!(() -> android.content.ContentResolver),
                &[],
            )?
            .l()?;
        if resolver.is_null() {
            return Err(jni::errors::Error::NullPtr("ContentResolver"));
        }

        let uri_str = env.new_string(uri)?;
        let uri_class = env.find_class(jni_str!("android/net/Uri"))?;
        let parsed = env
            .call_static_method(
                &uri_class,
                jni_str!("parse"),
                jni_sig!((java.lang.String) -> android.net.Uri),
                &[JValue::from(&uri_str)],
            )?
            .l()?;
        if parsed.is_null() {
            return Err(jni::errors::Error::NullPtr("Uri.parse"));
        }

        // "wt" = write + truncate. ACTION_CREATE_DOCUMENT may hand back an existing
        // document when the user overwrites; without truncate the previous bytes linger.
        let mode = env.new_string("wt")?;
        let stream = env
            .call_method(
                &resolver,
                jni_str!("openOutputStream"),
                jni_sig!((android.net.Uri, java.lang.String) -> java.io.OutputStream),
                &[JValue::from(&parsed), JValue::from(&mode)],
            )?
            .l()?;
        if stream.is_null() {
            return Err(jni::errors::Error::NullPtr("openOutputStream"));
        }

        let array = env.byte_array_from_slice(bytes)?;
        env.call_method(
            &stream,
            jni_str!("write"),
            jni_sig!(([jbyte]) -> void),
            &[JValue::from(&array)],
        )?;
        env.call_method(&stream, jni_str!("flush"), jni_sig!(() -> void), &[])?;
        env.call_method(&stream, jni_str!("close"), jni_sig!(() -> void), &[])?;
        Ok(())
    })
    .map_err(|e: jni::errors::Error| e.to_string())
}

#[cfg(not(target_os = "android"))]
fn write_android_content_uri(uri: &str, _bytes: &[u8]) -> Result<(), String> {
    Err(format!(
        "Cannot write Android content URI on this platform: {uri}"
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
            write_target(
                "content://com.android.providers.downloads.documents/document/msf%3A24"
            ),
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
