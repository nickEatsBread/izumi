//! Warm scrub-thumbnail decoder — a SECOND libmpv core using mpv's **software render
//! API** (`MPV_RENDER_API_TYPE_SW`). This is the proper, ffmpeg-free, window-less way to
//! get frames out of mpv: the core runs with `vo=libmpv`, and for each tile we seek then
//! `mpv_render_context_render()` the current frame straight into a CPU buffer AT
//! THUMBNAIL SIZE (mpv does the colour-convert + downscale), which we encode to JPEG.
//! One warm decoder on one connection — thumbfast's model, but fully in-process.
//!
//! The safe libmpv2 `RenderContext` wrapper only supports OpenGL, so this is built on
//! raw `libmpv2-sys` FFI. All raw pointers live on the single worker thread (created,
//! used, and freed there) — never sent across threads.
//!
//! SECURITY: the stream URL carries the debrid secret. The core is created with
//! `terminal=no` + `msg-level=all=no`, and the URL is never logged here.

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use libmpv2_sys as sys;

const API_TYPE: sys::mpv_render_param_type = sys::mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE;
const SW_SIZE: sys::mpv_render_param_type = sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_SIZE;
const SW_FORMAT: sys::mpv_render_param_type = sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_FORMAT;
const SW_STRIDE: sys::mpv_render_param_type = sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_STRIDE;
const SW_POINTER: sys::mpv_render_param_type =
    sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_POINTER;
/// A keyframe seek lands on the keyframe at or before the target. Long-GOP encodes space them
/// several seconds apart; a position further off than this means the seek never happened.
const KEYFRAME_SLACK_S: f64 = 30.0;

enum Msg {
    Shot {
        url: String,
        time: f64,
        width: i32,
        resp: Sender<Result<Vec<u8>, String>>,
    },
    /// Close the stream but keep the core warm. An open direct-torrent stream keeps its pieces
    /// prioritized over whatever the player needs next.
    Release,
    Stop,
}

/// Handle to the headless thumbnail decoder. Holds only the worker's channel (Send).
pub struct HeadlessMpv {
    tx: Mutex<Option<Sender<Msg>>>,
}

impl Default for HeadlessMpv {
    fn default() -> Self {
        Self::new()
    }
}

/// The mpv/libmpv version string (e.g. "mpv 0.38.0-…") for the About page. Spins a
/// throwaway core (no window/file, quiet) to read the `mpv-version` property; falls
/// back to the client API version.
pub fn version() -> String {
    unsafe {
        let mpv = sys::mpv_create();
        if !mpv.is_null() {
            set_opt(mpv, b"terminal\0", b"no\0");
            set_opt(mpv, b"msg-level\0", b"all=no\0");
            let _ = sys::mpv_initialize(mpv);
            let p = sys::mpv_get_property_string(mpv, b"mpv-version\0".as_ptr() as *const c_char);
            let s = if p.is_null() {
                None
            } else {
                let v = CStr::from_ptr(p).to_str().ok().map(str::to_owned);
                sys::mpv_free(p as *mut c_void);
                v
            };
            sys::mpv_terminate_destroy(mpv);
            if let Some(s) = s.filter(|s| !s.is_empty()) {
                return s;
            }
        }
        let v = sys::mpv_client_api_version();
        format!("libmpv {}.{}", (v >> 16) & 0xffff, v & 0xffff)
    }
}

impl HeadlessMpv {
    pub fn new() -> Self {
        HeadlessMpv {
            tx: Mutex::new(None),
        }
    }

    fn ensure(&self) -> Result<Sender<Msg>, String> {
        let mut g = self.tx.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = g.as_ref() {
            return Ok(tx.clone());
        }
        let (tx, rx) = channel::<Msg>();
        std::thread::Builder::new()
            .name("izumi-thumbs".into())
            .spawn(move || worker(rx))
            .map_err(|e| e.to_string())?;
        *g = Some(tx.clone());
        Ok(tx)
    }

    /// Produce a JPEG thumbnail `width` pixels wide for `url` at `time` seconds. Loads the stream
    /// into the warm core on first use (or when it changes), then seeks + renders. Bounded.
    pub fn screenshot(&self, url: &str, time: f64, width: i32) -> Result<Vec<u8>, String> {
        let tx = self.ensure()?;
        let (rtx, rrx) = channel();
        tx.send(Msg::Shot {
            url: url.to_string(),
            time,
            width,
            resp: rtx,
        })
        .map_err(|_| "headless thread gone".to_string())?;
        // Exceed grab()'s worst-case internal budget (~12s open + 6s seek + 3s render ≈ 21s) so a
        // slow cold stream can't trip a spurious caller timeout that releases the concurrency-1
        // guard while the worker is still busy (which would queue a second grab behind it).
        rrx.recv_timeout(Duration::from_secs(25))
            .map_err(|_| "headless timeout".to_string())?
    }

    /// Close the open stream, if any. The next screenshot reopens it.
    pub fn release(&self) {
        if let Ok(g) = self.tx.lock() {
            if let Some(tx) = g.as_ref() {
                let _ = tx.send(Msg::Release);
            }
        }
    }

    pub fn stop(&self) {
        if let Ok(mut g) = self.tx.lock() {
            if let Some(tx) = g.take() {
                let _ = tx.send(Msg::Stop);
            }
        }
    }
}

/// The raw mpv core + SW render context. Lives only on the worker thread.
struct Core {
    mpv: *mut sys::mpv_handle,
    rctx: *mut sys::mpv_render_context,
    cur_url: String,
}

impl Drop for Core {
    fn drop(&mut self) {
        unsafe {
            if !self.rctx.is_null() {
                sys::mpv_render_context_free(self.rctx);
            }
            if !self.mpv.is_null() {
                sys::mpv_terminate_destroy(self.mpv);
            }
        }
    }
}

fn worker(rx: Receiver<Msg>) {
    let mut core = match create_core() {
        Ok(c) => c,
        Err(_) => {
            // Init failed — reply to every request so callers don't hang.
            for msg in rx.iter() {
                match msg {
                    Msg::Shot { resp, .. } => {
                        let _ = resp.send(Err("headless init failed".into()));
                    }
                    Msg::Release => {}
                    Msg::Stop => break,
                }
            }
            return;
        }
    };
    for msg in rx.iter() {
        match msg {
            Msg::Shot {
                url,
                time,
                width,
                resp,
            } => {
                let result = grab(&mut core, &url, time, width);
                // A read that fails ends the file (mpv treats it as the end of the stream), so
                // the next request must open it again.
                if result.is_err() {
                    release_stream(&mut core);
                }
                let _ = resp.send(result);
            }
            Msg::Release => release_stream(&mut core),
            Msg::Stop => break,
        }
    }
    // `core` drops here → frees the render context and the mpv core.
}

unsafe fn set_opt(mpv: *mut sys::mpv_handle, name: &[u8], val: &[u8]) {
    sys::mpv_set_option_string(
        mpv,
        name.as_ptr() as *const c_char,
        val.as_ptr() as *const c_char,
    );
}

fn create_core() -> Result<Core, String> {
    unsafe {
        let mpv = sys::mpv_create();
        if mpv.is_null() {
            return Err("mpv_create failed".into());
        }
        // The render API requires vo=libmpv (it IS the output). No audio/subs, software
        // decode (SW render is CPU anyway), quiet, seekable network cache.
        set_opt(mpv, b"vo\0", b"libmpv\0");
        set_opt(mpv, b"ao\0", b"null\0");
        set_opt(mpv, b"aid\0", b"no\0");
        set_opt(mpv, b"sid\0", b"no\0");
        set_opt(mpv, b"hwdec\0", b"no\0");
        set_opt(mpv, b"terminal\0", b"no\0");
        set_opt(mpv, b"msg-level\0", b"all=no\0");
        set_opt(mpv, b"pause\0", b"yes\0");
        set_opt(mpv, b"keepaspect\0", b"yes\0");
        set_opt(mpv, b"video-timing-offset\0", b"0\0"); // don't pace to display rate
        set_opt(mpv, b"cache\0", b"yes\0");
        set_opt(mpv, b"force-seekable\0", b"yes\0");
        // `grab()` seeks to one keyframe and renders a single small frame; it never plays
        // forward, so every byte of read-ahead is fetched and thrown away. mpv bounds read-ahead by
        // `cache-secs` (default 10), NOT by `demuxer-max-bytes` — so the byte cap alone was doing
        // almost nothing and each tile pulled seconds of stream. That bandwidth is contended with
        // the MAIN player streaming the same debrid link, which is what makes skimming rebuffer
        // playback on Deck WiFi. Keep force-seekable; seeks are the whole job here.
        set_opt(mpv, b"cache-secs\0", b"1\0");
        set_opt(mpv, b"demuxer-max-back-bytes\0", b"0\0");
        set_opt(mpv, b"demuxer-max-bytes\0", b"16777216\0");
        set_opt(mpv, b"demuxer-lavf-probesize\0", b"2097152\0");
        set_opt(mpv, b"demuxer-lavf-analyzeduration\0", b"1\0");
        set_opt(mpv, b"network-timeout\0", b"30\0");
        set_opt(
            mpv,
            b"stream-lavf-o\0",
            b"reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=5\0",
        );
        if sys::mpv_initialize(mpv) < 0 {
            sys::mpv_terminate_destroy(mpv);
            return Err("mpv_initialize failed".into());
        }
        // Create the software render context.
        let mut params = [
            sys::mpv_render_param {
                type_: API_TYPE,
                data: b"sw\0".as_ptr() as *mut c_void,
            },
            sys::mpv_render_param {
                type_: 0,
                data: std::ptr::null_mut(),
            },
        ];
        let mut rctx: *mut sys::mpv_render_context = std::ptr::null_mut();
        let err = sys::mpv_render_context_create(&mut rctx, mpv, params.as_mut_ptr());
        if err < 0 || rctx.is_null() {
            sys::mpv_terminate_destroy(mpv);
            return Err("render context create failed".into());
        }
        Ok(Core {
            mpv,
            rctx,
            cur_url: String::new(),
        })
    }
}

fn release_stream(core: &mut Core) {
    if core.cur_url.is_empty() {
        return;
    }
    unsafe {
        let mut cmd = [b"stop\0".as_ptr() as *const c_char, std::ptr::null()];
        sys::mpv_command(core.mpv, cmd.as_mut_ptr());
    }
    core.cur_url.clear();
}

const EVENT_NONE: sys::mpv_event_id = sys::mpv_event_id_MPV_EVENT_NONE;
const EVENT_END_FILE: sys::mpv_event_id = sys::mpv_event_id_MPV_EVENT_END_FILE;
const EVENT_FILE_LOADED: sys::mpv_event_id = sys::mpv_event_id_MPV_EVENT_FILE_LOADED;
const EVENT_PLAYBACK_RESTART: sys::mpv_event_id = sys::mpv_event_id_MPV_EVENT_PLAYBACK_RESTART;

/// Discard events left over from earlier work, so a wait below only sees what follows.
unsafe fn drain_events(mpv: *mut sys::mpv_handle) {
    while (*sys::mpv_wait_event(mpv, 0.0)).event_id != EVENT_NONE {}
}

/// Wait for `wanted`. A file that ends for any reason other than being replaced could not be read:
/// a direct-torrent preview that reaches a piece not downloaded yet ends that way at once.
unsafe fn wait_for(
    mpv: *mut sys::mpv_handle,
    wanted: sys::mpv_event_id,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err("timed out".into());
        }
        let event = &*sys::mpv_wait_event(mpv, left.as_secs_f64());
        if event.event_id == wanted {
            return Ok(());
        }
        if event.event_id == EVENT_END_FILE {
            let reason = (event.data as *const sys::mpv_event_end_file)
                .as_ref()
                .map(|end| end.reason);
            if reason != Some(sys::mpv_end_file_reason_MPV_END_FILE_REASON_STOP) {
                return Err("the stream ended".into());
            }
        }
    }
}

fn grab(core: &mut Core, url: &str, time: f64, width: i32) -> Result<Vec<u8>, String> {
    unsafe {
        // (Re)load the stream if it changed. Waiting for mpv's own events rather than polling
        // properties matters here: right after a `stop`, the previous file's duration can still
        // be read, and a seek sent then lands between two files.
        if core.cur_url != url {
            drain_events(core.mpv);
            let curl = CString::new(url).map_err(|_| "bad url")?;
            let mut cmd = [
                b"loadfile\0".as_ptr() as *const c_char,
                curl.as_ptr(),
                std::ptr::null(),
            ];
            if sys::mpv_command(core.mpv, cmd.as_mut_ptr()) < 0 {
                return Err("loadfile failed".into());
            }
            // Headers and index read, then the first frame decoded.
            wait_for(core.mpv, EVENT_FILE_LOADED, Duration::from_secs(12))?;
            wait_for(core.mpv, EVENT_PLAYBACK_RESTART, Duration::from_secs(6))?;
            core.cur_url = url.to_string();
        }
        // Seek to the target keyframe (one range fetch).
        drain_events(core.mpv);
        let ts = CString::new(format!("{time}")).map_err(|_| "bad time")?;
        let mut seek = [
            b"seek\0".as_ptr() as *const c_char,
            ts.as_ptr(),
            b"absolute+keyframes\0".as_ptr() as *const c_char,
            std::ptr::null(),
        ];
        if sys::mpv_command(core.mpv, seek.as_mut_ptr()) < 0 {
            return Err("seek failed".into());
        }
        // mpv announces the end of a seek once the frame at the new position has been shown.
        // Rendering any earlier would store whatever frame the core still holds, often black, as
        // this position's tile for as long as the stream plays. The render API's new-frame flag
        // is no signal here: mpv only holds a frame for it briefly before showing it anyway, so on
        // a slow stream the flag is already gone. The frame shown is the one rendered below.
        wait_for(core.mpv, EVENT_PLAYBACK_RESTART, Duration::from_secs(6))?;
        match get_double(core.mpv, b"time-pos\0") {
            Some(landed) if landed <= time + 2.0 && landed >= time - KEYFRAME_SLACK_S => {}
            _ => return Err("the seek landed elsewhere".into()),
        }
        sys::mpv_render_context_update(core.rctx);
        // Height from the video's display aspect (fallback 16:9).
        let (dw, dh) = (
            get_double(core.mpv, b"dwidth\0"),
            get_double(core.mpv, b"dheight\0"),
        );
        let h = match (dw, dh) {
            (Some(w), Some(h)) if w > 0.0 && h > 0.0 => {
                ((width as f64 * h / w).round() as i32).clamp(60, 800)
            }
            _ => width * 9 / 16,
        };
        render_sw(core.rctx, width, h)
    }
}

unsafe fn render_sw(rctx: *mut sys::mpv_render_context, w: i32, h: i32) -> Result<Vec<u8>, String> {
    let stride: usize = (w as usize) * 4;
    let mut size: [c_int; 2] = [w, h];
    let mut stride_v: usize = stride;
    let mut buf = vec![0u8; stride * h as usize];
    let mut params = [
        sys::mpv_render_param {
            type_: SW_SIZE,
            data: size.as_mut_ptr() as *mut c_void,
        },
        sys::mpv_render_param {
            type_: SW_FORMAT,
            data: b"rgb0\0".as_ptr() as *mut c_void,
        },
        sys::mpv_render_param {
            type_: SW_STRIDE,
            data: &mut stride_v as *mut usize as *mut c_void,
        },
        sys::mpv_render_param {
            type_: SW_POINTER,
            data: buf.as_mut_ptr() as *mut c_void,
        },
        sys::mpv_render_param {
            type_: 0,
            data: std::ptr::null_mut(),
        },
    ];
    if sys::mpv_render_context_render(rctx, params.as_mut_ptr()) < 0 {
        return Err("render failed".into());
    }
    encode_jpeg(&buf, w as u32, h as u32, stride)
}

/// Read a numeric mpv property (via string) — None on error/absence.
unsafe fn get_double(mpv: *mut sys::mpv_handle, name: &[u8]) -> Option<f64> {
    let p = sys::mpv_get_property_string(mpv, name.as_ptr() as *const c_char);
    if p.is_null() {
        return None;
    }
    let s = CStr::from_ptr(p).to_str().ok().map(str::to_owned);
    sys::mpv_free(p as *mut c_void);
    s.and_then(|s| s.parse::<f64>().ok())
}

/// Pack the `rgb0` (4 bytes/px, honoring `stride`) buffer to RGB and encode a JPEG.
fn encode_jpeg(buf: &[u8], w: u32, h: u32, stride: usize) -> Result<Vec<u8>, String> {
    use image::codecs::jpeg::JpegEncoder;
    use image::{ExtendedColorType, ImageEncoder};
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for y in 0..h as usize {
        let base = y * stride;
        for x in 0..w as usize {
            let p = base + x * 4;
            rgb.push(buf[p]);
            rgb.push(buf[p + 1]);
            rgb.push(buf[p + 2]);
        }
    }
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, 82)
        .write_image(&rgb, w, h, ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    Ok(out)
}
