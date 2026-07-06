//! Steam Deck (Game mode) L2/R2 reader.
//!
//! webkit2gtk's Web Gamepad API is backed by libmanette, which historically doesn't reliably
//! surface the Steam Deck's (Steam-virtual) controller inside a flatpak — unlike Chromium,
//! which reads the evdev device directly. So we do the same on the Rust side: read the pad via
//! evdev (through gilrs, which enumerates devices + maps to the standard Xbox layout), and emit
//! the L2/R2 pressed state to the webview as a `gamepad-trigger` event. The frontend feeds that
//! into the same TriggerScrubber that drives the seek (see player/gamepad.ts). Needs the flatpak
//! `--device=all` permission so /dev/input is reachable.

#![cfg(target_os = "linux")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use gilrs::{Button, EventType, Gilrs};
use tauri::{AppHandle, Emitter};

static RUNNING: AtomicBool = AtomicBool::new(false);

/// A trigger counts as "pressed" past this analog value (gilrs reports L2/R2 as 0.0..=1.0).
const TRIGGER_ON: f32 = 0.3;

/// Start reading the gamepad on a background thread and emitting `gamepad-trigger` = `(l2, r2)`
/// booleans on change. Idempotent — a second call while running is a no-op.
pub fn start(app: AppHandle) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("izumi-gamepad".into())
        .spawn(move || {
            let mut gilrs = match Gilrs::new() {
                Ok(g) => g,
                Err(e) => {
                    crate::player::linux_embed::elog(&format!("gamepad: gilrs init failed: {e}"));
                    RUNNING.store(false, Ordering::SeqCst);
                    return;
                }
            };
            crate::player::linux_embed::elog(&format!(
                "gamepad: reader started, {} pad(s) connected",
                gilrs.gamepads().count()
            ));
            let (mut l2, mut r2) = (false, false);
            while RUNNING.load(Ordering::SeqCst) {
                while let Some(ev) = gilrs.next_event() {
                    let (mut nl, mut nr) = (l2, r2);
                    match ev.event {
                        EventType::ButtonChanged(Button::LeftTrigger2, v, _) => nl = v > TRIGGER_ON,
                        EventType::ButtonChanged(Button::RightTrigger2, v, _) => nr = v > TRIGGER_ON,
                        EventType::ButtonPressed(Button::LeftTrigger2, _) => nl = true,
                        EventType::ButtonReleased(Button::LeftTrigger2, _) => nl = false,
                        EventType::ButtonPressed(Button::RightTrigger2, _) => nr = true,
                        EventType::ButtonReleased(Button::RightTrigger2, _) => nr = false,
                        EventType::Connected => {
                            crate::player::linux_embed::elog(&format!(
                                "gamepad: connected id={:?}",
                                ev.id
                            ));
                        }
                        _ => {}
                    }
                    if nl != l2 || nr != r2 {
                        l2 = nl;
                        r2 = nr;
                        crate::player::linux_embed::elog(&format!("gamepad: L2={l2} R2={r2}"));
                        let _ = app.emit("gamepad-trigger", (l2, r2));
                    }
                }
                std::thread::sleep(Duration::from_millis(8)); // ~120 Hz poll
            }
        });
}

/// Stop the reader thread (it exits on its next poll).
pub fn stop() {
    RUNNING.store(false, Ordering::SeqCst);
}
