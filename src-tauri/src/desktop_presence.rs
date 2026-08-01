use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

/// Shown as the artist/app on the OS media panel.
const APP_NAME: &str = "Izumi";
/// What a private (adult) title publishes to the OS media panel instead of its name. The lock
/// screen, the volume OSD and the GNOME/KDE panel are every bit as public as a Discord status —
/// and unlike Discord, system controls are ON by default — so the title, series and artwork are
/// all withheld. The controls themselves stay registered: play/pause, next/previous and the
/// hardware media keys are transport, not disclosure, and yanking them mid-episode would be a
/// worse deal than a nameless entry.
const PRIVATE_TITLE: &str = "Video";
/// Fallback seek step when the UI hasn't told us the user's setting (yet).
const DEFAULT_SEEK_SECONDS: f64 = 10.0;
/// How far the elapsed-time anchor may drift before Discord is told again. Discord advances the
/// bar on its own, so only a seek (not a progress tick) is worth an IPC round trip.
const DISCORD_ANCHOR_DRIFT_MS: i64 = 3_000;
/// Discord commonly is not running. Avoid retrying the IPC socket on every playhead update while
/// it is unavailable; toggling the setting off/on still resets this delay immediately.
const DISCORD_RETRY_MS: i64 = 15_000;

pub struct DesktopPresence {
    controls: Mutex<Option<MediaControls>>,
    discord: Arc<Mutex<DiscordState>>,
    /// Newest Discord job still waiting for the worker. Presence is a snapshot, not a log, so a
    /// job that gets overtaken while the worker is busy has nothing left to say — latest wins.
    pending: Arc<Mutex<Option<DiscordJob>>>,
    /// A worker is currently draining `pending`.
    draining: Arc<AtomicBool>,
    /// The user's seek step in seconds (f64 bits), read by the media-control event callback.
    seek_seconds: Arc<AtomicU64>,
}

impl Default for DesktopPresence {
    fn default() -> Self {
        Self {
            controls: Mutex::new(None),
            discord: Arc::default(),
            pending: Arc::default(),
            draining: Arc::default(),
            seek_seconds: Arc::new(AtomicU64::new(DEFAULT_SEEK_SECONDS.to_bits())),
        }
    }
}

#[derive(Default)]
struct DiscordState {
    client: Option<DiscordIpcClient>,
    key: String,
    /// Epoch-ms the elapsed bar is currently anchored to; `None` while paused.
    start_ms: Option<i64>,
    retry_after_ms: i64,
}

enum DiscordJob {
    Publish(PresenceUpdate),
    Clear,
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
    /// Mirrors the player's own seek step so the panel's coarse seek matches every other seek.
    seek_seconds: f64,
}

#[derive(Clone, Serialize)]
struct NativeMediaAction {
    action: &'static str,
    value: Option<f64>,
}

/// Keep a UI-supplied seek step inside something an OS media panel can sanely apply.
fn sane_seek_seconds(value: f64) -> f64 {
    if value.is_finite() && (1.0..=600.0).contains(&value) {
        value
    } else {
        DEFAULT_SEEK_SECONDS
    }
}

fn action(event: MediaControlEvent, seek_seconds: f64) -> Option<NativeMediaAction> {
    let (action, value) = match event {
        MediaControlEvent::Play => ("play", None),
        MediaControlEvent::Pause => ("pause", None),
        MediaControlEvent::Toggle => ("toggle", None),
        MediaControlEvent::Next => ("next", None),
        MediaControlEvent::Previous => ("previous", None),
        MediaControlEvent::Stop => ("stop", None),
        // "Seek by an undetermined amount" is the panel asking US how far a nudge is; every other
        // seek path in the app uses the user's setting, so this one does too.
        MediaControlEvent::Seek(direction) => (
            "seekBy",
            Some(if direction == SeekDirection::Forward {
                seek_seconds
            } else {
                -seek_seconds
            }),
        ),
        MediaControlEvent::SeekBy(direction, amount) => (
            "seekBy",
            Some(
                amount.as_secs_f64()
                    * if direction == SeekDirection::Forward {
                        1.0
                    } else {
                        -1.0
                    },
            ),
        ),
        MediaControlEvent::SetPosition(MediaPosition(position)) => {
            ("setPosition", Some(position.as_secs_f64()))
        }
        _ => return None,
    };
    Some(NativeMediaAction { action, value })
}

/// The subset of an update that may reach the OS media panel.
struct PublishedMetadata<'a> {
    title: &'a str,
    album: Option<&'a str>,
    cover_url: Option<&'a str>,
}

fn published_metadata(update: &PresenceUpdate) -> PublishedMetadata<'_> {
    if update.private {
        PublishedMetadata {
            title: PRIVATE_TITLE,
            album: None,
            cover_url: None,
        }
    } else {
        PublishedMetadata {
            title: &update.title,
            album: Some(&update.series),
            cover_url: update.cover_url.as_deref(),
        }
    }
}

fn create_controls(app: &AppHandle, seek_seconds: Arc<AtomicU64>) -> Result<MediaControls, String> {
    #[cfg(windows)]
    let hwnd = app
        .get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
        .map(|handle| handle.0 as *mut std::ffi::c_void);
    #[cfg(not(windows))]
    let hwnd = None;

    let mut controls = MediaControls::new(PlatformConfig {
        dbus_name: "izumi",
        display_name: APP_NAME,
        hwnd,
    })
    .map_err(|error| error.to_string())?;
    let event_app = app.clone();
    controls
        .attach(move |event| {
            let step = sane_seek_seconds(f64::from_bits(seek_seconds.load(Ordering::Relaxed)));
            if let Some(payload) = action(event, step) {
                let _ = event_app.emit("native-media-control", payload);
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(controls)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

/// Epoch-ms this episode would have started at, given the playhead — the anchor Discord counts up
/// from. `None` while paused: a paused episode has no running clock, and leaving the old anchor in
/// place is exactly how a presence keeps advertising a video nobody is watching.
fn playback_start_ms(update: &PresenceUpdate, now_ms: i64) -> Option<i64> {
    if update.paused || !update.position.is_finite() || update.position < 0.0 {
        return None;
    }
    Some(now_ms - (update.position * 1000.0) as i64)
}

/// start+end make Discord draw the elapsed/remaining bar itself, so the playhead stays honest
/// without us pushing a position every second.
fn discord_timestamps(update: &PresenceUpdate, start_ms: i64) -> activity::Timestamps {
    let timestamps = activity::Timestamps::new().start(start_ms);
    if update.duration.is_finite() && update.duration > 0.0 {
        timestamps.end(start_ms + (update.duration * 1000.0) as i64)
    } else {
        timestamps
    }
}

/// Republish only when the user could see a difference: the episode/pause key changed, or a seek
/// moved the elapsed-time anchor. Plain progress ticks are absorbed here.
fn discord_needs_update(
    prev_key: &str,
    prev_start: Option<i64>,
    key: &str,
    start: Option<i64>,
) -> bool {
    if prev_key != key {
        return true;
    }
    match (prev_start, start) {
        (Some(prev), Some(next)) => (next - prev).abs() > DISCORD_ANCHOR_DRIFT_MS,
        (prev, next) => prev.is_some() != next.is_some(),
    }
}

fn clear_discord(state: &mut DiscordState) {
    if let Some(client) = state.client.as_mut() {
        let _ = client.clear_activity();
    }
    state.key.clear();
    state.start_ms = None;
    state.retry_after_ms = 0;
}

fn update_discord(state: &mut DiscordState, update: &PresenceUpdate) {
    // The public Discord application ID selects Izumi's Rich Presence assets/branding; it is not
    // a secret. Packagers can still override it without changing source.
    let application_id = option_env!("IZUMI_DISCORD_APPLICATION_ID")
        .filter(|id| !id.is_empty())
        .unwrap_or("1533074630321897482");
    if !update.discord || update.private {
        // Only retract when there is something to retract, otherwise every tick pays for a
        // blocking IPC round trip that says nothing.
        if !state.key.is_empty() {
            clear_discord(state);
        } else {
            // A deliberate disable/re-enable should retry immediately, even if Discord was
            // unavailable during the previous attempt.
            state.retry_after_ms = 0;
        }
        return;
    }
    let episode = update.episode.map(|number| {
        if number.fract() == 0.0 {
            format!("Episode {}", number as u64)
        } else {
            format!("Episode {number}")
        }
    });
    let mut status = episode.unwrap_or_else(|| update.title.clone());
    // Pause belongs in the key: without it a paused player kept advertising an episode as if it
    // were still running.
    if update.paused {
        status.push_str(" · Paused");
    }
    let key = format!(
        "{}|{}|{status}|{}|{}",
        update.series,
        update.title,
        update.duration.round(),
        update.cover_url.as_deref().unwrap_or_default()
    );
    let now = now_ms();
    let start_ms = playback_start_ms(update, now);
    if !discord_needs_update(&state.key, state.start_ms, &key, start_ms) {
        return;
    }
    if state.client.is_none() {
        if now < state.retry_after_ms {
            return;
        }
        let mut client = DiscordIpcClient::new(application_id);
        if client.connect().is_err() {
            state.retry_after_ms = now.saturating_add(DISCORD_RETRY_MS);
            return;
        }
        state.client = Some(client);
        state.retry_after_ms = 0;
    }
    let mut activity = activity::Activity::new()
        .activity_type(activity::ActivityType::Watching)
        .details(update.series.clone())
        .state(status);
    if let Some(cover) = update.cover_url.as_deref().filter(|url| !url.is_empty()) {
        activity = activity.assets(
            activity::Assets::new()
                .large_image(cover)
                .large_text(update.series.clone()),
        );
    }
    if let Some(start) = start_ms {
        activity = activity.timestamps(discord_timestamps(update, start));
    }
    if state
        .client
        .as_mut()
        .is_some_and(|client| client.set_activity(activity).is_ok())
    {
        state.key = key;
        state.start_ms = start_ms;
    } else {
        state.client = None;
        state.key.clear();
        state.start_ms = None;
        state.retry_after_ms = now.saturating_add(DISCORD_RETRY_MS);
    }
}

/// Discord's IPC is a blocking socket / named-pipe round trip, so a wedged Discord client would
/// otherwise stall whichever thread ran the command. Hand the job to a background worker.
fn queue_discord(presence: &DesktopPresence, job: DiscordJob) {
    match presence.pending.lock() {
        Ok(mut pending) => *pending = Some(job),
        Err(_) => return,
    }
    if presence.draining.swap(true, Ordering::AcqRel) {
        return;
    }
    let discord = presence.discord.clone();
    let pending = presence.pending.clone();
    let draining = presence.draining.clone();
    tauri::async_runtime::spawn_blocking(move || loop {
        while let Some(job) = pending.lock().ok().and_then(|mut slot| slot.take()) {
            let Ok(mut state) = discord.lock() else { break };
            match job {
                DiscordJob::Publish(update) => update_discord(&mut state, &update),
                DiscordJob::Clear => clear_discord(&mut state),
            }
        }
        draining.store(false, Ordering::Release);
        // A job queued between the empty slot above and this flag would have seen `draining` set
        // and declined to spawn, so pick it up here instead of dropping it on the floor.
        let queued = pending.lock().is_ok_and(|slot| slot.is_some());
        if !queued || draining.swap(true, Ordering::AcqRel) {
            break;
        }
    });
}

#[tauri::command]
pub fn desktop_presence_update(
    app: AppHandle,
    update: PresenceUpdate,
    presence: tauri::State<'_, DesktopPresence>,
) -> Result<(), String> {
    presence.seek_seconds.store(
        sane_seek_seconds(update.seek_seconds).to_bits(),
        Ordering::Relaxed,
    );
    if update.system_controls {
        let mut guard = presence
            .controls
            .lock()
            .map_err(|_| "media controls lock poisoned")?;
        if guard.is_none() {
            *guard = Some(create_controls(&app, presence.seek_seconds.clone())?);
        }
        if let Some(controls) = guard.as_mut() {
            let published = published_metadata(&update);
            controls
                .set_metadata(MediaMetadata {
                    title: Some(published.title),
                    album: published.album,
                    artist: Some(APP_NAME),
                    cover_url: published.cover_url,
                    duration: (update.duration.is_finite() && update.duration > 0.0)
                        .then(|| Duration::from_secs_f64(update.duration)),
                })
                .map_err(|error| error.to_string())?;
            let progress = (update.position.is_finite() && update.position >= 0.0)
                .then(|| MediaPosition(Duration::from_secs_f64(update.position)));
            controls
                .set_playback(if update.paused {
                    MediaPlayback::Paused { progress }
                } else {
                    MediaPlayback::Playing { progress }
                })
                .map_err(|error| error.to_string())?;
        }
    } else if let Ok(mut guard) = presence.controls.lock() {
        if let Some(controls) = guard.as_mut() {
            let _ = controls.set_playback(MediaPlayback::Stopped);
        }
        *guard = None;
    }
    queue_discord(&presence, DiscordJob::Publish(update));
    Ok(())
}

#[tauri::command]
pub fn desktop_presence_clear(presence: tauri::State<'_, DesktopPresence>) {
    if let Ok(mut guard) = presence.controls.lock() {
        // Dropping the controls is what actually unregisters the MPRIS object / SMTC session.
        // Leaving it merely Stopped kept a dead "now playing" entry on the bus after the player
        // had closed; `Drop for MediaControls` detaches it.
        if let Some(controls) = guard.as_mut() {
            let _ = controls.set_playback(MediaPlayback::Stopped);
        }
        *guard = None;
    }
    queue_discord(&presence, DiscordJob::Clear);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update() -> PresenceUpdate {
        PresenceUpdate {
            title: "The Beach Episode".into(),
            series: "A Series".into(),
            episode: Some(7.0),
            duration: 1440.0,
            position: 120.0,
            paused: false,
            cover_url: Some("https://example.invalid/cover.jpg".into()),
            system_controls: true,
            discord: true,
            private: false,
            seek_seconds: 10.0,
        }
    }

    #[test]
    fn maps_seek_direction_and_position() {
        assert_eq!(
            action(
                MediaControlEvent::SeekBy(SeekDirection::Backward, Duration::from_secs(7)),
                10.0
            )
            .unwrap()
            .value,
            Some(-7.0)
        );
        assert_eq!(
            action(
                MediaControlEvent::SetPosition(MediaPosition(Duration::from_secs(42))),
                10.0
            )
            .unwrap()
            .value,
            Some(42.0)
        );
    }

    #[test]
    fn coarse_seek_uses_the_configured_step() {
        // Regression: this used to be hardcoded ±10s while every other seek path honoured the
        // user's setting.
        assert_eq!(
            action(MediaControlEvent::Seek(SeekDirection::Forward), 30.0)
                .unwrap()
                .value,
            Some(30.0)
        );
        assert_eq!(
            action(MediaControlEvent::Seek(SeekDirection::Backward), 30.0)
                .unwrap()
                .value,
            Some(-30.0)
        );
    }

    #[test]
    fn nonsense_seek_steps_fall_back() {
        assert_eq!(sane_seek_seconds(f64::NAN), DEFAULT_SEEK_SECONDS);
        assert_eq!(sane_seek_seconds(0.0), DEFAULT_SEEK_SECONDS);
        assert_eq!(sane_seek_seconds(100_000.0), DEFAULT_SEEK_SECONDS);
        assert_eq!(sane_seek_seconds(85.0), 85.0);
    }

    #[test]
    fn private_titles_publish_nothing_identifying() {
        // Regression: `private` suppressed Discord only, so an adult title still reached the
        // Windows lock screen / volume OSD and the GNOME/KDE media panel.
        let mut private = update();
        private.private = true;
        let published = published_metadata(&private);
        assert_eq!(published.title, PRIVATE_TITLE);
        assert_eq!(published.album, None);
        assert_eq!(published.cover_url, None);
        assert!(published.title != private.title);
    }

    #[test]
    fn ordinary_titles_still_publish_everything() {
        let ordinary = update();
        let published = published_metadata(&ordinary);
        assert_eq!(published.title, "The Beach Episode");
        assert_eq!(published.album, Some("A Series"));
        assert_eq!(
            published.cover_url,
            Some("https://example.invalid/cover.jpg")
        );
    }

    #[test]
    fn pausing_drops_the_elapsed_anchor() {
        let playing = update();
        assert_eq!(playback_start_ms(&playing, 1_000_000), Some(880_000));
        let mut paused = update();
        paused.paused = true;
        assert_eq!(playback_start_ms(&paused, 1_000_000), None);
    }

    #[test]
    fn elapsed_bar_spans_the_episode() {
        let timestamps = discord_timestamps(&update(), 880_000);
        let json = serde_json::to_string(&timestamps).unwrap();
        assert_eq!(json, r#"{"start":880000,"end":2320000}"#);
    }

    #[test]
    fn discord_absorbs_progress_ticks_but_not_seeks_or_pauses() {
        assert!(!discord_needs_update(
            "a|b|Episode 7",
            Some(880_000),
            "a|b|Episode 7",
            Some(880_400)
        ));
        assert!(discord_needs_update(
            "a|b|Episode 7",
            Some(880_000),
            "a|b|Episode 7",
            Some(920_000)
        ));
        assert!(discord_needs_update(
            "a|b|Episode 7",
            Some(880_000),
            "a|b|Episode 7 · Paused",
            None
        ));
        assert!(discord_needs_update(
            "",
            None,
            "a|b|Episode 7",
            Some(880_000)
        ));
    }
}
