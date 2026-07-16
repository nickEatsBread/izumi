// The mpv_* commands are ours; registerListener/removeListener are the Tauri mobile-plugin
// base-class commands that back `addPluginListener` (event subscription) — they need permissions
// generated + granted too, or the ACL denies the event stream.
const COMMANDS: &[&str] = &[
    "mpv_load",
    "mpv_command",
    "mpv_get",
    "mpv_set",
    "mpv_stop",
    "mpv_pip",
    "mpv_brightness",
    "mpv_haptic",
    "mpv_thumb",
    "registerListener",
    "removeListener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
