const COMMANDS: &[&str] = &["mpv_load", "mpv_command", "mpv_get", "mpv_set", "mpv_stop"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
