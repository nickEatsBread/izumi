fn main() {
    // Application commands intentionally use Tauri's default local-origin access.
    // Adding an application permission manifest requires every registered command
    // to be granted or core commands such as http_get/http_post will be denied.
    tauri_build::build();

    // Protected playback on Linux hosts Google's Widevine module through a small C++ shim built
    // against Chromium's CDM interface header (see src/widevine/). Other platforms play protected
    // streams in the webview and never compile it.
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if os == "linux" && arch == "x86_64" {
        cc::Build::new()
            .cpp(true)
            .std("c++17")
            .file("native/widevine/host.cc")
            .include("native/widevine")
            .warnings(true)
            .compile("izumi_widevine_host");
        println!("cargo:rerun-if-changed=native/widevine/host.cc");
        println!("cargo:rerun-if-changed=native/widevine/host.h");
        println!("cargo:rustc-link-lib=dl");
    }
}
