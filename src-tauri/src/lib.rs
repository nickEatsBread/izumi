// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod player;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn player_play(url: String, player: tauri::State<'_, player::PlayerHandle>) -> Result<(), String> {
    player.play_own_window(&url)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(player::PlayerHandle::new())
        .invoke_handler(tauri::generate_handler![greet, player_play])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
