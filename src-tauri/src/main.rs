// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Linux: CEF re-launches this binary for its renderer, GPU and utility processes. The entry
// point runs those helpers and reaches `run` only in the browser process.
#[cfg_attr(target_os = "linux", tauri_runtime_cef::cef_entry_point)]
fn main() {
    izumi_lib::run()
}
