//! Non-blocking command path for the Linux player.
//!
//! Tauri's synchronous IPC handlers run on the main (CEF UI / GLib) thread. Calling a synchronous
//! libmpv command there can stop the page, controller event delivery, and every controls
//! animation while mpv waits for its VO. This dispatcher owns a separate libmpv client on one
//! worker thread. Producers only enqueue; a newer seek supersedes an older pending one.

#![cfg(target_os = "linux")]

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex};

use libmpv2::Mpv;

const MAX_PENDING: usize = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CoalesceKey {
    Seek,
}

enum Work {
    Control { name: String, args: Vec<String> },
}

impl Work {
    fn coalesce_key(&self) -> Option<CoalesceKey> {
        match self {
            Self::Control { name, .. } if name == "seek" => Some(CoalesceKey::Seek),
            _ => None,
        }
    }

    fn label(&self) -> &str {
        match self {
            Self::Control { name, .. } => name,
        }
    }
}
#[derive(Default)]
struct Queue {
    pending: VecDeque<Work>,
    shutdown: bool,
}

struct Shared {
    queue: Mutex<Queue>,
    wake: Condvar,
}

pub struct MpvDispatcher {
    shared: Arc<Shared>,
}

impl MpvDispatcher {
    pub fn start(mpv: &Mpv) -> Result<Self, String> {
        // `None` is intentional. libmpv2 6.0.0 builds a dangling pointer for a named client;
        // the unnamed branch passes null and lets mpv assign a safe client name.
        let client = mpv.create_client(None).map_err(|error| error.to_string())?;
        let shared = Arc::new(Shared {
            queue: Mutex::new(Queue::default()),
            wake: Condvar::new(),
        });
        let worker_shared = shared.clone();
        std::thread::Builder::new()
            .name("izumi-mpv-ui".into())
            .spawn(move || worker(client, worker_shared))
            .map_err(|error| error.to_string())?;
        Ok(Self { shared })
    }

    pub fn control(&self, name: &str, args: &[&str]) -> Result<(), String> {
        self.enqueue(Work::Control {
            name: name.to_owned(),
            args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        })
    }

    pub fn shutdown(&self) {
        if let Ok(mut queue) = self.shared.queue.lock() {
            queue.shutdown = true;
            queue.pending.clear();
            self.shared.wake.notify_one();
        }
    }

    fn enqueue(&self, work: Work) -> Result<(), String> {
        let key = work.coalesce_key();
        let mut queue = self
            .shared
            .queue
            .lock()
            .map_err(|error| error.to_string())?;
        if queue.shutdown {
            return Err("player command dispatcher stopped".into());
        }

        // A seek or overlay frame supersedes every older pending value for the same surface.
        // Remove then append (instead of replacing in-place) so its order relative to pause/menu
        // commands is the order in which the viewer actually produced it.
        if let Some(key) = key {
            queue
                .pending
                .retain(|pending| pending.coalesce_key() != Some(key));
        }

        if queue.pending.len() >= MAX_PENDING {
            // Animated surfaces are always safe to supersede. Prefer dropping one of those over
            // losing a discrete viewer command such as pause, mute, or subtitle selection.
            if let Some(index) = queue
                .pending
                .iter()
                .position(|pending| pending.coalesce_key().is_some())
            {
                queue.pending.remove(index);
            } else {
                return Err("player command queue full".into());
            }
        }
        queue.pending.push_back(work);
        self.shared.wake.notify_one();
        Ok(())
    }
}

fn worker(client: Mpv, shared: Arc<Shared>) {
    loop {
        let work = {
            let mut queue = match shared.queue.lock() {
                Ok(queue) => queue,
                Err(_) => return,
            };
            while queue.pending.is_empty() && !queue.shutdown {
                queue = match shared.wake.wait(queue) {
                    Ok(queue) => queue,
                    Err(_) => return,
                };
            }
            if queue.shutdown {
                return;
            }
            queue.pending.pop_front()
        };
        let Some(work) = work else { continue };
        let label = work.label().to_owned();
        if let Err(error) = execute(&client, work) {
            super::linux_cef::elog(&format!("mpv-ui-dispatch: {label}: {error}"));
        }
    }
}

fn execute(client: &Mpv, work: Work) -> Result<(), String> {
    match work {
        Work::Control { name, args } => {
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            // Some demuxers transiently reset subtitle renderer state while flushing an exact
            // seek. Preserve the selected track and visibility just like PlayerHandle::command.
            let subtitle_state = if name == "seek" {
                Some((
                    client.get_property::<String>("sid").ok(),
                    client.get_property::<bool>("sub-visibility").ok(),
                ))
            } else {
                None
            };
            client
                .command(&name, &refs)
                .map_err(|error| error.to_string())?;
            if let Some((sid, visible)) = subtitle_state {
                if let Some(sid) = sid {
                    let _ = client.set_property("sid", sid.as_str());
                }
                if let Some(visible) = visible {
                    let _ = client.set_property("sub-visibility", visible);
                }
            }
            Ok(())
        }
    }
}
