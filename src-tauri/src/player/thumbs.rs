//! Scrub-preview tiles. One worker thread drives the headless decoder. The position under the
//! cursor always goes first; in between, the worker fills the rest of the grid in the background,
//! coarse to fine, so most hovers find their tile already rendered.

use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::headless::HeadlessMpv;

/// Background filling starts this long after a stream registers, so it never competes with the
/// first seconds of playback.
const BACKGROUND_DELAY: Duration = Duration::from_secs(8);
/// Pause between background tiles, which keeps their share of bandwidth and CPU small.
const BACKGROUND_GAP: Duration = Duration::from_millis(150);
/// With nothing to render for this long, the headless decoder closes its stream.
const IDLE_RELEASE: Duration = Duration::from_secs(3);
/// When a background tile could not be rendered, it is tried again after this long.
const RETRY_AFTER: Duration = Duration::from_secs(10);
/// A background tile that keeps failing is given up after this many attempts.
const MAX_ATTEMPTS: u8 = 30;

/// The main player is loading a file and has not shown its first frame yet.
pub(crate) static MAIN_PLAYER_LOADING: AtomicBool = AtomicBool::new(true);
/// The main player has paused to wait for data.
pub(crate) static MAIN_PLAYER_WAITING: AtomicBool = AtomicBool::new(false);

fn main_player_busy() -> bool {
    MAIN_PLAYER_LOADING.load(Ordering::Relaxed) || MAIN_PLAYER_WAITING.load(Ordering::Relaxed)
}

/// One file's tile grid.
#[derive(Clone)]
pub(crate) struct TileGrid {
    pub key: String,
    /// The URL that is playing. Never logged: debrid links carry an account token.
    pub url: String,
    /// What the headless decoder opens: the same URL, or a passive twin for a direct torrent.
    pub preview_url: String,
    pub dir: PathBuf,
    pub interval: u32,
    pub frames: u32,
    pub duration: f64,
    pub width: i32,
}

impl TileGrid {
    pub fn path(&self, index: u32) -> PathBuf {
        self.dir.join(format!("t_{index}.jpg"))
    }

    pub fn time(&self, index: u32) -> f64 {
        f64::from(index) * f64::from(self.interval)
    }

    /// Same file, same positions, same size: the same tiles.
    fn same_as(&self, other: &TileGrid) -> bool {
        self.key == other.key
            && self.url == other.url
            && self.width == other.width
            && self.interval == other.interval
            && self.frames == other.frames
    }
}

/// Whether the frame at a fraction of the playing file can be read without waiting: always for a
/// debrid or local stream, and for a direct torrent only where the pieces are already downloaded.
pub(crate) type ReadableAt = dyn Fn(&str, f64) -> bool + Send + Sync;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TileReady {
    key: String,
    index: u32,
    data_url: String,
}

struct Pending {
    index: u32,
    not_before: Instant,
    attempts: u8,
}

#[derive(Default)]
struct State {
    grid: Option<TileGrid>,
    registered: Option<Instant>,
    hover: Option<u32>,
    /// Tiles still to render, coarse to fine.
    background: VecDeque<Pending>,
    app: Option<AppHandle>,
}

impl State {
    /// Drop the grid and tell the seek bar, which forgets every tile it holds.
    fn reset(&mut self) {
        if let Some(app) = &self.app {
            let _ = app.emit("player-thumb-reset", ());
        }
        *self = State::default();
    }
}

pub(crate) struct ThumbScheduler {
    state: Mutex<State>,
    wake: Condvar,
    worker_started: AtomicBool,
}

struct Task {
    grid: TileGrid,
    index: u32,
    attempts: Option<u8>,
}

impl ThumbScheduler {
    pub fn new() -> Self {
        ThumbScheduler {
            state: Mutex::new(State::default()),
            wake: Condvar::new(),
            worker_started: AtomicBool::new(false),
        }
    }

    /// Start rendering `grid`: a hovered position at once, the rest in the background. Registering
    /// the same grid again changes nothing. Any other grid starts from an empty directory: tiles
    /// already there may be frames of another file with the same key (the next episode of a batch,
    /// another release of the episode, or a session that was killed mid-episode).
    pub fn start(
        self: &Arc<Self>,
        grid: TileGrid,
        app: AppHandle,
        headless: Arc<HeadlessMpv>,
        readable: Arc<ReadableAt>,
    ) {
        {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            if state
                .grid
                .as_ref()
                .is_some_and(|current| current.same_as(&grid))
            {
                return;
            }
            // Under the lock, so a tile of the grid being replaced is either written and sent
            // before this reset or dropped by `finish`.
            clear_tiles(&grid.dir);
            let now = Instant::now();
            let background = coarse_to_fine(grid.frames)
                .into_iter()
                .map(|index| Pending {
                    index,
                    not_before: now,
                    attempts: 0,
                })
                .collect();
            let _ = app.emit("player-thumb-reset", ());
            *state = State {
                grid: Some(grid),
                registered: Some(now),
                hover: None,
                background,
                app: Some(app),
            };
        }
        self.wake.notify_all();
        if !self.worker_started.swap(true, Ordering::SeqCst) {
            let scheduler = self.clone();
            let spawned = std::thread::Builder::new()
                .name("izumi-thumb-tiles".into())
                .spawn(move || scheduler.run(headless, readable));
            if spawned.is_err() {
                self.worker_started.store(false, Ordering::SeqCst);
            }
        }
    }

    /// Render the tile at `index` next.
    pub fn hover(&self, key: &str, index: u32) {
        if let Ok(mut state) = self.state.lock() {
            if state.grid.as_ref().is_some_and(|grid| grid.key == key) {
                state.hover = Some(index);
            }
        }
        self.wake.notify_all();
    }

    /// The main player is loading `url`. A grid for any other file stops here; the seek bar
    /// registers the new file's grid once it has loaded.
    pub fn retire_unless(&self, url: &str) {
        if let Ok(mut state) = self.state.lock() {
            if state.grid.as_ref().is_some_and(|grid| grid.url != url) {
                state.reset();
            }
        }
        self.wake.notify_all();
    }

    /// Forget the current stream. A tile still rendering for it is thrown away.
    pub fn clear(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.reset();
        }
        self.wake.notify_all();
    }

    fn run(self: Arc<Self>, headless: Arc<HeadlessMpv>, readable: Arc<ReadableAt>) {
        let mut idle_since = Instant::now();
        let mut released = true;
        loop {
            let Some(task) = self.next_task(&*readable) else {
                if !released && idle_since.elapsed() >= IDLE_RELEASE {
                    headless.release();
                    released = true;
                }
                if let Ok(state) = self.state.lock() {
                    let _ = self.wake.wait_timeout(state, Duration::from_millis(500));
                }
                continue;
            };
            released = false;
            let background = task.attempts.is_some();
            let result = headless.screenshot(
                &task.grid.preview_url,
                task.grid.time(task.index),
                task.grid.width,
            );
            self.finish(task, result);
            idle_since = Instant::now();
            if background {
                std::thread::sleep(BACKGROUND_GAP);
            }
        }
    }

    fn next_task(&self, readable: &ReadableAt) -> Option<Task> {
        let mut state = self.state.lock().ok()?;
        let grid = state.grid.clone()?;
        let readable_tile = |index: u32| {
            grid.duration > 0.0 && readable(&grid.url, grid.time(index) / grid.duration)
        };
        // A hovered tile is always tried. The readability check below estimates the byte offset
        // from the time, which a variable bitrate throws off, and a failed passive read costs only
        // a moment.
        if let Some(index) = state.hover.take() {
            if !tile_ready(&grid.path(index)) {
                return Some(Task {
                    grid,
                    index,
                    attempts: None,
                });
            }
        }
        let registered = state.registered?;
        if registered.elapsed() < BACKGROUND_DELAY || main_player_busy() {
            return None;
        }
        let now = Instant::now();
        let position = state
            .background
            .iter()
            .position(|pending| pending.not_before <= now && readable_tile(pending.index))?;
        let pending = state.background.remove(position)?;
        if tile_ready(&grid.path(pending.index)) {
            // Rendered for a hover in the meantime.
            drop(state);
            return self.next_task(readable);
        }
        Some(Task {
            grid,
            index: pending.index,
            attempts: Some(pending.attempts),
        })
    }

    fn finish(&self, task: Task, result: Result<Vec<u8>, String>) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        // The stream changed while this tile was rendering. It describes nothing on screen now.
        let current = state
            .grid
            .as_ref()
            .is_some_and(|grid| grid.same_as(&task.grid));
        if !current {
            return;
        }
        match result {
            Ok(bytes) if !bytes.is_empty() => {
                super::write_tile_atomic(&task.grid.path(task.index), &bytes);
                // Sent under the lock, like a reset, so the seek bar receives the two in order.
                if let Some(app) = &state.app {
                    emit_tile(app, &task.grid.key, task.index, &bytes);
                }
            }
            _ => {
                // A hover asks again by itself. A background tile goes to the back of the queue.
                if let Some(attempts) = task.attempts {
                    if attempts + 1 < MAX_ATTEMPTS {
                        state.background.push_back(Pending {
                            index: task.index,
                            not_before: Instant::now() + RETRY_AFTER,
                            attempts: attempts + 1,
                        });
                    }
                }
            }
        }
    }
}

fn emit_tile(app: &AppHandle, key: &str, index: u32, jpeg: &[u8]) {
    let _ = app.emit(
        "player-thumb-tile",
        TileReady {
            key: key.to_string(),
            index,
            data_url: format!("data:image/jpeg;base64,{}", super::b64(jpeg)),
        },
    );
}

/// Every index of an `n`-tile grid, ordered so that each prefix covers the whole bar as evenly as
/// possible: both ends, then the middle, then the quarters, and so on.
pub(crate) fn coarse_to_fine(n: u32) -> Vec<u32> {
    let mut order = Vec::with_capacity(n as usize);
    if n == 0 {
        return order;
    }
    order.push(0);
    if n == 1 {
        return order;
    }
    order.push(n - 1);
    let mut gaps = VecDeque::from([(0, n - 1)]);
    while let Some((low, high)) = gaps.pop_front() {
        if high - low < 2 {
            continue;
        }
        let middle = low + (high - low) / 2;
        order.push(middle);
        gaps.push_back((low, middle));
        gaps.push_back((middle, high));
    }
    order
}

/// A tile on disk that is complete (ends with the JPEG end-of-image marker).
pub(crate) fn tile_ready(path: &Path) -> bool {
    std::fs::read(path)
        .map(|bytes| bytes.len() > 2 && bytes.ends_with(&[0xFF, 0xD9]))
        .unwrap_or(false)
}

/// Delete every tile in `dir`, including any a crash left half-written.
fn clear_tiles(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_type().is_ok_and(|kind| kind.is_file()) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coarse_to_fine_covers_every_tile_once_widest_gaps_first() {
        let order = coarse_to_fine(131);
        assert_eq!(order.len(), 131);
        let mut sorted = order.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, (0..131).collect::<Vec<_>>());
        assert_eq!(&order[..5], &[0, 130, 65, 32, 97]);
        // After a handful of tiles, no point on the bar is far from one.
        let mut first = order[..10].to_vec();
        first.sort_unstable();
        let widest = first
            .windows(2)
            .map(|pair| pair[1] - pair[0])
            .max()
            .unwrap();
        assert!(widest <= 32, "widest gap {widest}");
        assert!(coarse_to_fine(0).is_empty());
        assert_eq!(coarse_to_fine(1), vec![0]);
    }

    #[test]
    fn a_replaced_grid_starts_from_an_empty_directory() {
        let dir = std::env::temp_dir().join(format!("izumi-thumbs-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("t_3.jpg"), [0xFF, 0xD8, 0xFF, 0xD9]).unwrap();
        std::fs::write(dir.join("t_4.part.jpg"), [0xFF, 0xD8]).unwrap();
        assert!(tile_ready(&dir.join("t_3.jpg")));
        clear_tiles(&dir);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        let _ = std::fs::remove_dir(&dir);
    }
}
