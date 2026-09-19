//! `tauri dev` on macOS must not share the installed release's WKWebView store.
//!
//! Windows isolation is the identifier overlay: WebView2's user-data folder is
//! `{localAppData}/{identifier}`. WKWebView ignores that. tauri-codegen's
//! embedded Info.plist sets CFBundleName from productName and never writes
//! CFBundleIdentifier, so an unbundled `target/debug/izumi` can still resolve
//! onto the installed izumi.app store. A custom dataStoreIdentifier is the
//! macOS equivalent of the WebView2 profile split.

#[test]
fn debug_desktop_builds_rewrite_a_release_identifier() {
    let src = include_str!("../src/desktop_webview.rs");
    assert!(
        src.contains("fn dev_identity_override"),
        "debug desktop launches must not keep the release identifier"
    );
    assert!(
        src.contains("ends_with(\".dev\")"),
        "the overlay identifier is already isolated and must not be rewritten"
    );
}

#[test]
fn macos_webviews_get_a_custom_data_store_in_dev() {
    let webview = include_str!("../src/desktop_webview.rs");
    assert!(
        webview.contains("data_store_identifier"),
        "WKWebView has no dataDirectory; isolation is dataStoreIdentifier"
    );
    assert!(
        webview.contains("DEV_WKWEBVIEW_STORE") || webview.contains("macos_webview_store_id"),
        "the UUID must be stable so reset and launch agree"
    );

    let lib = include_str!("../src/lib.rs");
    assert!(
        lib.contains("isolate_webview_data"),
        "the main window and in-app popups must use the isolated store"
    );
    let oauth = include_str!("../src/oauth.rs");
    assert!(
        oauth.contains("isolate_webview_data"),
        "login windows share cookies with main; they must use the same store"
    );
}

#[test]
fn macos_reset_clears_webkit_product_name_and_custom_store() {
    let reset = include_str!("../src/reset.rs");
    assert!(
        reset.contains("product_name"),
        "tauri dev WKWebView data lives under CFBundleName, not only the identifier"
    );
    assert!(
        reset.contains("WebsiteDataStore") || reset.contains("macos_webview_store"),
        "a custom dataStoreIdentifier is stored under WebsiteDataStore/<uuid>"
    );
}

#[test]
fn debug_context_is_isolated_before_plugins_start() {
    let lib = include_str!("../src/lib.rs");
    assert!(
        lib.contains("isolate_dev_context"),
        "single-instance, path resolver and WebView2 all read the context identifier"
    );
    assert!(
        lib.contains("isolate_dev_context(tauri::generate_context!())"),
        "the override must wrap generate_context so setup sees the isolated identity"
    );
}
