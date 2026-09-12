//! Game-mode display refresh matching through gamescope's private `gamescope_control` protocol.
//!
//! The OLED Steam Deck drives its panel at ~90 Hz, so 24 fps anime lands on a 3.75-frame cadence
//! (visible judder) under mpv's default `video-sync=audio`. gamescope offers
//! `set_app_target_refresh_cycle(fps, flags)`: it picks the highest refresh the panel advertises
//! that is an integer multiple of `fps` (24 → 72 Hz, 30 → 90 Hz) and, with
//! `only_change_refresh_rate`, leaves its frame limiter alone. Verified against gamescope's
//! `steamcompmgr.cpp`: the override is global per display type and carries no client check, so it
//! MUST be cleared (fps = 0) when playback stops and when the app exits. On an LCD Deck the panel
//! advertises no switchable rates and every request is a harmless no-op.
//!
//! The Flatpak already reaches gamescope's own socket (`--filesystem=xdg-run/gamescope-0`, the
//! session exports `GAMESCOPE_WAYLAND_DISPLAY`). This module keeps ONE long-lived connection on
//! its own thread — never GTK's display — so nothing here can disturb WebKit or the X11 player.
#![cfg(target_os = "linux")]

use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::Mutex;
use std::time::Duration;

use wayland_client::globals::{registry_queue_init, GlobalListContents};
use wayland_client::protocol::wl_registry::WlRegistry;
use wayland_client::{Connection, Dispatch, QueueHandle, WEnum};

use super::linux_embed::elog;
use crate::gm_perf::{
    refresh_target_fps, REFRESH_CYCLE_FLAGS_EXTERNAL, REFRESH_CYCLE_FLAGS_INTERNAL,
};

/// Client bindings generated from the vendored `protocols/gamescope-control.xml` (Valve, MIT).
pub mod protocol {
    #![allow(
        non_upper_case_globals,
        non_camel_case_types,
        unused_imports,
        dead_code,
        clippy::all
    )]
    use wayland_client;
    use wayland_client::protocol::*;
    pub mod __interfaces {
        use wayland_client::protocol::__interfaces::*;
        wayland_scanner::generate_interfaces!("./protocols/gamescope-control.xml");
    }
    use self::__interfaces::*;
    wayland_scanner::generate_client_code!("./protocols/gamescope-control.xml");
}
use protocol::gamescope_control::{self, GamescopeControl, TargetRefreshCycleFlag};

enum Cmd {
    /// Ask for a panel refresh that is a multiple of this many frames per second.
    Target(u32),
    /// Back to the native refresh; the optional channel is signalled once the request is flushed.
    Clear(Option<SyncSender<()>>),
}

static TX: Mutex<Option<Sender<Cmd>>> = Mutex::new(None);
/// Set once connecting or talking to gamescope fails; every later call is then a cheap no-op
/// instead of a reconnect storm (gamescope does not come back mid-session).
static UNAVAILABLE: AtomicBool = AtomicBool::new(false);
/// How long an exit-time clear may wait for the worker to flush the request.
const CLEAR_FLUSH_TIMEOUT: Duration = Duration::from_millis(500);
/// Command poll cadence; event pumping (display info updates) piggybacks on it.
const POLL: Duration = Duration::from_millis(250);

struct State {
    valid_rates: Vec<u32>,
    display_flags: u32,
}

impl Dispatch<WlRegistry, GlobalListContents> for State {
    fn event(
        _: &mut Self,
        _: &WlRegistry,
        _: wayland_client::protocol::wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<GamescopeControl, ()> for State {
    fn event(
        state: &mut Self,
        _: &GamescopeControl,
        event: gamescope_control::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let gamescope_control::Event::ActiveDisplayInfo {
            connector_name,
            display_make,
            display_model,
            display_flags,
            valid_refresh_rates,
        } = event
        {
            // "32-bit unsigned integers"; empty when the display is fixed at one mode (LCD Deck).
            state.valid_rates = valid_refresh_rates
                .chunks_exact(4)
                .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            state.display_flags = match display_flags {
                WEnum::Value(flags) => flags.bits(),
                WEnum::Unknown(raw) => raw,
            };
            elog(&format!(
                "refresh: display {connector_name} ({display_make} {display_model}) flags={:#x} valid_rates={:?}",
                state.display_flags, state.valid_rates
            ));
        }
    }
}

/// gamescope's socket for this session, or `None` outside Game mode.
fn socket_path() -> Option<PathBuf> {
    let name = PathBuf::from(std::env::var_os("GAMESCOPE_WAYLAND_DISPLAY")?);
    if name.is_absolute() {
        return Some(name);
    }
    Some(PathBuf::from(std::env::var_os("XDG_RUNTIME_DIR")?).join(name))
}

/// The worker's command channel. `spawn` = start the worker if there is none yet; a clear with
/// nothing running has nothing to undo and must not open a connection just to say so.
fn sender(spawn: bool) -> Option<Sender<Cmd>> {
    if UNAVAILABLE.load(Ordering::Relaxed) {
        return None;
    }
    let mut guard = TX.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(tx) = guard.as_ref() {
        return Some(tx.clone());
    }
    if !spawn {
        return None;
    }
    let path = socket_path()?;
    let (tx, rx) = mpsc::channel();
    match std::thread::Builder::new()
        .name("izumi-gamescope-refresh".into())
        .spawn(move || worker(path, rx))
    {
        Ok(_) => {
            *guard = Some(tx.clone());
            Some(tx)
        }
        Err(error) => {
            elog(&format!("refresh: could not start worker: {error}"));
            UNAVAILABLE.store(true, Ordering::Relaxed);
            None
        }
    }
}

fn request(cmd: Cmd, spawn: bool) {
    let Some(tx) = sender(spawn) else { return };
    if tx.send(cmd).is_err() {
        // The worker is gone (socket died); forget the channel so the next call sees no worker.
        *TX.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }
}

fn send_cycle(control: &GamescopeControl, fps: u32) {
    control.set_app_target_refresh_cycle(
        fps,
        TargetRefreshCycleFlag::from_bits_truncate(REFRESH_CYCLE_FLAGS_INTERNAL),
    );
    control.set_app_target_refresh_cycle(
        fps,
        TargetRefreshCycleFlag::from_bits_truncate(REFRESH_CYCLE_FLAGS_EXTERNAL),
    );
}

fn worker(path: PathBuf, rx: Receiver<Cmd>) {
    let outcome = (|| -> Result<(), String> {
        let stream = UnixStream::connect(&path)
            .map_err(|e| format!("connect {}: {e}", path.display()))?;
        let conn = Connection::from_socket(stream).map_err(|e| format!("wayland: {e}"))?;
        let (globals, mut queue) =
            registry_queue_init::<State>(&conn).map_err(|e| format!("registry: {e}"))?;
        let qh = queue.handle();
        // v2 carries set_app_target_refresh_cycle + active_display_info; newer events are ignored.
        let control: GamescopeControl = globals
            .bind(&qh, 2..=6, ())
            .map_err(|e| format!("bind gamescope_control: {e}"))?;
        let mut state = State {
            valid_rates: Vec::new(),
            display_flags: 0,
        };
        // The first roundtrip delivers feature_support + active_display_info.
        queue
            .roundtrip(&mut state)
            .map_err(|e| format!("roundtrip: {e}"))?;
        elog("refresh: gamescope_control bound");

        let mut current: Option<u32> = None;
        loop {
            match rx.recv_timeout(POLL) {
                Ok(Cmd::Target(fps)) => {
                    if current != Some(fps) {
                        send_cycle(&control, fps);
                        current = Some(fps);
                        elog(&format!(
                            "refresh: requested a refresh cycle for {fps} fps (panel rates {:?})",
                            state.valid_rates
                        ));
                    }
                }
                Ok(Cmd::Clear(ack)) => {
                    if current.take().is_some() {
                        send_cycle(&control, 0);
                        elog("refresh: cleared the refresh cycle override");
                    }
                    conn.flush().map_err(|e| format!("flush: {e}"))?;
                    if let Some(ack) = ack {
                        let _ = ack.send(());
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    if current.take().is_some() {
                        send_cycle(&control, 0);
                    }
                    let _ = conn.flush();
                    return Ok(());
                }
            }
            conn.flush().map_err(|e| format!("flush: {e}"))?;
            // Pump display-info updates (dock/undock) without ever blocking on the socket.
            if let Some(guard) = queue.prepare_read() {
                let mut pfd = libc::pollfd {
                    fd: guard.connection_fd().as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                };
                let ready = unsafe { libc::poll(&mut pfd, 1, 0) };
                if ready > 0 {
                    guard.read().map_err(|e| format!("read: {e}"))?;
                } else {
                    drop(guard);
                }
            }
            queue
                .dispatch_pending(&mut state)
                .map_err(|e| format!("dispatch: {e}"))?;
        }
    })();
    if let Err(error) = outcome {
        elog(&format!("refresh: worker stopped: {error}"));
        UNAVAILABLE.store(true, Ordering::Relaxed);
    }
    *TX.lock().unwrap_or_else(|p| p.into_inner()) = None;
}

/// A file finished loading in the player: ask for a refresh that divides evenly by its frame
/// rate, or drop any earlier request when the rate is unknown/variable.
pub fn on_file_loaded(container_fps: f64) {
    match refresh_target_fps(container_fps) {
        Some(fps) => request(Cmd::Target(fps), true),
        None => request(Cmd::Clear(None), false),
    }
}

/// Playback stopped: give the panel back its native refresh.
pub fn clear() {
    request(Cmd::Clear(None), false);
}

/// Exit path: same as [`clear`], but waits (bounded) for the request to reach the socket, since the
/// process is about to go away and gamescope would otherwise keep our override forever.
pub fn clear_blocking() {
    let Some(tx) = sender(false) else { return };
    let (ack_tx, ack_rx) = mpsc::sync_channel(1);
    if tx.send(Cmd::Clear(Some(ack_tx))).is_ok() {
        let _ = ack_rx.recv_timeout(CLEAR_FLUSH_TIMEOUT);
    }
}
