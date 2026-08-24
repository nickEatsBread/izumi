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

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use gilrs::{Axis, Button, EventType, GilrsBuilder};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

static RUNNING: AtomicBool = AtomicBool::new(false);
static RUN_ID: AtomicU64 = AtomicU64::new(0);
static TOUCH_RESTORE_PENDING: AtomicBool = AtomicBool::new(false);
static TRIGGERS: OnceLock<Mutex<TriggerState>> = OnceLock::new();

/// Analog trigger / stick press + release thresholds (gilrs reports 0.0..=1.0 and -1.0..=1.0).
/// Triggers use hysteresis too (ON > OFF) so a slow pull hovering near the threshold can't
/// flip-flop and emit a burst of press events.
const TRIGGER_ON: f32 = 0.3;
const TRIGGER_OFF: f32 = 0.2;
const STICK_ON: f32 = 0.6;
const STICK_OFF: f32 = 0.4;

#[derive(Serialize, Clone)]
struct Input {
    name: &'static str,
    pressed: bool,
}

#[derive(Default, Serialize, Clone)]
pub struct TriggerState {
    pub l2: bool,
    pub r2: bool,
}

pub fn trigger_state() -> TriggerState {
    TRIGGERS
        .get_or_init(|| Mutex::new(TriggerState::default()))
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default()
}

fn set_trigger_state(input: &Input) {
    if input.name != "l2" && input.name != "r2" {
        return;
    }
    if let Ok(mut state) = TRIGGERS
        .get_or_init(|| Mutex::new(TriggerState::default()))
        .lock()
    {
        if input.name == "l2" {
            state.l2 = input.pressed;
        } else {
            state.r2 = input.pressed;
        }
    }
}

/// Steam can transition its Gamescope input routing when controller navigation takes over without
/// giving the app another focus event. Re-publish the native-touch root property just after that
/// transition so XWayland/WebKit continues receiving real touch sequences. This does not synthesize
/// gestures or pointer events; it only asks Gamescope to keep its native passthrough mode.
fn schedule_native_touch_restore(app: &AppHandle) {
    if std::env::var_os("GAMESCOPE_WAYLAND_DISPLAY").is_none()
        || TOUCH_RESTORE_PENDING.swap(true, Ordering::SeqCst)
    {
        return;
    }

    let delayed_app = app.clone();
    if app
        .run_on_main_thread(move || {
            glib::timeout_add_local_once(Duration::from_millis(120), move || {
                if let Some(window) = delayed_app.get_webview_window("main") {
                    if crate::player::linux_embed::is_wayland(&window) {
                        TOUCH_RESTORE_PENDING.store(false, Ordering::SeqCst);
                        return;
                    }
                    if let Err(error) = crate::player::linux_x11::enable_native_touch(&window) {
                        crate::player::linux_embed::elog(&format!(
                            "gamepad: native touch restore failed: {error}"
                        ));
                    }
                }
                TOUCH_RESTORE_PENDING.store(false, Ordering::SeqCst);
            });
        })
        .is_err()
    {
        TOUCH_RESTORE_PENDING.store(false, Ordering::SeqCst);
    }
}

/// Merged direction state: a direction is "pressed" if the d-pad OR the left stick says so, so
/// the frontend gets one clean up/down/left/right stream regardless of which the user uses.
#[derive(Default)]
struct Dirs {
    dpad: [bool; 4], // up, down, left, right
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
                changed.push(Input {
                    name: NAMES[i],
                    pressed: now,
                });
            }
        }
        changed
    }
}

fn btn_name(b: Button) -> Option<&'static str> {
    Some(match b {
        Button::South => "a",
        Button::East => "b",
        Button::West => "x",
        Button::LeftTrigger => "l1",
        Button::RightTrigger => "r1",
        Button::LeftTrigger2 => "l2",
        Button::RightTrigger2 => "r2",
        Button::Start => "start",
        Button::Select => "select",
        _ => return None,
    })
}

/// Steam Deck rear grips. hid-steam reports BTN_GRIP* while some Steam virtual-controller
/// layouts use BTN_TRIGGER_HAPPY*. gilrs leaves both as `Button::Unknown` plus the evdev code.
fn grip_btn_name_from_packed(packed: u32) -> Option<&'static str> {
    let kind = (packed >> 16) as u16;
    let key = (packed & 0xffff) as u16;
    if kind != 1 {
        return None;
    }
    Some(match key {
        0x224 | 0x2c0 => "l4", // BTN_GRIPL / BTN_TRIGGER_HAPPY1
        0x225 | 0x2c1 => "r4", // BTN_GRIPR / BTN_TRIGGER_HAPPY2
        0x226 | 0x2c2 => "l5", // BTN_GRIPL2 / BTN_TRIGGER_HAPPY3
        0x227 | 0x2c3 => "r5", // BTN_GRIPR2 / BTN_TRIGGER_HAPPY4
        _ => return None,
    })
}

fn grip_btn_name(code: gilrs::ev::Code) -> Option<&'static str> {
    grip_btn_name_from_packed(code.into_u32())
}

/// Start reading the gamepad on a background thread, emitting `gamepad-input` on every change.
/// Idempotent — a second call while running is a no-op.
pub fn start(app: AppHandle) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    // stop() invalidates the prior generation before a replacement reader starts. Without this,
    // a reader still inside next_event_blocking could wake after RUNNING became true again and
    // accidentally continue alongside its replacement.
    let run_id = RUN_ID.fetch_add(1, Ordering::SeqCst).wrapping_add(1);
    let _ = std::thread::Builder::new()
        .name("izumi-gamepad".into())
        .spawn(move || {
            // The built-in filter loop restarts the full blocking timeout whenever it drops a
            // jitter/dead-zone event. A noisy analogue axis can therefore keep a stopped reader
            // alive well past the advertised 250 ms bound. This consumer already applies larger
            // hysteresis thresholds to every analogue input it uses, so read mapped raw events
            // and handle d-pad axes below instead.
            let mut gilrs = match GilrsBuilder::new().with_default_filters(false).build() {
                Ok(g) => g,
                Err(e) => {
                    crate::player::linux_embed::elog(&format!("gamepad: gilrs init failed: {e}"));
                    if RUN_ID.load(Ordering::SeqCst) == run_id {
                        RUNNING.store(false, Ordering::SeqCst);
                    }
                    return;
                }
            };
            crate::player::linux_embed::elog(&format!(
                "gamepad: reader started, {} pad(s) connected",
                gilrs.gamepads().count()
            ));
            let mut dirs = Dirs::default();
            // Edge-detected trigger state: gilrs fires ButtonChanged on EVERY analog tick, so a
            // single trigger pull crosses TRIGGER_ON many times. Emit `gamepad-input` only when the
            // boolean pressed state actually flips — otherwise consumers that step per-event (the
            // schedule day switch) jumped several days on one pull. The player seek reads the held
            // bool, so it's unaffected.
            let mut l2_on = false;
            let mut r2_on = false;
            let emit = |app: &AppHandle, i: &Input| {
                set_trigger_state(i);
                if i.pressed && crate::gm_perf::gamepad_input_restores_touch(i.name) {
                    schedule_native_touch_restore(app);
                }
                crate::player::linux_embed::elog(&format!("gamepad: {}={}", i.name, i.pressed));
                let _ = app.emit("gamepad-input", i.clone());
            };
            while RUNNING.load(Ordering::SeqCst) && RUN_ID.load(Ordering::SeqCst) == run_id {
                // Sleep in the kernel until evdev has work instead of waking the Deck CPU every
                // 8ms for the lifetime of Game mode. The timeout only bounds gamepad_stop(); an
                // input edge wakes immediately, so controller latency is unchanged. After the
                // first edge, drain everything already queued before blocking again.
                let mut pending = gilrs.next_event_blocking(Some(Duration::from_millis(250)));
                if !RUNNING.load(Ordering::SeqCst) || RUN_ID.load(Ordering::SeqCst) != run_id {
                    break;
                }
                while let Some(ev) = pending {
                    match ev.event {
                        EventType::Connected => {
                            crate::player::linux_embed::elog(&format!(
                                "gamepad: connected id={:?}",
                                ev.id
                            ));
                        }
                        // D-pad → merged directions.
                        EventType::ButtonPressed(b, _) | EventType::ButtonReleased(b, _)
                            if matches!(
                                b,
                                Button::DPadUp
                                    | Button::DPadDown
                                    | Button::DPadLeft
                                    | Button::DPadRight
                            ) =>
                        {
                            let pressed = matches!(ev.event, EventType::ButtonPressed(_, _));
                            let i = match b {
                                Button::DPadUp => 0,
                                Button::DPadDown => 1,
                                Button::DPadLeft => 2,
                                _ => 3,
                            };
                            dirs.dpad[i] = pressed;
                            for c in dirs.resolve() {
                                emit(&app, &c);
                            }
                        }
                        // Analog triggers report as ButtonChanged (0..1); everything else as press/release.
                        // Only emit on a boolean edge (with hysteresis) — see l2_on/r2_on above.
                        EventType::ButtonChanged(Button::LeftTrigger2, v, _) => {
                            let now = if l2_on {
                                v > TRIGGER_OFF
                            } else {
                                v > TRIGGER_ON
                            };
                            if now != l2_on {
                                l2_on = now;
                                emit(
                                    &app,
                                    &Input {
                                        name: "l2",
                                        pressed: now,
                                    },
                                );
                            }
                        }
                        EventType::ButtonChanged(Button::RightTrigger2, v, _) => {
                            let now = if r2_on {
                                v > TRIGGER_OFF
                            } else {
                                v > TRIGGER_ON
                            };
                            if now != r2_on {
                                r2_on = now;
                                emit(
                                    &app,
                                    &Input {
                                        name: "r2",
                                        pressed: now,
                                    },
                                );
                            }
                        }
                        // Some Steam Input layouts expose L2/R2 as their Z axes instead of
                        // ButtonChanged. Accept both representations behind the same edge latch;
                        // values are normalised to -1..1 (signed) or 0..1 (SDL-style), and these
                        // thresholds work for either resting convention.
                        EventType::AxisChanged(axis, v, _)
                            if matches!(axis, Axis::LeftZ | Axis::RightZ) =>
                        {
                            let state = if matches!(axis, Axis::LeftZ) {
                                &mut l2_on
                            } else {
                                &mut r2_on
                            };
                            let now = if *state { v > 0.25 } else { v > 0.55 };
                            if now != *state {
                                *state = now;
                                emit(
                                    &app,
                                    &Input {
                                        name: if matches!(axis, Axis::LeftZ) {
                                            "l2"
                                        } else {
                                            "r2"
                                        },
                                        pressed: now,
                                    },
                                );
                            }
                        }
                        EventType::ButtonPressed(b, code) => {
                            if let Some(n) = grip_btn_name(code).or_else(|| btn_name(b)) {
                                emit(
                                    &app,
                                    &Input {
                                        name: n,
                                        pressed: true,
                                    },
                                );
                            }
                        }
                        EventType::ButtonReleased(b, code) => {
                            if let Some(n) = grip_btn_name(code).or_else(|| btn_name(b)) {
                                emit(
                                    &app,
                                    &Input {
                                        name: n,
                                        pressed: false,
                                    },
                                );
                            }
                        }
                        // With gilrs' default filters disabled, controllers whose d-pad is a
                        // pair of hat axes reach us directly. Merge them with button-style d-pads
                        // so Steam Input layouts and external controllers behave identically.
                        EventType::AxisChanged(axis, v, _)
                            if matches!(axis, Axis::DPadX | Axis::DPadY) =>
                        {
                            let (neg, pos) = match axis {
                                Axis::DPadX => (2usize, 3usize), // left, right
                                _ => (1usize, 0usize),           // down, up
                            };
                            dirs.dpad[neg] = v < -0.5;
                            dirs.dpad[pos] = v > 0.5;
                            for c in dirs.resolve() {
                                emit(&app, &c);
                            }
                        }
                        // Left stick → merged directions with hysteresis.
                        EventType::AxisChanged(axis, v, _)
                            if matches!(axis, Axis::LeftStickX | Axis::LeftStickY) =>
                        {
                            let (neg, pos) = match axis {
                                Axis::LeftStickX => (2usize, 3usize), // left, right
                                _ => (1usize, 0usize), // down, up (stick up = +Y in gilrs)
                            };
                            // Hysteresis per half-axis.
                            if v > STICK_ON {
                                dirs.stick[pos] = true;
                            } else if v < STICK_OFF {
                                dirs.stick[pos] = false;
                            }
                            if v < -STICK_ON {
                                dirs.stick[neg] = true;
                            } else if v > -STICK_OFF {
                                dirs.stick[neg] = false;
                            }
                            for c in dirs.resolve() {
                                emit(&app, &c);
                            }
                        }
                        _ => {}
                    }
                    pending = gilrs.next_event();
                }
            }
            if RUN_ID.load(Ordering::SeqCst) == run_id {
                RUNNING.store(false, Ordering::SeqCst);
            }
        });
}

/// Stop the reader thread (it exits within the blocking read's 250ms shutdown bound).
pub fn stop() {
    RUNNING.store(false, Ordering::SeqCst);
    RUN_ID.fetch_add(1, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::grip_btn_name_from_packed;

    const EV_KEY: u32 = 1 << 16;

    #[test]
    fn maps_kernel_steam_deck_grip_codes() {
        assert_eq!(grip_btn_name_from_packed(EV_KEY | 0x224), Some("l4"));
        assert_eq!(grip_btn_name_from_packed(EV_KEY | 0x225), Some("r4"));
        assert_eq!(grip_btn_name_from_packed(EV_KEY | 0x226), Some("l5"));
        assert_eq!(grip_btn_name_from_packed(EV_KEY | 0x227), Some("r5"));
    }

    #[test]
    fn maps_steam_virtual_controller_grip_codes() {
        assert_eq!(grip_btn_name_from_packed(EV_KEY | 0x2c0), Some("l4"));
        assert_eq!(grip_btn_name_from_packed(EV_KEY | 0x2c1), Some("r4"));
        assert_eq!(grip_btn_name_from_packed(EV_KEY | 0x2c2), Some("l5"));
        assert_eq!(grip_btn_name_from_packed(EV_KEY | 0x2c3), Some("r5"));
    }

    #[test]
    fn ignores_non_key_and_standard_button_codes() {
        assert_eq!(grip_btn_name_from_packed(0x224), None);
        assert_eq!(grip_btn_name_from_packed(EV_KEY | 0x139), None);
        assert_eq!(grip_btn_name_from_packed(EV_KEY | 0x13a), None);
    }
}
