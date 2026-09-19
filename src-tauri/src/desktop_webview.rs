// WebView2 windows sharing the app's data directory MUST use identical browser options.
// Otherwise the second controller fails with ERROR_INVALID_STATE after Tauri has already
// returned a window handle. Keep login windows in the same environment as the main window.
// Restate wry's defaults when adding the video-composition options used by capture.
pub(crate) const DESKTOP_WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-direct-composition-video-overlays";

/// Stable WKWebsiteDataStore UUID for `com.nicho.izumi.dev`.
///
/// WKWebView has no `dataDirectory`. During `tauri dev` the embedded Info.plist
/// never receives CFBundleIdentifier, so the default store can resolve onto the
/// installed release. This UUID is the macOS equivalent of the WebView2 profile
/// split. Formatted: 5C8A1D72-9E44-4F0B-B36A-2CD187F04E19
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) const DEV_WKWEBVIEW_STORE: [u8; 16] = [
    0x5C, 0x8A, 0x1D, 0x72, 0x9E, 0x44, 0x4F, 0x0B, 0xB3, 0x6A, 0x2C, 0xD1, 0x87, 0xF0, 0x4E, 0x19,
];
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) const DEV_WKWEBVIEW_STORE_UUID: &str = "5C8A1D72-9E44-4F0B-B36A-2CD187F04E19";
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) const DEV_IDENTIFIER: &str = "com.nicho.izumi.dev";

/// Rewrite a debug desktop launch that would otherwise share the installed
/// release's identifier and product name. Overlay configs that already end in
/// `.dev` are left alone.
pub(crate) fn dev_identity_override(
    identifier: &str,
    product_name: Option<&str>,
    debug_desktop: bool,
) -> Option<(String, Option<String>)> {
    if !debug_desktop || identifier.ends_with(".dev") {
        return None;
    }
    Some((
        format!("{identifier}.dev"),
        product_name.map(|name| {
            if name.ends_with("-dev") {
                name.to_string()
            } else {
                format!("{name}-dev")
            }
        }),
    ))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn macos_webview_needs_isolated_store(identifier: &str, debug: bool) -> bool {
    debug || identifier.ends_with(".dev")
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn macos_webview_store_id(identifier: &str) -> [u8; 16] {
    if identifier == DEV_IDENTIFIER {
        return DEV_WKWEBVIEW_STORE;
    }
    let digest = blake3::hash(format!("izumi.wkwebview.v1:{identifier}").as_bytes());
    let mut id = [0u8; 16];
    id.copy_from_slice(&digest.as_bytes()[..16]);
    id
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn macos_webview_store_uuid(identifier: &str) -> String {
    if identifier == DEV_IDENTIFIER {
        return DEV_WKWEBVIEW_STORE_UUID.to_string();
    }
    uuid_hyphenated(&macos_webview_store_id(identifier))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn uuid_hyphenated(bytes: &[u8; 16]) -> String {
    format!(
        "{:02X}{:02X}{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn macos_website_data_store_dir(library: &std::path::Path, identifier: &str) -> std::path::PathBuf {
    library
        .join("WebKit")
        .join("WebsiteDataStore")
        .join(macos_webview_store_uuid(identifier))
}

/// Apply the debug identity rewrite before plugins read `app.config().identifier`.
pub(crate) fn isolate_dev_context(mut context: tauri::Context) -> tauri::Context {
    let debug_desktop = cfg!(all(
        debug_assertions,
        not(any(target_os = "android", target_os = "ios"))
    ));
    if let Some((identifier, product_name)) = dev_identity_override(
        &context.config().identifier,
        context.config().product_name.as_deref(),
        debug_desktop,
    ) {
        let config = context.config_mut();
        config.identifier = identifier;
        if let Some(name) = product_name {
            config.product_name = Some(name);
        }
    }
    context
}

#[cfg(target_os = "macos")]
pub(crate) fn isolate_webview_data<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
    identifier: &str,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    if macos_webview_needs_isolated_store(identifier, cfg!(debug_assertions)) {
        builder.data_store_identifier(macos_webview_store_id(identifier))
    } else {
        builder
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn isolate_webview_data<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
    _identifier: &str,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    builder
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_identity_is_left_alone() {
        assert_eq!(
            dev_identity_override("com.nicho.izumi.dev", Some("izumi-dev"), true),
            None
        );
    }

    #[test]
    fn release_builds_keep_the_installed_identity() {
        assert_eq!(
            dev_identity_override("com.nicho.izumi", Some("izumi"), false),
            None
        );
    }

    #[test]
    fn debug_desktop_without_overlay_moves_off_the_release_identity() {
        assert_eq!(
            dev_identity_override("com.nicho.izumi", Some("izumi"), true),
            Some((
                "com.nicho.izumi.dev".into(),
                Some("izumi-dev".into())
            ))
        );
    }

    #[test]
    fn production_release_keeps_the_default_webkit_store() {
        assert!(!macos_webview_needs_isolated_store("com.nicho.izumi", false));
        assert!(macos_webview_needs_isolated_store("com.nicho.izumi.dev", false));
        assert!(macos_webview_needs_isolated_store("com.nicho.izumi", true));
    }

    #[test]
    fn overlay_identifier_uses_the_stable_store_uuid() {
        assert_eq!(macos_webview_store_id(DEV_IDENTIFIER), DEV_WKWEBVIEW_STORE);
        assert_eq!(
            macos_webview_store_uuid(DEV_IDENTIFIER),
            DEV_WKWEBVIEW_STORE_UUID
        );
        assert_eq!(uuid_hyphenated(&DEV_WKWEBVIEW_STORE), DEV_WKWEBVIEW_STORE_UUID);
        assert_ne!(
            macos_webview_store_id("com.nicho.izumi"),
            macos_webview_store_id(DEV_IDENTIFIER)
        );
    }
}
