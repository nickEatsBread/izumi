// The mpv_* commands are ours; registerListener/removeListener are the Tauri mobile-plugin
// base-class commands that back `addPluginListener` (event subscription) — they need permissions
// generated + granted too, or the ACL denies the event stream.
const COMMANDS: &[&str] = &[
    "mpv_prepare",
    "mpv_load",
    "mpv_inspect_source",
    "mpv_command",
    "mpv_get",
    "mpv_set",
    "mpv_set_render_opts",
    "mpv_set_dolby_opts",
    "mpv_dolby_capabilities",
    "mpv_stop",
    "mpv_pip",
    "mpv_auto_pip",
    "mpv_media_session",
    "mpv_request_notifications",
    "mpv_viewport",
    "mpv_fullscreen",
    "mpv_keep_screen_awake",
    "mpv_transform",
    "mpv_brightness",
    "mpv_haptic",
    "mpv_thumb",
    "mpv_snapshot",
    "mpv_gif_start",
    "mpv_gif_stop",
    "mpv_gif_abort",
    "mpv_gif_save",
    "registerListener",
    "removeListener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
