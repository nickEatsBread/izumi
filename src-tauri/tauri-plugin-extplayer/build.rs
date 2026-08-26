const COMMANDS: &[&str] = &[
    "play_external",
    "cast_media",
    "install_apk",
    "device_status",
    "download_foreground",
    "download_notifications",
    "open_browser",
    "share_text",
    "da_reaction_state",
    "da_react",
    "da_login",
    "save_text_file",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
