use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig, SeekDirection};
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct DesktopPresence {
    controls: Mutex<Option<MediaControls>>,
    discord: Mutex<DiscordState>,
}

#[derive(Default)]
struct DiscordState {
    client: Option<DiscordIpcClient>,
    key: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceUpdate {
    title: String,
    series: String,
    episode: Option<f64>,
    duration: f64,
    position: f64,
    paused: bool,
    cover_url: Option<String>,
    system_controls: bool,
    discord: bool,
    private: bool,
}

#[derive(Clone, Serialize)]
struct NativeMediaAction {
    action: &'static str,
    value: Option<f64>,
}

fn action(event: MediaControlEvent) -> Option<NativeMediaAction> {
    let (action, value) = match event {
        MediaControlEvent::Play => ("play", None),
        MediaControlEvent::Pause => ("pause", None),
        MediaControlEvent::Toggle => ("toggle", None),
        MediaControlEvent::Next => ("next", None),
        MediaControlEvent::Previous => ("previous", None),
        MediaControlEvent::Stop => ("stop", None),
        MediaControlEvent::Seek(direction) => (
            "seekBy",
            Some(if direction == SeekDirection::Forward { 10.0 } else { -10.0 }),
        ),
        MediaControlEvent::SeekBy(direction, amount) => (
            "seekBy",
            Some(amount.as_secs_f64() * if direction == SeekDirection::Forward { 1.0 } else { -1.0 }),
        ),
        MediaControlEvent::SetPosition(MediaPosition(position)) => ("setPosition", Some(position.as_secs_f64())),
        _ => return None,
    };
    Some(NativeMediaAction { action, value })
}

fn create_controls(app: &AppHandle) -> Result<MediaControls, String> {
    #[cfg(windows)]
    let hwnd = app
        .get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
        .map(|handle| handle.0 as *mut std::ffi::c_void);
    #[cfg(not(windows))]
    let hwnd = None;

    let mut controls = MediaControls::new(PlatformConfig {
        dbus_name: "izumi",
        display_name: "Izumi",
        hwnd,
    }).map_err(|error| error.to_string())?;
    let event_app = app.clone();
    controls.attach(move |event| {
        if let Some(payload) = action(event) {
            let _ = event_app.emit("native-media-control", payload);
        }
    }).map_err(|error| error.to_string())?;
    Ok(controls)
}

fn update_discord(state: &mut DiscordState, update: &PresenceUpdate) -> bool {
    let Some(application_id) = option_env!("IZUMI_DISCORD_APPLICATION_ID").filter(|id| !id.is_empty()) else {
        state.client = None;
        state.key.clear();
        return false;
    };
    if !update.discord || update.private {
        if let Some(client) = state.client.as_mut() { let _ = client.clear_activity(); }
        state.key.clear();
        return true;
    }
    let key = format!("{}|{}|{:?}", update.series, update.title, update.episode);
    if key == state.key { return true; }
    if state.client.is_none() {
        let mut client = DiscordIpcClient::new(application_id);
        if client.connect().is_err() { return true; }
        state.client = Some(client);
    }
    let episode = update.episode.map(|number| {
        if number.fract() == 0.0 { format!("Episode {}", number as u64) } else { format!("Episode {number}") }
    });
    let activity = activity::Activity::new()
        .details(update.series.clone())
        .state(episode.unwrap_or_else(|| update.title.clone()));
    if state.client.as_mut().is_some_and(|client| client.set_activity(activity).is_ok()) {
        state.key = key;
    } else {
        state.client = None;
        state.key.clear();
    }
    true
}

#[tauri::command]
pub fn desktop_presence_update(
    app: AppHandle,
    update: PresenceUpdate,
    presence: tauri::State<'_, DesktopPresence>,
) -> Result<bool, String> {
    if update.system_controls {
        let mut guard = presence.controls.lock().map_err(|_| "media controls lock poisoned")?;
        if guard.is_none() { *guard = Some(create_controls(&app)?); }
        if let Some(controls) = guard.as_mut() {
            controls.set_metadata(MediaMetadata {
                title: Some(&update.title),
                album: Some(&update.series),
                artist: Some("Izumi"),
                cover_url: update.cover_url.as_deref(),
                duration: (update.duration.is_finite() && update.duration > 0.0).then(|| Duration::from_secs_f64(update.duration)),
            }).map_err(|error| error.to_string())?;
            let progress = (update.position.is_finite() && update.position >= 0.0)
                .then(|| MediaPosition(Duration::from_secs_f64(update.position)));
            controls.set_playback(if update.paused {
                MediaPlayback::Paused { progress }
            } else {
                MediaPlayback::Playing { progress }
            }).map_err(|error| error.to_string())?;
        }
    } else if let Ok(mut guard) = presence.controls.lock() {
        if let Some(controls) = guard.as_mut() { let _ = controls.set_playback(MediaPlayback::Stopped); }
        *guard = None;
    }
    let mut discord = presence.discord.lock().map_err(|_| "Discord lock poisoned")?;
    let available = update_discord(&mut discord, &update);
    Ok(available)
}

#[tauri::command]
pub fn desktop_presence_clear(presence: tauri::State<'_, DesktopPresence>) {
    if let Ok(mut controls) = presence.controls.lock() {
        if let Some(controls) = controls.as_mut() { let _ = controls.set_playback(MediaPlayback::Stopped); }
    }
    if let Ok(mut discord) = presence.discord.lock() {
        if let Some(client) = discord.client.as_mut() { let _ = client.clear_activity(); }
        discord.key.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_seek_direction_and_position() {
        assert_eq!(action(MediaControlEvent::SeekBy(SeekDirection::Backward, Duration::from_secs(7))).unwrap().value, Some(-7.0));
        assert_eq!(action(MediaControlEvent::SetPosition(MediaPosition(Duration::from_secs(42)))).unwrap().value, Some(42.0));
    }
}
