//! Steam Deck (Game mode) controller reader.
//!
//! webkit2gtk's Web Gamepad API is backed by libmanette, which doesn't reliably surface the
//! Steam Deck's (Steam-virtual) controller inside a flatpak — unlike Chromium, which reads the
//! evdev device directly. So we do the same on the Rust side: read the pad via evdev (through
//! gilrs, which enumerates devices + maps to the standard Xbox layout) and emit a single
//! `gamepad-input` = `{ name, pressed }` event to the webview for every mapped button. The
//! frontend translates those into navigation + player controls (see nav/gamepad.ts and
//! player/gamepad.ts). Needs the flatpak `--device=all` permission so /dev/input is reachable.

#![cfg(target_os = "linux")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use gilrs::{Axis, Button, EventType, Gilrs};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static RUNNING: AtomicBool = AtomicBool::new(false);

/// Analog trigger / stick press + release thresholds (gilrs reports 0.0..=1.0 and -1.0..=1.0).
const TRIGGER_ON: f32 = 0.3;
const STICK_ON: f32 = 0.6;
const STICK_OFF: f32 = 0.4;

#[derive(Serialize, Clone)]
struct Input {
    name: &'static str,
    pressed: bool,
}

/// Merged direction state: a direction is "pressed" if the d-pad OR the left stick says so, so
/// the frontend gets one clean up/down/left/right stream regardless of which the user uses.
#[derive(Default)]
struct Dirs {
    dpad: [bool; 4],  // up, down, left, right
    stick: [bool; 4],
    out: [bool; 4],
}
const NAMES: [&str; 4] = ["up", "down", "left", "right"];

impl Dirs {
    /// Recompute merged state; return any (name, pressed) that changed.
    fn resolve(&mut self) -> Vec<Input> {
        let mut changed = Vec::new();
        for i in 0..4 {
            let now = self.dpad[i] || self.stick[i];
            if now != self.out[i] {
                self.out[i] = now;
                changed.push(Input { name: NAMES[i], pressed: now });
            }
        }
        changed
    }
}

fn btn_name(b: Button) -> Option<&'static str> {
    Some(match b {
        Button::South => "a",
        Button::East => "b",
        Button::LeftTrigger => "l1",
        Button::RightTrigger => "r1",
        Button::LeftTrigger2 => "l2",
        Button::RightTrigger2 => "r2",
        Button::Start => "start",
        Button::Select => "select",
        _ => return None,
    })
}

/// Start reading the gamepad on a background thread, emitting `gamepad-input` on every change.
/// Idempotent — a second call while running is a no-op.
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
            let mut dirs = Dirs::default();
            let emit = |app: &AppHandle, i: &Input| {
                crate::player::linux_embed::elog(&format!("gamepad: {}={}", i.name, i.pressed));
                let _ = app.emit("gamepad-input", i.clone());
            };
            while RUNNING.load(Ordering::SeqCst) {
                while let Some(ev) = gilrs.next_event() {
                    match ev.event {
                        EventType::Connected => {
                            crate::player::linux_embed::elog(&format!("gamepad: connected id={:?}", ev.id));
                        }
                        // D-pad → merged directions.
                        EventType::ButtonPressed(b, _) | EventType::ButtonReleased(b, _)
                            if matches!(b, Button::DPadUp | Button::DPadDown | Button::DPadLeft | Button::DPadRight) =>
                        {
                            let pressed = matches!(ev.event, EventType::ButtonPressed(_, _));
                            let i = match b {
                                Button::DPadUp => 0,
                                Button::DPadDown => 1,
                                Button::DPadLeft => 2,
                                _ => 3,
                            };
                            dirs.dpad[i] = pressed;
                            for c in dirs.resolve() { emit(&app, &c); }
                        }
                        // Analog triggers report as ButtonChanged (0..1); everything else as press/release.
                        EventType::ButtonChanged(Button::LeftTrigger2, v, _) => {
                            emit(&app, &Input { name: "l2", pressed: v > TRIGGER_ON });
                        }
                        EventType::ButtonChanged(Button::RightTrigger2, v, _) => {
                            emit(&app, &Input { name: "r2", pressed: v > TRIGGER_ON });
                        }
                        EventType::ButtonPressed(b, _) => {
                            if let Some(n) = btn_name(b) { emit(&app, &Input { name: n, pressed: true }); }
                        }
                        EventType::ButtonReleased(b, _) => {
                            if let Some(n) = btn_name(b) { emit(&app, &Input { name: n, pressed: false }); }
                        }
                        // Left stick → merged directions with hysteresis.
                        EventType::AxisChanged(axis, v, _)
                            if matches!(axis, Axis::LeftStickX | Axis::LeftStickY) =>
                        {
                            let (neg, pos) = match axis {
                                Axis::LeftStickX => (2usize, 3usize), // left, right
                                _ => (1usize, 0usize),                // down, up (stick up = +Y in gilrs)
                            };
                            // Hysteresis per half-axis.
                            if v > STICK_ON { dirs.stick[pos] = true; }
                            else if v < STICK_OFF { dirs.stick[pos] = false; }
                            if v < -STICK_ON { dirs.stick[neg] = true; }
                            else if v > -STICK_OFF { dirs.stick[neg] = false; }
                            for c in dirs.resolve() { emit(&app, &c); }
                        }
                        _ => {}
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
