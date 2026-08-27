//! Non-blocking command path for the Gamescope player.
//!
//! Tauri's synchronous IPC handlers and GLib timers run on GTK's main thread.  Calling a
//! synchronous libmpv command from either path can therefore stop WebKit, controller event
//! delivery, and every controls animation while mpv waits for its VO.  This dispatcher owns a
//! separate libmpv client on one worker thread.  Producers only copy/enqueue their newest state.

#![cfg(target_os = "linux")]

use std::collections::VecDeque;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::{Arc, Condvar, Mutex};

use libmpv2::Mpv;
use libmpv2_sys as sys;

const MAX_PENDING: usize = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CoalesceKey {
    Seek,
    Bitmap(i64),
    Ass(i64),
}

enum Work {
    Control {
        name: String,
        args: Vec<String>,
    },
    BitmapAdd {
        id: i64,
        x: i64,
        y: i64,
        pixels: Vec<u8>,
        width: i64,
        height: i64,
        stride: i64,
    },
    BitmapRemove {
        id: i64,
    },
    Ass {
        id: i64,
        format: &'static str,
        data: String,
        res_x: i64,
        res_y: i64,
        z: i64,
    },
}

impl Work {
    fn coalesce_key(&self) -> Option<CoalesceKey> {
        match self {
            Self::Control { name, .. } if name == "seek" => Some(CoalesceKey::Seek),
            Self::BitmapAdd { id, .. } | Self::BitmapRemove { id } => {
                Some(CoalesceKey::Bitmap(*id))
            }
            Self::Ass { id, .. } => Some(CoalesceKey::Ass(*id)),
            _ => None,
        }
    }

    fn label(&self) -> &str {
        match self {
            Self::Control { name, .. } => name,
            Self::BitmapAdd { .. } => "overlay-add",
            Self::BitmapRemove { .. } => "overlay-remove",
            Self::Ass { .. } => "osd-overlay",
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

    #[allow(clippy::too_many_arguments)]
    pub fn bitmap_add(
        &self,
        id: i64,
        x: i64,
        y: i64,
        pixels: Vec<u8>,
        width: i64,
        height: i64,
        stride: i64,
    ) -> Result<(), String> {
        let expected = stride
            .checked_mul(height)
            .and_then(|bytes| usize::try_from(bytes).ok())
            .ok_or("invalid overlay dimensions")?;
        if width <= 0 || height <= 0 || stride < width.saturating_mul(4) || pixels.len() < expected
        {
            return Err("invalid overlay buffer".into());
        }
        self.enqueue(Work::BitmapAdd {
            id,
            x,
            y,
            pixels,
            width,
            height,
            stride,
        })
    }

    pub fn bitmap_remove(&self, id: i64) -> Result<(), String> {
        self.enqueue(Work::BitmapRemove { id })
    }

    pub fn ass(
        &self,
        id: i64,
        format: &'static str,
        data: String,
        res_x: i64,
        res_y: i64,
        z: i64,
    ) -> Result<(), String> {
        self.enqueue(Work::Ass {
            id,
            format,
            data,
            res_x,
            res_y,
            z,
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
            super::linux_embed::elog(&format!("mpv-ui-dispatch: {label}: {error}"));
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
        Work::BitmapAdd {
            id,
            x,
            y,
            pixels,
            width,
            height,
            stride,
        } => {
            // The owned Vec stays alive until mpv has synchronously copied the frame.
            let ids = id.to_string();
            let xs = x.to_string();
            let ys = y.to_string();
            let file = format!("&{}", pixels.as_ptr() as usize);
            let ws = width.to_string();
            let hs = height.to_string();
            let ss = stride.to_string();
            client
                .command(
                    "overlay-add",
                    &[&ids, &xs, &ys, &file, "0", "bgra", &ws, &hs, &ss],
                )
                .map_err(|error| error.to_string())
        }
        Work::BitmapRemove { id } => client
            .command("overlay-remove", &[&id.to_string()])
            .map_err(|error| error.to_string()),
        Work::Ass {
            id,
            format,
            data,
            res_x,
            res_y,
            z,
        } => execute_ass(client, id, format, &data, res_x, res_y, z),
    }
}

fn execute_ass(
    client: &Mpv,
    id: i64,
    format: &str,
    data: &str,
    res_x: i64,
    res_y: i64,
    z: i64,
) -> Result<(), String> {
    fn node_string(value: &CString) -> sys::mpv_node {
        sys::mpv_node {
            u: sys::mpv_node__bindgen_ty_1 {
                string: value.as_ptr() as *mut c_char,
            },
            format: sys::mpv_format_MPV_FORMAT_STRING,
        }
    }

    fn node_i64(value: i64) -> sys::mpv_node {
        sys::mpv_node {
            u: sys::mpv_node__bindgen_ty_1 { int64: value },
            format: sys::mpv_format_MPV_FORMAT_INT64,
        }
    }

    let key_names = ["name", "id", "format", "data", "res_x", "res_y", "z"];
    let keys: Vec<CString> = key_names
        .iter()
        .map(|key| CString::new(*key))
        .collect::<Result<_, _>>()
        .map_err(|error| error.to_string())?;
    let mut key_ptrs: Vec<*mut c_char> =
        keys.iter().map(|key| key.as_ptr() as *mut c_char).collect();
    let name = CString::new("osd-overlay").map_err(|error| error.to_string())?;
    let format = CString::new(format).map_err(|error| error.to_string())?;
    let data = CString::new(data).map_err(|error| error.to_string())?;
    let mut values = vec![
        node_string(&name),
        node_i64(id),
        node_string(&format),
        node_string(&data),
        node_i64(res_x),
        node_i64(res_y),
        node_i64(z),
    ];
    let mut list = sys::mpv_node_list {
        num: values.len() as i32,
        values: values.as_mut_ptr(),
        keys: key_ptrs.as_mut_ptr(),
    };
    let mut root = sys::mpv_node {
        u: sys::mpv_node__bindgen_ty_1 { list: &mut list },
        format: sys::mpv_format_MPV_FORMAT_NODE_MAP,
    };
    let code =
        unsafe { sys::mpv_command_node(client.ctx.as_ptr(), &mut root, std::ptr::null_mut()) };
    if code >= 0 {
        return Ok(());
    }
    let message = unsafe {
        let pointer = sys::mpv_error_string(code);
        if pointer.is_null() {
            format!("mpv error {code}")
        } else {
            format!(
                "mpv error {code}: {}",
                CStr::from_ptr(pointer).to_string_lossy()
            )
        }
    };
    Err(message)
}
