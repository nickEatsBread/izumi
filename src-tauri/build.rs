fn main() {
    // Application commands intentionally use Tauri's default local-origin access.
    // Adding an application permission manifest requires every registered command
    // to be granted or core commands such as http_get/http_post will be denied.
    tauri_build::build();

    // izumi hosts Google's Widevine module itself on x86-64 Linux and Windows, and on macOS for both
    // Apple silicon and Intel (see src/widevine/). `widevine_host` gates the whole module and its
    // Tauri commands so each platform has exactly one gate to reason about. Other targets play
    // protected streams in their webview and never build it.
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    println!("cargo:rustc-check-cfg=cfg(widevine_host)");
    let x86_64_desktop = arch == "x86_64" && (os == "linux" || os == "windows");
    // Google ships a thin dylib per Mac architecture; each slice of a universal build loads its own.
    let mac = os == "macos" && (arch == "aarch64" || arch == "x86_64");
    if x86_64_desktop || mac {
        println!("cargo:rustc-cfg=widevine_host");
    }

    // The module boundary is a C++ shim built against Chromium's CDM interface header, loaded with
    // dlopen. Windows cannot dlopen a COM-less .dll this way, so it builds the host vtable in Rust
    // (widevine/host_win.rs with libloading) and compiles no C++. macOS uses that same Rust host.
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
