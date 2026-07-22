//! Warm scrub-thumbnail decoder — a SECOND libmpv core using mpv's **software render
//! API** (`MPV_RENDER_API_TYPE_SW`). This is the proper, ffmpeg-free, window-less way to
//! get frames out of mpv: the core runs with `vo=libmpv`, and each hover we seek then
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
const SW_POINTER: sys::mpv_render_param_type = sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_POINTER;
const UPDATE_FRAME: u64 = sys::mpv_render_update_flag_MPV_RENDER_UPDATE_FRAME as u64;
const TILE_W: i32 = 240;

enum Msg {
    Shot { url: String, time: f64, resp: Sender<Result<Vec<u8>, String>> },
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
        HeadlessMpv { tx: Mutex::new(None) }
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

    /// Produce a JPEG thumbnail for `url` at `time` seconds. Loads the stream into the
    /// warm core on first use (or when it changes), then seeks + renders. Bounded.
    pub fn screenshot(&self, url: &str, time: f64) -> Result<Vec<u8>, String> {
        let tx = self.ensure()?;
        let (rtx, rrx) = channel();
        tx.send(Msg::Shot { url: url.to_string(), time, resp: rtx })
            .map_err(|_| "headless thread gone".to_string())?;
        // Exceed grab()'s worst-case internal budget (~12s open + 6s seek + 3s render ≈ 21s) so a
        // slow cold stream can't trip a spurious caller timeout that releases the concurrency-1
        // guard while the worker is still busy (which would queue a second grab behind it).
        rrx.recv_timeout(Duration::from_secs(25))
            .map_err(|_| "headless timeout".to_string())?
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
                    Msg::Shot { resp, .. } => { let _ = resp.send(Err("headless init failed".into())); }
                    Msg::Stop => break,
                }
            }
            return;
        }
    };
    for msg in rx.iter() {
        match msg {
            Msg::Shot { url, time, resp } => { let _ = resp.send(grab(&mut core, &url, time)); }
            Msg::Stop => break,
        }
    }
    // `core` drops here → frees the render context and the mpv core.
}

unsafe fn set_opt(mpv: *mut sys::mpv_handle, name: &[u8], val: &[u8]) {
    sys::mpv_set_option_string(mpv, name.as_ptr() as *const c_char, val.as_ptr() as *const c_char);
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
        set_opt(mpv, b"demuxer-max-bytes\0", b"67108864\0");
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
            sys::mpv_render_param { type_: API_TYPE, data: b"sw\0".as_ptr() as *mut c_void },
            sys::mpv_render_param { type_: 0, data: std::ptr::null_mut() },
        ];
        let mut rctx: *mut sys::mpv_render_context = std::ptr::null_mut();
        let err = sys::mpv_render_context_create(&mut rctx, mpv, params.as_mut_ptr());
        if err < 0 || rctx.is_null() {
            sys::mpv_terminate_destroy(mpv);
            return Err("render context create failed".into());
        }
        Ok(Core { mpv, rctx, cur_url: String::new() })
    }
}

fn grab(core: &mut Core, url: &str, time: f64) -> Result<Vec<u8>, String> {
    unsafe {
        // (Re)load the stream if it changed, then wait for it to become seekable.
        if core.cur_url != url {
            let curl = CString::new(url).map_err(|_| "bad url")?;
            let mut cmd = [b"loadfile\0".as_ptr() as *const c_char, curl.as_ptr(), std::ptr::null()];
            if sys::mpv_command(core.mpv, cmd.as_mut_ptr()) < 0 {
                return Err("loadfile failed".into());
            }
            let start = Instant::now();
            while get_double(core.mpv, b"duration\0").map(|d| d > 0.0) != Some(true) {
                if start.elapsed() > Duration::from_secs(12) {
                    // Stream never opened. Leave cur_url UNCHANGED so the next request for the same
                    // url re-issues loadfile and retries — if we'd already recorded it, that request
                    // would skip the load and render a stale/blank frame of the PREVIOUS stream,
                    // which then gets JPEG-encoded and disk-cached as a valid "ready" tile forever.
                    return Err("stream did not open".into());
                }
                std::thread::sleep(Duration::from_millis(30));
            }
            // Only record the url once duration > 0 confirms the file actually opened.
            core.cur_url = url.to_string();
        }
        // Seek to the target keyframe (one range fetch).
        let ts = CString::new(format!("{time}")).map_err(|_| "bad time")?;
        let mut seek = [
            b"seek\0".as_ptr() as *const c_char,
            ts.as_ptr(),
            b"absolute+keyframes\0".as_ptr() as *const c_char,
            std::ptr::null(),
        ];
        sys::mpv_command(core.mpv, seek.as_mut_ptr());
        // Wait for the seek to settle, then for a fresh frame to be ready to render.
        let start = Instant::now();
        while get_flag(core.mpv, b"seeking\0") {
            if start.elapsed() > Duration::from_secs(6) { break; }
            std::thread::sleep(Duration::from_millis(15));
        }
        let start = Instant::now();
        while sys::mpv_render_context_update(core.rctx) & UPDATE_FRAME == 0 {
            if start.elapsed() > Duration::from_secs(3) { break; }
            std::thread::sleep(Duration::from_millis(15));
        }
        // Target size: 240px wide, height from the video's display aspect (fallback 16:9).
        let (dw, dh) = (get_double(core.mpv, b"dwidth\0"), get_double(core.mpv, b"dheight\0"));
        let h = match (dw, dh) {
            (Some(w), Some(h)) if w > 0.0 && h > 0.0 => ((TILE_W as f64 * h / w).round() as i32).clamp(60, 400),
            _ => 135,
        };
        render_sw(core.rctx, TILE_W, h)
    }
}

unsafe fn render_sw(rctx: *mut sys::mpv_render_context, w: i32, h: i32) -> Result<Vec<u8>, String> {
    let stride: usize = (w as usize) * 4;
    let mut size: [c_int; 2] = [w, h];
    let mut stride_v: usize = stride;
    let mut buf = vec![0u8; stride * h as usize];
    let mut params = [
        sys::mpv_render_param { type_: SW_SIZE, data: size.as_mut_ptr() as *mut c_void },
        sys::mpv_render_param { type_: SW_FORMAT, data: b"rgb0\0".as_ptr() as *mut c_void },
        sys::mpv_render_param { type_: SW_STRIDE, data: &mut stride_v as *mut usize as *mut c_void },
        sys::mpv_render_param { type_: SW_POINTER, data: buf.as_mut_ptr() as *mut c_void },
        sys::mpv_render_param { type_: 0, data: std::ptr::null_mut() },
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

/// Read a yes/no mpv flag property.
unsafe fn get_flag(mpv: *mut sys::mpv_handle, name: &[u8]) -> bool {
    let p = sys::mpv_get_property_string(mpv, name.as_ptr() as *const c_char);
    if p.is_null() {
        return false;
    }
    let yes = CStr::from_ptr(p).to_bytes() == b"yes";
    sys::mpv_free(p as *mut c_void);
    yes
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
