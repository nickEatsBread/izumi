//! External subtitle alignment.
//!
//! The correlation approach is adapted from Harbor's MIT-licensed subtitle synchronizer. Izumi
//! keeps it desktop-only because it shells out to a locally installed ffmpeg.

mod correlate;
mod extract;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    offset_sec: f32,
    ratio: f32,
    confidence: f32,
}

static BUSY: AtomicBool = AtomicBool::new(false);

struct BusyGuard;
impl Drop for BusyGuard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}

fn analysis_windows(duration: f32) -> Vec<(f32, f32)> {
    if duration < 900.0 {
        let start = (duration * 0.05).max(5.0);
        return vec![(start, (duration * 0.9 - start).max(30.0))];
    }
    let late_start = (duration - 720.0).max(780.0);
    vec![(180.0, 600.0), (late_start, 600.0)]
}

#[tauri::command]
pub async fn sync_subtitle(
    url: String,
    headers: Option<HashMap<String, String>>,
    cues: Vec<[f32; 2]>,
    duration_sec: f32,
    info_hash: Option<String>,
) -> Result<Option<SyncResult>, String> {
    // Direct torrent playback is a loopback endpoint whose seeks can trigger expensive piece
    // downloads. Do not scan it behind the user's back.
    if info_hash.as_deref().is_some_and(|hash| !hash.is_empty()) {
        return Ok(None);
    }
    if cues.len() < 4 || duration_sec < 60.0 {
        return Ok(None);
    }
    if BUSY.swap(true, Ordering::SeqCst) {
        return Ok(None);
    }
    let _busy = BusyGuard;

    let headers = headers.unwrap_or_default();
    let mut speech = Vec::new();
    for (start, length) in analysis_windows(duration_sec) {
        match extract::speech_intervals(&url, &headers, start, length).await {
            Ok(intervals) => speech.extend(intervals),
            Err(error) if error == "ffmpeg-unavailable" => return Err(error),
            Err(_) => {}
        }
    }
    if speech.is_empty() {
        return Err("no-audio-analyzed".into());
    }

    let subtitle_intervals = cues
        .into_iter()
        .map(|cue| (cue[0], cue[1]))
        .collect::<Vec<_>>();
    Ok(
        correlate::solve(&speech, &subtitle_intervals, duration_sec, 0.55).map(|result| {
            SyncResult {
                offset_sec: result.offset_sec,
                ratio: result.ratio,
                confidence: result.confidence,
            }
        }),
    )
}
