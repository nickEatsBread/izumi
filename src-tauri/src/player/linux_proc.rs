//! Linux playback: a SEPARATE mpv process driven over a JSON IPC socket.
//!
//! In-process libmpv (own-window OR the OpenGL render API into a GtkGLArea) crashes the
//! WebKitGTK renderer on Wayland — webkit's UI-process compositor and a second in-process
//! GL user can't coexist, and there's no way to share webkit's GL context (unlike Flutter).
//! This is confirmed across the wry/Tauri ecosystem (wry#284, tauri#6343, tauri-plugin-mpv,
//! tauri-plugin-libmpv which flat-out refuses Wayland). The robust pattern everyone lands on:
//! spawn the mpv BINARY as its own fullscreen window and control it via `--input-ipc-server`.
//!
//! mpv owns its own Wayland surface, so it never touches webkit → no crash. Playback state
//! (position/duration/eof) is streamed back over IPC and re-emitted as the SAME Tauri events
//! the embedded (Windows) path emits — `player-progress` [pos,dur] and `player-ended` — so the
//! frontend's tracking / resume / auto-next keep working unchanged.
#![cfg(target_os = "linux")]
// DORMANT: the embedded wl_subsurface path (super::linux_embed) is the shipped Desktop
// player. Kept as the intended gamescope / Steam Deck Game-mode fallback (a single-window
// fullscreen compositor where a separate fullscreen mpv is the accepted pattern), so it is
// intentionally unwired for now.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

struct Proc {
    child: Child,
    sock: String,
}
static PROC: Mutex<Option<Proc>> = Mutex::new(None);

fn socket_path() -> String {
    let base = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    format!("{base}/izumi-mpv-{}.sock", std::process::id())
}

/// The mpv executable: the one bundled in the Flatpak (`/app/bin/mpv`), else system `mpv`.
fn mpv_bin() -> String {
    if Path::new("/app/bin/mpv").exists() {
        "/app/bin/mpv".to_string()
    } else {
        "mpv".to_string()
    }
}

/// Send one JSON IPC command on a fresh connection (fire-and-forget).
fn ipc_send(sock: &str, json: &str) {
    if let Ok(mut s) = UnixStream::connect(sock) {
        let _ = s.write_all(json.as_bytes());
        let _ = s.write_all(b"\n");
        let _ = s.flush();
    }
}

/// Spawn mpv (fullscreen, idle) and load `url`, resuming at `start_seconds`. Replaces any
/// currently-playing instance. Returns once the file is queued (fast) — playback + events
/// continue on mpv's side.
pub fn play(
    app: AppHandle,
    url: &str,
    start_seconds: Option<f64>,
    alang: Option<String>,
    slang: Option<String>,
) -> Result<(), String> {
    stop(); // tear down any previous mpv

    let sock = socket_path();
    let _ = std::fs::remove_file(&sock);

    let mut cmd = Command::new(mpv_bin());
    cmd.arg(format!("--input-ipc-server={sock}"))
        .arg("--idle=yes")
        .arg("--force-window=yes")
        .arg("--fullscreen=yes")
        .arg("--keep-open=yes")
        // No config/OSC scripts from the host; keep it self-contained.
        .arg("--no-config")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(a) = &alang {
        cmd.arg(format!("--alang={a}"));
    }
    if let Some(s) = &slang {
        cmd.arg(format!("--slang={s}"));
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("Couldn't launch mpv: {e}"))?;

    // mpv creates the IPC socket asynchronously after start — wait for it.
    let t0 = Instant::now();
    while !Path::new(&sock).exists() {
        if t0.elapsed() > Duration::from_secs(10) {
            return Err("mpv did not open its IPC socket in time.".to_string());
        }
        std::thread::sleep(Duration::from_millis(30));
    }

    // loadfile with a per-file resume position (mpv 0.38+ options-map form; we build 0.40).
    let start = start_seconds.filter(|s| *s > 0.0);
    let load = if let Some(sec) = start {
        serde_json::json!({ "command": ["loadfile", url, "replace", 0, { "start": format!("{sec}") }] })
    } else {
        serde_json::json!({ "command": ["loadfile", url, "replace"] })
    };
    ipc_send(&sock, &load.to_string());

    spawn_event_loop(app, sock.clone());
    *PROC.lock().unwrap() = Some(Proc { child, sock });
    Ok(())
}

/// Stop playback: quit mpv (over IPC, then kill as a fallback) and drop the handle.
pub fn stop() {
    if let Some(mut p) = PROC.lock().unwrap().take() {
        ipc_send(&p.sock, &serde_json::json!({ "command": ["quit"] }).to_string());
        std::thread::sleep(Duration::from_millis(60));
        let _ = p.child.kill();
        let _ = p.child.wait();
        let _ = std::fs::remove_file(&p.sock);
    }
}

/// Send a bare property set to the running mpv (e.g. pause). No-op if nothing is playing.
pub fn set_property(name: &str, value: serde_json::Value) {
    if let Some(p) = &*PROC.lock().unwrap() {
        ipc_send(
            &p.sock,
            &serde_json::json!({ "command": ["set_property", name, value] }).to_string(),
        );
    }
}

/// Send a command array (e.g. ["seek", 30, "absolute"]) to the running mpv.
pub fn command(args: serde_json::Value) {
    if let Some(p) = &*PROC.lock().unwrap() {
        ipc_send(&p.sock, &serde_json::json!({ "command": args }).to_string());
    }
}

/// Read the event/observe stream on a dedicated connection and re-emit playback state as the
/// same Tauri events the Windows embed emits, so the frontend's progress/resume/next work.
fn spawn_event_loop(app: AppHandle, sock: String) {
    std::thread::spawn(move || {
        // The socket may take a moment more to accept connections.
        let mut stream = None;
        let t0 = Instant::now();
        while t0.elapsed() < Duration::from_secs(5) {
            if let Ok(s) = UnixStream::connect(&sock) {
                stream = Some(s);
                break;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        let Some(mut s) = stream else { return };

        // Observe the properties that drive progress + end-of-file.
        for (id, prop) in ["time-pos", "duration", "eof-reached"].iter().enumerate() {
            let c = serde_json::json!({ "command": ["observe_property", id + 1, prop] });
            let _ = s.write_all(c.to_string().as_bytes());
            let _ = s.write_all(b"\n");
        }
        let _ = s.flush();

        let reader = BufReader::new(s);
        let mut duration = 0.0f64;
        for line in reader.lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            match v.get("event").and_then(|e| e.as_str()) {
                Some("property-change") => {
                    let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    match name {
                        "duration" => {
                            if let Some(d) = v.get("data").and_then(|d| d.as_f64()) {
                                duration = d;
                            }
                        }
                        "time-pos" => {
                            if let Some(pos) = v.get("data").and_then(|d| d.as_f64()) {
                                let _ = app.emit("player-progress", (pos, duration));
                            }
                        }
                        _ => {}
                    }
                }
                Some("end-file") => {
                    // Normal completion → let the frontend auto-advance.
                    if v.get("reason").and_then(|r| r.as_str()) == Some("eof") {
                        let _ = app.emit("player-ended", ());
                    }
                }
                _ => {}
            }
        }
    });
}
