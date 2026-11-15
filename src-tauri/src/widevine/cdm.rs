//! The Widevine module lives on ONE process-wide thread: the C++ host is single-threaded by design,
//! like Chromium's and Firefox's CDM hosts. That thread is seccomp-filtered before the module is
//! loaded and does nothing but call the module: licence requests and responses travel as bytes to and
//! from the async runtime, which does the HTTP. Each playback opens its own CDM instance on it.
use anyhow::{anyhow, bail, Result};
use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::Path;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use super::fmp4::Sample;

// The CDM host boundary. On Linux it is the C++ shim (native/widevine/host.cc), linked by build.rs
// and called through this extern block. On Windows the same C ABI is a pure-Rust host in the crate
// (host_win.rs), so there `WvCallbacks`/`WvHost` and the wv_* functions are imported from it; the
// rest of this file is identical either way.
#[cfg(target_os = "linux")]
#[repr(C)]
struct WvCallbacks {
    user: *mut c_void,
    on_message: Option<extern "C" fn(*mut c_void, *const c_char, u32, u32, *const u8, u32)>,
    on_key_status: Option<extern "C" fn(*mut c_void, *const u8, u32, u32)>,
    on_log: Option<extern "C" fn(*mut c_void, *const c_char)>,
}

#[cfg(target_os = "linux")]
enum WvHost {}

#[cfg(target_os = "linux")]
extern "C" {
    fn wv_module_load(path: *const c_char, err: *mut c_char, err_len: usize) -> i32;
    fn wv_module_version() -> *const c_char;
    fn wv_host_open(iface: i32, cb: *const WvCallbacks, err: *mut c_char, err_len: usize) -> *mut WvHost;
    fn wv_host_interface(h: *const WvHost) -> i32;
    fn wv_host_tick(h: *mut WvHost);
    fn wv_set_server_certificate(h: *mut WvHost, cert: *const u8, len: u32) -> i32;
    fn wv_session_create(h: *mut WvHost, init: *const u8, len: u32, sid: *mut c_char, cap: u32) -> i32;
    fn wv_session_update(h: *mut WvHost, sid: *const c_char, resp: *const u8, len: u32) -> i32;
    fn wv_session_close(h: *mut WvHost, sid: *const c_char) -> i32;
    fn wv_decrypt(h: *mut WvHost, kid: *const u8, kid_len: u32, iv: *const u8, iv_len: u32, subs: *const u32, pairs: u32, data: *mut u8, len: u32) -> i32;
    fn wv_video_init(h: *mut WvHost, profile: u32, w: i32, ht: i32, extra: *const u8, extra_len: u32) -> i32;
    #[allow(clippy::too_many_arguments)]
    fn wv_video_decode(
        h: *mut WvHost, kid: *const u8, kid_len: u32, iv: *const u8, iv_len: u32, subs: *const u32, pairs: u32,
        data: *const u8, len: u32, ts: i64, out: *mut u8, out_cap: u32, out_w: *mut i32, out_h: *mut i32, out_ts: *mut i64,
    ) -> i32;
    fn wv_video_reset(h: *mut WvHost);
    fn wv_host_close(h: *mut WvHost);
}

#[cfg(target_os = "windows")]
use super::host_win::{
    wv_decrypt, wv_host_close, wv_host_interface, wv_host_open, wv_host_tick, wv_module_load, wv_module_version, wv_session_close, wv_session_create,
    wv_session_update, wv_set_server_certificate, wv_video_decode, wv_video_init, wv_video_reset, WvCallbacks, WvHost,
};

/// cdm::Status kNoKey: the module will not release this sample's clear bytes.
pub const STATUS_NO_KEY: i32 = 2;

/// A decrypt the module refused (as opposed to a malformed sample).
#[derive(Debug)]
pub struct Refused(pub i32);
impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "the Widevine module refused to decrypt this sample (status {})", self.0)
    }
}
impl std::error::Error for Refused {}

/// One decoded picture's presentation timestamp (microseconds) and size; the tightly packed I420
/// bytes are in the buffer handed back with it. Video decode is the Linux streaming path only.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub struct Picture {
    pub ts_us: i64,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Default, Clone)]
pub struct KeyReport {
    pub usable: u32,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub total: u32,
    /// Distinct non-usable statuses seen (e.g. 3 output restricted).
    pub other: Vec<u32>,
    /// The 16-byte content KIDs the licence marked usable. A stream can carry several (Crunchyroll
    /// returns one per rung); a fragment whose tenc KID is not among them is decrypted with one of
    /// these instead, which is how the content key is actually selected.
    pub usable_kids: Vec<[u8; 16]>,
}

/// Messages the module sends after the licence (renewals) for the playback session to forward.
pub type Renewals = tokio::sync::mpsc::UnboundedSender<Vec<u8>>;

#[derive(Default)]
struct Callbacks {
    request: Option<Vec<u8>>,
    unhandled: Vec<u32>,
    /// (status, key_id) for each key the licence reported; status 0 is usable.
    keys: Vec<(u32, [u8; 16])>,
    renewals: Option<Renewals>,
}

extern "C" fn on_message(user: *mut c_void, _: *const c_char, _: u32, kind: u32, msg: *const u8, len: u32) {
    // SAFETY: `user` is the Box<Callbacks> owned by this instance, only touched on the CDM thread.
    let state = unsafe { &mut *(user as *mut Callbacks) };
    let bytes = unsafe { std::slice::from_raw_parts(msg, len as usize) }.to_vec();
    match kind {
        0 if state.request.is_none() => state.request = Some(bytes),
        1 => match &state.renewals {
            Some(tx) => {
                let _ = tx.send(bytes);
            }
            None => state.unhandled.push(kind),
        },
        _ => state.unhandled.push(kind),
    }
}
extern "C" fn on_key(user: *mut c_void, key_id: *const u8, key_id_len: u32, status: u32) {
    // SAFETY: as in on_message.
    let state = unsafe { &mut *(user as *mut Callbacks) };
    let mut kid = [0u8; 16];
    if !key_id.is_null() && key_id_len as usize >= 16 {
        // SAFETY: the module gives a valid key_id pointer of key_id_len bytes.
        kid.copy_from_slice(unsafe { std::slice::from_raw_parts(key_id, 16) });
    }
    state.keys.push((status, kid));
}
extern "C" fn on_log(_: *mut c_void, line: *const c_char) {
    eprintln!("[widevine] {}", unsafe { CStr::from_ptr(line) }.to_string_lossy());
}

struct Instance {
    host: *mut WvHost,
    session: Option<CString>,
    callbacks: Box<Callbacks>,
}

type Reply<T> = mpsc::Sender<Result<T>>;

// The video-decode jobs (and their Cdm methods) are built only by the Linux streaming path.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
enum Job {
    Load { library: String, reply: Reply<String> },
    Open { interface: i32, renewals: Renewals, reply: Reply<u64> },
    SetCertificate { id: u64, certificate: Vec<u8>, reply: Reply<()> },
    Request { id: u64, init_data: Vec<u8>, reply: Reply<Vec<u8>> },
    Update { id: u64, response: Vec<u8>, reply: Reply<KeyReport> },
    Decrypt { id: u64, data: Vec<u8>, kids: Vec<[u8; 16]>, samples: Vec<Sample>, reply: mpsc::Sender<(Vec<u8>, Result<()>)> },
    VideoInit { id: u64, profile: u32, width: i32, height: i32, avcc: Vec<u8>, reply: Reply<()> },
    VideoDecode { id: u64, kid: [u8; 16], iv: Vec<u8>, subsamples: Vec<(u32, u32)>, data: Option<Vec<u8>>, ts_us: i64, out: Vec<u8>, reply: mpsc::Sender<(Vec<u8>, Result<Option<Picture>>)> },
    VideoReset { id: u64, reply: Reply<()> },
    Close { id: u64 },
}

/// The module runs on dedicated threads ("lanes"). Lane 0 is the default (and the only one the Linux
/// streaming player uses). A save opens its audio and video instances on separate lanes so their
/// module work — the scarce, serial-per-instance resource — runs in parallel instead of back-to-back.
/// Each lane is an independent CDM-host thread; the module (loaded once, process-wide) tolerates
/// several concurrent instances the way a browser runs its audio and video decoders at once.
///
/// Lanes are created lazily on first use, so a one-instance playback still starts exactly one thread.
/// The count is capped (so a small device is not thrashed) and overridable with IZUMI_WIDEVINE_LANES.
pub fn max_lanes() -> usize {
    std::env::var("IZUMI_WIDEVINE_LANES").ok().and_then(|v| v.parse().ok()).filter(|n| *n >= 1).unwrap_or(5).min(8)
}

fn lanes() -> &'static Mutex<Vec<mpsc::Sender<Job>>> {
    static LANES: OnceLock<Mutex<Vec<mpsc::Sender<Job>>>> = OnceLock::new();
    LANES.get_or_init(|| Mutex::new(Vec::new()))
}

/// The sender for `lane`, starting its thread the first time the lane is used.
fn lane_sender(lane: usize) -> Result<mpsc::Sender<Job>> {
    let mut all = lanes().lock().map_err(|_| anyhow!("Widevine lanes poisoned"))?;
    while all.len() <= lane {
        let n = all.len();
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name(format!("widevine-{n}"))
            .spawn(move || run(rx))
            .map_err(|e| anyhow!("could not start the Widevine thread: {e}"))?;
        all.push(tx);
    }
    Ok(all[lane].clone())
}

fn send_on<T>(lane: usize, make: impl FnOnce(mpsc::Sender<T>) -> Job) -> Result<T> {
    let (tx, rx) = mpsc::channel();
    lane_sender(lane)?.send(make(tx)).map_err(|_| anyhow!("Widevine thread gone"))?;
    rx.recv().map_err(|_| anyhow!("Widevine thread gone"))
}

/// Lane 0: the default lane, used for module load and single-instance playback.
fn send<T>(make: impl FnOnce(mpsc::Sender<T>) -> Job) -> Result<T> {
    send_on(0, make)
}

fn instance(map: &mut HashMap<u64, Instance>, id: u64) -> Result<&mut Instance> {
    map.get_mut(&id).ok_or_else(|| anyhow!("CDM instance closed"))
}

fn run(rx: mpsc::Receiver<Job>) {
    match super::seccomp::confine_current_thread() {
        Ok(mode) => eprintln!("[widevine] module thread sandbox: {mode}"),
        Err(e) => eprintln!("[widevine] module thread sandbox unavailable: {e}"),
    }
    let mut instances: HashMap<u64, Instance> = HashMap::new();
    let mut next_id = 1u64;
    loop {
        // With no instance open there are no module timers to fire: sleep until the next job.
        let tick_ms: u64 = std::env::var("IZUMI_WIDEVINE_TICK_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(50);
        let next = if instances.is_empty() {
            rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected)
        } else {
            rx.recv_timeout(Duration::from_millis(tick_ms))
        };
        let job = match next {
            Ok(job) => job,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                for i in instances.values() {
                    // SAFETY: the host pointer is valid until Close removes the instance.
                    unsafe { wv_host_tick(i.host) };
                }
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        match job {
            Job::Load { library, reply } => {
                let result = (|| {
                    let path = CString::new(library)?;
                    let mut err = [0 as c_char; 256];
                    // SAFETY: valid C strings and an error buffer of the stated size.
                    if unsafe { wv_module_load(path.as_ptr(), err.as_mut_ptr(), err.len()) } != 0 {
                        bail!("{}", unsafe { CStr::from_ptr(err.as_ptr()) }.to_string_lossy());
                    }
                    Ok(unsafe { CStr::from_ptr(wv_module_version()) }.to_string_lossy().into_owned())
                })();
                let _ = reply.send(result);
            }
            Job::Open { interface, renewals, reply } => {
                let mut callbacks = Box::new(Callbacks { renewals: Some(renewals), ..Callbacks::default() });
                let cb = WvCallbacks {
                    user: &mut *callbacks as *mut Callbacks as *mut c_void,
                    on_message: Some(on_message),
                    on_key_status: Some(on_key),
                    on_log: Some(on_log),
                };
                let mut err = [0 as c_char; 256];
                // SAFETY: `cb` points at `callbacks`, which lives in the instance as long as the host.
                let host = unsafe { wv_host_open(interface, &cb, err.as_mut_ptr(), err.len()) };
                let result = if host.is_null() {
                    Err(anyhow!("{}", unsafe { CStr::from_ptr(err.as_ptr()) }.to_string_lossy()))
                } else {
                    let id = next_id;
                    next_id += 1;
                    eprintln!("[widevine] instance {id} on CDM interface {}", unsafe { wv_host_interface(host) });
                    instances.insert(id, Instance { host, session: None, callbacks });
                    Ok(id)
                };
                let _ = reply.send(result);
            }
            Job::SetCertificate { id, certificate, reply } => {
                let result = instance(&mut instances, id).and_then(|i| {
                    let rc = unsafe { wv_set_server_certificate(i.host, certificate.as_ptr(), certificate.len() as u32) };
                    if rc == 0 { Ok(()) } else { Err(anyhow!("the service certificate was rejected ({rc})")) }
                });
                let _ = reply.send(result);
            }
            Job::Request { id, init_data, reply } => {
                let result = instance(&mut instances, id).and_then(|i| {
                    let mut sid = [0 as c_char; 128];
                    let rc = unsafe { wv_session_create(i.host, init_data.as_ptr(), init_data.len() as u32, sid.as_mut_ptr(), sid.len() as u32) };
                    if rc != 0 {
                        bail!("the Widevine module could not start a licence session ({rc})");
                    }
                    i.session = Some(unsafe { CStr::from_ptr(sid.as_ptr()) }.to_owned());
                    if i.callbacks.unhandled.contains(&3) {
                        bail!("the Widevine module asked to be provisioned, which izumi does not support");
                    }
                    i.callbacks.request.take().ok_or_else(|| anyhow!("the Widevine module produced no licence request"))
                });
                let _ = reply.send(result);
            }
            Job::Update { id, response, reply } => {
                let result = instance(&mut instances, id).and_then(|i| {
                    let sid = i.session.clone().ok_or_else(|| anyhow!("no licence session"))?;
                    i.callbacks.keys.clear();
                    let rc = unsafe { wv_session_update(i.host, sid.as_ptr(), response.as_ptr(), response.len() as u32) };
                    if rc != 0 {
                        bail!("the licence server's answer was rejected by the Widevine module ({rc})");
                    }
                    let keys = &i.callbacks.keys;
                    let mut other: Vec<u32> = keys.iter().map(|(s, _)| *s).filter(|s| *s != 0).collect();
                    other.sort_unstable();
                    other.dedup();
                    let usable_kids: Vec<[u8; 16]> = keys.iter().filter(|(s, _)| *s == 0).map(|(_, kid)| *kid).collect();
                    Ok(KeyReport { usable: keys.iter().filter(|(s, _)| *s == 0).count() as u32, total: keys.len() as u32, other, usable_kids })
                });
                let _ = reply.send(result);
            }
            Job::Decrypt { id, mut data, kids, samples, reply } => {
                let result = instance(&mut instances, id).and_then(|i| {
                    // The KID that last worked, tried first so a multi-KID stream does not waste a kNoKey
                    // Decrypt on every sample. Starts at the caller's first candidate (the tenc default).
                    let mut best = 0usize;
                    for s in &samples {
                        // A sample whose subsamples are all clear (no cipher bytes) is already plaintext;
                        // sending it through Decrypt is unnecessary and some module builds mishandle it.
                        if !s.subsamples.is_empty() && s.subsamples.iter().all(|(_, e)| *e == 0) {
                            continue;
                        }
                        let pairs: Vec<u32> = s.subsamples.iter().flat_map(|(c, e)| [*c, *e]).collect();
                        let sample = data.get_mut(s.offset..s.offset + s.size).ok_or_else(|| anyhow!("sample outside its fragment"))?;
                        // A stream can carry several content KIDs (Crunchyroll keys one per rung), and a
                        // sample is not always encrypted with the tenc default. kNoKey leaves the bytes
                        // untouched, so trying the next usable KID on the same buffer is safe. The KID that
                        // worked last is tried first (most samples in a track share one key).
                        let mut last = STATUS_NO_KEY;
                        for off in 0..kids.len() {
                            let idx = (best + off) % kids.len();
                            let kid = &kids[idx];
                            let rc = unsafe {
                                wv_decrypt(i.host, kid.as_ptr(), 16, s.iv.as_ptr(), s.iv.len() as u32, pairs.as_ptr(), s.subsamples.len() as u32, sample.as_mut_ptr(), sample.len() as u32)
                            };
                            last = rc;
                            if rc == 0 {
                                best = idx;
                                break;
                            }
                            if rc != STATUS_NO_KEY {
                                bail!("decrypt failed ({rc}) at offset {}", s.offset);
                            }
                        }
                        match last {
                            0 => {}
                            STATUS_NO_KEY => return Err(Refused(STATUS_NO_KEY).into()),
                            rc => bail!("decrypt failed ({rc}) at offset {}", s.offset),
                        }
                    }
                    Ok(())
                });
                let _ = reply.send((data, result));
            }
            Job::VideoInit { id, profile, width, height, avcc, reply } => {
                let result = instance(&mut instances, id).and_then(|i| {
                    let rc = unsafe { wv_video_init(i.host, profile, width, height, avcc.as_ptr(), avcc.len() as u32) };
                    if rc == 0 { Ok(()) } else { Err(anyhow!("the Widevine module cannot decode this video ({rc})")) }
                });
                let _ = reply.send(result);
            }
            Job::VideoDecode { id, kid, iv, subsamples, data, ts_us, mut out, reply } => {
                let result = instance(&mut instances, id).and_then(|i| {
                    let pairs: Vec<u32> = subsamples.iter().flat_map(|(c, e)| [*c, *e]).collect();
                    let (ptr, len) = data.as_ref().map(|d| (d.as_ptr(), d.len() as u32)).unwrap_or((std::ptr::null(), 0));
                    let (mut w, mut h, mut ts) = (0i32, 0i32, 0i64);
                    let rc = unsafe {
                        wv_video_decode(i.host, kid.as_ptr(), 16, iv.as_ptr(), iv.len() as u32, pairs.as_ptr(), subsamples.len() as u32, ptr, len, ts_us, out.as_mut_ptr(), out.len() as u32, &mut w, &mut h, &mut ts)
                    };
                    match rc {
                        0 => Ok(Some(Picture { ts_us: ts, width: w, height: h })),
                        1 => Ok(None),
                        _ => Err(anyhow!("decrypt-and-decode failed ({rc})")),
                    }
                });
                let _ = reply.send((out, result));
            }
            Job::VideoReset { id, reply } => {
                let result = instance(&mut instances, id).map(|i| unsafe { wv_video_reset(i.host) });
                let _ = reply.send(result);
            }
            Job::Close { id } => {
                if let Some(i) = instances.remove(&id) {
                    unsafe {
                        if let Some(sid) = &i.session {
                            wv_session_close(i.host, sid.as_ptr());
                        }
                        wv_host_close(i.host);
                    }
                    drop(i.callbacks);
                }
            }
        }
    }
}

/// Loads the module once per process. Returns its version string.
pub fn load_module(library: &Path) -> Result<String> {
    let library = library.to_str().ok_or_else(|| anyhow!("non-UTF-8 module path"))?.to_string();
    send(|reply| Job::Load { library, reply })?
}

/// One CDM instance for one playback. Dropping it closes the licence session and the instance. Each
/// instance is pinned to one lane (module thread), so instances on different lanes decrypt in parallel.
pub struct Cdm {
    id: u64,
    lane: usize,
}

impl Cdm {
    /// Opens an instance on the default lane (single-instance playback and the Linux path).
    pub fn open(interface: i32, renewals: Renewals) -> Result<Cdm> {
        Self::open_on(0, interface, renewals)
    }

    /// Opens an instance on `lane`, starting that module thread if needed. Instances on distinct
    /// lanes run concurrently; a save puts audio and video (and several audio shards) on their own.
    pub fn open_on(lane: usize, interface: i32, renewals: Renewals) -> Result<Cdm> {
        Ok(Cdm { id: send_on(lane, |reply| Job::Open { interface, renewals, reply })??, lane })
    }

    pub fn set_server_certificate(&self, certificate: Vec<u8>) -> Result<()> {
        send_on(self.lane, |reply| Job::SetCertificate { id: self.id, certificate, reply })?
    }

    /// Starts the licence session and returns the licence request to send to the server.
    pub fn licence_request(&self, init_data: Vec<u8>) -> Result<Vec<u8>> {
        send_on(self.lane, |reply| Job::Request { id: self.id, init_data, reply })?
    }

    pub fn update(&self, response: Vec<u8>) -> Result<KeyReport> {
        send_on(self.lane, |reply| Job::Update { id: self.id, response, reply })?
    }

    /// Decrypts the samples of one fragment in place, trying `kids` in order per sample (a stream can
    /// key several KIDs). The buffer always comes back (to be zeroed).
    pub fn decrypt(&self, data: Vec<u8>, kids: Vec<[u8; 16]>, samples: Vec<Sample>) -> (Vec<u8>, Result<()>) {
        let id = self.id;
        match send_on(self.lane, |reply| Job::Decrypt { id, data, kids, samples, reply }) {
            Ok(back) => back,
            Err(e) => (Vec::new(), Err(e)),
        }
    }

    /// Whether the module releases decrypt-only output for small video samples. Probed with a
    /// synthetic two-NAL sample of a few bytes, as Kodi does; a refusal means video must go through
    /// the module's own decoder. Used by the Linux streaming path.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fn allows_decrypt_only_video(&self, kid: [u8; 16]) -> bool {
        let data = vec![0, 0, 0, 1, 9, 0xff, 0, 0, 0, 1, 10, 0xff];
        let sample = Sample { offset: 0, size: data.len(), iv: vec![1, 2, 3, 4, 5, 6, 7, 8], subsamples: vec![(5, 1), (5, 1)], dts: 0, duration: 0, cto: 0 };
        let (mut back, result) = self.decrypt(data, vec![kid], vec![sample]);
        back.fill(0);
        result.is_ok()
    }

    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fn video_init(&self, profile: u32, width: i32, height: i32, avcc: Vec<u8>) -> Result<()> {
        send_on(self.lane, |reply| Job::VideoInit { id: self.id, profile, width, height, avcc, reply })?
    }

    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    #[allow(clippy::too_many_arguments)]
    pub fn video_decode(&self, kid: [u8; 16], iv: Vec<u8>, subsamples: Vec<(u32, u32)>, data: Option<Vec<u8>>, ts_us: i64, out: Vec<u8>) -> (Vec<u8>, Result<Option<Picture>>) {
        let id = self.id;
        match send_on(self.lane, |reply| Job::VideoDecode { id, kid, iv, subsamples, data, ts_us, out, reply }) {
            Ok(back) => back,
            Err(e) => (Vec::new(), Err(e)),
        }
    }

    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fn video_reset(&self) -> Result<()> {
        send_on(self.lane, |reply| Job::VideoReset { id: self.id, reply })?
    }
}

impl Drop for Cdm {
    fn drop(&mut self) {
        if let Ok(tx) = lane_sender(self.lane) {
            let _ = tx.send(Job::Close { id: self.id });
        }
    }
}
