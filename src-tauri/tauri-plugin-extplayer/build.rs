const COMMANDS: &[&str] = &[
    "play_external",
    "install_apk",
    "device_status",
    "open_browser",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
