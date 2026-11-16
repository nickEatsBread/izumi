//! The Windows CDM host, in Rust. It provides the same `wv_*` C ABI the Linux C++ shim
//! (`native/widevine/host.cc`) exports, so `cdm.rs` drives either one unchanged.
//!
//! The module (`widevinecdm.dll`) is a C++ object reached through the Chromium CDM interface. It was
//! built with the MSVC ABI, where a class with virtual methods is a pointer to a vtable of function
//! pointers in declaration order; `get_cdm_host_func` and the module instance are passed as such
//! objects. So this file lays out two vtables by hand — `Host_10` (what we give the module) and
//! `ContentDecryptionModule_10` (what the module gives us) — matching `content_decryption_module.h`
//! exactly. The WebView2 module ships interface 10 only, which is the one this host speaks.
//!
//! macOS uses this host unchanged for `libwidevinecdm.dylib` (also interface 10 only). Its module is
//! built with the Itanium C++ ABI, whose vtables list virtual methods in the same declaration order;
//! the only difference is the destructor (two slots instead of one), and every class here declares
//! its destructor last, so no slot this host fills or calls moves.
//!
//! Single-threaded by design, like the C++ shim: every call on one host happens on the CDM thread
//! (`cdm.rs`). Persistent state is off (so `CreateFileIO` is never used), there is no platform
//! verification, and output protection is reported unknown with no HDCP — a desktop browser's answer.
#![allow(clippy::missing_safety_doc)]

use std::ffi::{c_char, c_void, CStr};
use std::os::raw::c_int;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

// cdm::Status (content_decryption_module.h). 0 success, 2 no key, 4 decrypt error.
const K_SUCCESS: u32 = 0;

// ---- The module's exported C functions ----------------------------------------------------------

type InitFn = unsafe extern "C" fn();
type VersionFn = unsafe extern "C" fn() -> *const c_char;
// CreateCdmInstance(interface, key_system, key_system_size, get_host, user_data) -> *mut instance.
type CreateFn = unsafe extern "C" fn(c_int, *const c_char, u32, GetHostFn, *mut c_void) -> *mut c_void;
// get_cdm_host_func(host_interface_version, user_data) -> *mut Host.
type GetHostFn = unsafe extern "C" fn(c_int, *mut c_void) -> *mut c_void;

struct Module {
    // Kept for the life of the process: the module starts threads that may outlive an instance.
    _library: libloading::Library,
    path: String,
    create: CreateFn,
}

fn module() -> &'static Mutex<Option<Module>> {
    static MODULE: OnceLock<Mutex<Option<Module>>> = OnceLock::new();
    MODULE.get_or_init(|| Mutex::new(None))
}

fn module_version_string() -> &'static Mutex<String> {
    static VERSION: OnceLock<Mutex<String>> = OnceLock::new();
    VERSION.get_or_init(|| Mutex::new(String::new()))
}

fn set_err(err: *mut c_char, err_len: usize, message: &str) {
    if err.is_null() || err_len == 0 {
        return;
    }
    let bytes = message.as_bytes();
    let n = bytes.len().min(err_len - 1);
    // SAFETY: `err` points at `err_len` writable bytes; we write n+1 of them.
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), err as *mut u8, n);
        *err.add(n) = 0;
    }
}

// ---- cdm::Buffer / cdm::DecryptedBlock, exposed to the module as C++ objects --------------------

/// A heap buffer the module writes decrypted bytes into. It is a C++ `cdm::Buffer`: a vtable pointer
/// followed by our fields. The module calls `Destroy` when done; `Destroy` zeroes and frees, so clear
/// media never lingers in released memory.
#[repr(C)]
struct Buffer {
    vtable: *const BufferVtable,
    bytes: *mut u8,
    capacity: u32,
    size: u32,
}

#[repr(C)]
struct BufferVtable {
    // cdm::Buffer declares: Destroy, Capacity, Data, SetSize, Size (then a protected dtor we never
    // call). MSVC places these in declaration order with no separate dtor slot the module invokes.
    destroy: unsafe extern "C" fn(*mut Buffer),
    capacity: unsafe extern "C" fn(*const Buffer) -> u32,
    data: unsafe extern "C" fn(*mut Buffer) -> *mut u8,
    set_size: unsafe extern "C" fn(*mut Buffer, u32),
    size: unsafe extern "C" fn(*const Buffer) -> u32,
}

static BUFFER_VTABLE: BufferVtable = BufferVtable {
    destroy: buffer_destroy,
    capacity: buffer_capacity,
    data: buffer_data,
    set_size: buffer_set_size,
    size: buffer_size,
};

impl Buffer {
    fn allocate(capacity: u32) -> *mut Buffer {
        let mut storage = vec![0u8; capacity as usize].into_boxed_slice();
        let bytes = storage.as_mut_ptr();
        std::mem::forget(storage); // ownership moves into the Buffer; freed in buffer_destroy.
        Box::into_raw(Box::new(Buffer { vtable: &BUFFER_VTABLE, bytes, capacity, size: 0 }))
    }
}

unsafe extern "C" fn buffer_destroy(b: *mut Buffer) {
    if b.is_null() {
        return;
    }
    let boxed = Box::from_raw(b);
    if !boxed.bytes.is_null() && boxed.capacity > 0 {
        let slice = std::slice::from_raw_parts_mut(boxed.bytes, boxed.capacity as usize);
        slice.fill(0);
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(boxed.bytes, boxed.capacity as usize)));
    }
}
unsafe extern "C" fn buffer_capacity(b: *const Buffer) -> u32 {
    (*b).capacity
}
unsafe extern "C" fn buffer_data(b: *mut Buffer) -> *mut u8 {
    (*b).bytes
}
unsafe extern "C" fn buffer_set_size(b: *mut Buffer, size: u32) {
    (*b).size = size.min((*b).capacity);
}
unsafe extern "C" fn buffer_size(b: *const Buffer) -> u32 {
    (*b).size
}

/// cdm::DecryptedBlock: holds the clear buffer the module hands back from `Decrypt`.
#[repr(C)]
struct DecryptedBlock {
    vtable: *const DecryptedBlockVtable,
    buffer: *mut Buffer,
    timestamp: i64,
}

#[repr(C)]
struct DecryptedBlockVtable {
    set_decrypted_buffer: unsafe extern "C" fn(*mut DecryptedBlock, *mut Buffer),
    decrypted_buffer: unsafe extern "C" fn(*mut DecryptedBlock) -> *mut Buffer,
    set_timestamp: unsafe extern "C" fn(*mut DecryptedBlock, i64),
    timestamp: unsafe extern "C" fn(*const DecryptedBlock) -> i64,
}

static BLOCK_VTABLE: DecryptedBlockVtable = DecryptedBlockVtable {
    set_decrypted_buffer: block_set_buffer,
    decrypted_buffer: block_buffer,
    set_timestamp: block_set_timestamp,
    timestamp: block_timestamp,
};

unsafe extern "C" fn block_set_buffer(b: *mut DecryptedBlock, buffer: *mut Buffer) {
    let block = &mut *b;
    if !block.buffer.is_null() && block.buffer != buffer {
        buffer_destroy(block.buffer);
    }
    block.buffer = buffer;
}
unsafe extern "C" fn block_buffer(b: *mut DecryptedBlock) -> *mut Buffer {
    (*b).buffer
}
unsafe extern "C" fn block_set_timestamp(b: *mut DecryptedBlock, ts: i64) {
    (*b).timestamp = ts;
}
unsafe extern "C" fn block_timestamp(b: *const DecryptedBlock) -> i64 {
    (*b).timestamp
}

// ---- cdm::VideoFrame: a decoded I420 picture the module's decoder fills ---------------------------

/// cdm::Size {width, height}.
#[repr(C)]
#[derive(Clone, Copy)]
struct Size {
    width: i32,
    height: i32,
}

/// cdm::VideoFrame. The module calls the setters to describe one decoded picture; we read them back.
#[repr(C)]
struct VideoFrame {
    vtable: *const VideoFrameVtable,
    format: u32,
    size: Size,
    buffer: *mut Buffer,
    plane_offset: [u32; 3],
    stride: [u32; 3],
    timestamp: i64,
}

#[repr(C)]
struct VideoFrameVtable {
    set_format: unsafe extern "C" fn(*mut VideoFrame, u32),
    format: unsafe extern "C" fn(*const VideoFrame) -> u32,
    set_size: unsafe extern "C" fn(*mut VideoFrame, Size),
    size: unsafe extern "C" fn(*const VideoFrame) -> Size,
    set_frame_buffer: unsafe extern "C" fn(*mut VideoFrame, *mut Buffer),
    frame_buffer: unsafe extern "C" fn(*mut VideoFrame) -> *mut Buffer,
    set_plane_offset: unsafe extern "C" fn(*mut VideoFrame, u32, u32),
    plane_offset: unsafe extern "C" fn(*mut VideoFrame, u32) -> u32,
    set_stride: unsafe extern "C" fn(*mut VideoFrame, u32, u32),
    stride: unsafe extern "C" fn(*mut VideoFrame, u32) -> u32,
    set_timestamp: unsafe extern "C" fn(*mut VideoFrame, i64),
    timestamp: unsafe extern "C" fn(*const VideoFrame) -> i64,
}

static VIDEO_FRAME_VTABLE: VideoFrameVtable = VideoFrameVtable {
    set_format: vf_set_format,
    format: vf_format,
    set_size: vf_set_size,
    size: vf_size,
    set_frame_buffer: vf_set_frame_buffer,
    frame_buffer: vf_frame_buffer,
    set_plane_offset: vf_set_plane_offset,
    plane_offset: vf_plane_offset,
    set_stride: vf_set_stride,
    stride: vf_stride,
    set_timestamp: vf_set_timestamp,
    timestamp: vf_timestamp,
};

unsafe extern "C" fn vf_set_format(f: *mut VideoFrame, format: u32) {
    (*f).format = format;
}
unsafe extern "C" fn vf_format(f: *const VideoFrame) -> u32 {
    (*f).format
}
unsafe extern "C" fn vf_set_size(f: *mut VideoFrame, size: Size) {
    (*f).size = size;
}
unsafe extern "C" fn vf_size(f: *const VideoFrame) -> Size {
    (*f).size
}
unsafe extern "C" fn vf_set_frame_buffer(f: *mut VideoFrame, buffer: *mut Buffer) {
    let vf = &mut *f;
    if !vf.buffer.is_null() && vf.buffer != buffer {
        buffer_destroy(vf.buffer);
    }
    vf.buffer = buffer;
}
unsafe extern "C" fn vf_frame_buffer(f: *mut VideoFrame) -> *mut Buffer {
    (*f).buffer
}
unsafe extern "C" fn vf_set_plane_offset(f: *mut VideoFrame, plane: u32, offset: u32) {
    if plane < 3 {
        (*f).plane_offset[plane as usize] = offset;
    }
}
unsafe extern "C" fn vf_plane_offset(f: *mut VideoFrame, plane: u32) -> u32 {
    if plane < 3 {
        (*f).plane_offset[plane as usize]
    } else {
        0
    }
}
unsafe extern "C" fn vf_set_stride(f: *mut VideoFrame, plane: u32, stride: u32) {
    if plane < 3 {
        (*f).stride[plane as usize] = stride;
    }
}
unsafe extern "C" fn vf_stride(f: *mut VideoFrame, plane: u32) -> u32 {
    if plane < 3 {
        (*f).stride[plane as usize]
    } else {
        0
    }
}
unsafe extern "C" fn vf_set_timestamp(f: *mut VideoFrame, ts: i64) {
    (*f).timestamp = ts;
}
unsafe extern "C" fn vf_timestamp(f: *const VideoFrame) -> i64 {
    (*f).timestamp
}

// ---- cdm::FileIO: the module's persistent storage, kept in memory --------------------------------

/// cdm::FileIOClient vtable: OnOpenComplete, OnReadComplete, OnWriteComplete (then a dtor we skip).
#[repr(C)]
struct FileIOClientVtable {
    on_open_complete: unsafe extern "C" fn(*mut c_void, u32),
    on_read_complete: unsafe extern "C" fn(*mut c_void, u32, *const u8, u32),
    on_write_complete: unsafe extern "C" fn(*mut c_void, u32),
}

/// FileIOClient::Status.
const FILEIO_SUCCESS: u32 = 0;

/// A cdm::FileIO object the module uses to persist one file. It is a C++ object (vtable first) the
/// module Open/Read/Write/Closes; it holds the host and the client so its async completions can be
/// deferred and the stored bytes reach the Host's in-memory map.
#[repr(C)]
struct FileIo {
    vtable: *const FileIoVtable,
    host: *mut Host,
    client: *mut c_void,
    name: String,
}

#[repr(C)]
struct FileIoVtable {
    open: unsafe extern "C" fn(*mut FileIo, *const c_char, u32),
    read: unsafe extern "C" fn(*mut FileIo),
    write: unsafe extern "C" fn(*mut FileIo, *const u8, u32),
    close: unsafe extern "C" fn(*mut FileIo),
}

static FILEIO_VTABLE: FileIoVtable = FileIoVtable {
    open: fileio_open,
    read: fileio_read,
    write: fileio_write,
    close: fileio_close,
};

unsafe fn client_vtable(client: *mut c_void) -> *const FileIOClientVtable {
    // The client object's first word is its vtable pointer.
    *(client as *const *const FileIOClientVtable)
}

unsafe extern "C" fn fileio_open(f: *mut FileIo, name: *const c_char, name_size: u32) {
    let fio = &mut *f;
    fio.name = string_from(name as *const u8, name_size);
    let client = fio.client;
    (*fio.host).deferred.push(Box::new(move |_host: &mut Host| unsafe {
        let vt = client_vtable(client);
        ((*vt).on_open_complete)(client, FILEIO_SUCCESS);
    }));
}

unsafe extern "C" fn fileio_read(f: *mut FileIo) {
    let fio = &mut *f;
    let client = fio.client;
    let name = fio.name.clone();
    (*fio.host).deferred.push(Box::new(move |host: &mut Host| unsafe {
        let data = host.storage.get(&name).cloned().unwrap_or_default();
        let vt = client_vtable(client);
        let (ptr, len) = if data.is_empty() { (std::ptr::null(), 0) } else { (data.as_ptr(), data.len() as u32) };
        ((*vt).on_read_complete)(client, FILEIO_SUCCESS, ptr, len);
    }));
}

unsafe extern "C" fn fileio_write(f: *mut FileIo, data: *const u8, data_size: u32) {
    let fio = &mut *f;
    let client = fio.client;
    let name = fio.name.clone();
    let bytes = if data.is_null() || data_size == 0 { Vec::new() } else { std::slice::from_raw_parts(data, data_size as usize).to_vec() };
    (*fio.host).deferred.push(Box::new(move |host: &mut Host| unsafe {
        host.storage.insert(name.clone(), bytes.clone());
        let vt = client_vtable(client);
        ((*vt).on_write_complete)(client, FILEIO_SUCCESS);
    }));
}

unsafe extern "C" fn fileio_close(f: *mut FileIo) {
    // The module is done with this file; destroy the object.
    drop(Box::from_raw(f));
}

// ---- The Host_10 we hand to the module ----------------------------------------------------------

/// A pending promise: the module resolves/rejects asynchronously through host callbacks, and the
/// host pumps until it is done (as the C++ shim does).
#[derive(Default)]
struct Promise {
    done: bool,
    ok: bool,
    session: String,
    error: String,
}

/// Session messages and key statuses the module raises, read back by the `wv_*` entry points.
#[derive(Default)]
struct Observed {
    request: Option<Vec<u8>>,
    renewals: Vec<Vec<u8>>,
    unhandled: Vec<u32>,
    keys: Vec<u32>,
}

struct Timer {
    due: Instant,
    context: *mut c_void,
}

/// The host object. Its first field is the vtable pointer the module sees; everything after it is
/// private state only this process touches.
#[repr(C)]
struct Host {
    vtable: *const HostVtable,
    cdm: *mut c_void,
    cdm_vtable: *const CdmVtable,
    callbacks: *const WvCallbacks,
    initialized: bool,
    init_ok: bool,
    video_deferred_done: bool,
    video_deferred_status: u32,
    next_promise: u32,
    promises: std::collections::HashMap<u32, Promise>,
    observed: Observed,
    timers: Vec<Timer>,
    deferred: Vec<Box<dyn FnMut(&mut Host)>>,
    /// Persistent state the module stores through FileIO, by file name. In memory only (never
    /// written to disk, per the module's temporary-licence model), but it must survive within one
    /// instance: the Windows module stores its session state here and reads it back to install the
    /// content key, so an empty FileIO makes Decrypt return kNoKey.
    storage: std::collections::HashMap<String, Vec<u8>>,
}

/// The subset of the module callbacks `cdm.rs` wires up (message, key status, log).
#[repr(C)]
pub struct WvCallbacks {
    pub user: *mut c_void,
    pub on_message: Option<extern "C" fn(*mut c_void, *const c_char, u32, u32, *const u8, u32)>,
    pub on_key_status: Option<extern "C" fn(*mut c_void, *const u8, u32, u32)>,
    pub on_log: Option<extern "C" fn(*mut c_void, *const c_char)>,
}

/// Host_10 vtable, in the exact order content_decryption_module.h declares (Allocate … RequestStorageId).
#[repr(C)]
struct HostVtable {
    allocate: unsafe extern "C" fn(*mut Host, u32) -> *mut Buffer,
    set_timer: unsafe extern "C" fn(*mut Host, i64, *mut c_void),
    get_current_wall_time: unsafe extern "C" fn(*mut Host) -> f64,
    on_initialized: unsafe extern "C" fn(*mut Host, bool),
    on_resolve_key_status_promise: unsafe extern "C" fn(*mut Host, u32, u32),
    on_resolve_new_session_promise: unsafe extern "C" fn(*mut Host, u32, *const c_char, u32),
    on_resolve_promise: unsafe extern "C" fn(*mut Host, u32),
    on_reject_promise: unsafe extern "C" fn(*mut Host, u32, u32, u32, *const c_char, u32),
    on_session_message: unsafe extern "C" fn(*mut Host, *const c_char, u32, u32, *const c_char, u32),
    on_session_keys_change: unsafe extern "C" fn(*mut Host, *const c_char, u32, bool, *const KeyInformation, u32),
    on_expiration_change: unsafe extern "C" fn(*mut Host, *const c_char, u32, f64),
    on_session_closed: unsafe extern "C" fn(*mut Host, *const c_char, u32),
    send_platform_challenge: unsafe extern "C" fn(*mut Host, *const c_char, u32, *const c_char, u32),
    enable_output_protection: unsafe extern "C" fn(*mut Host, u32),
    query_output_protection_status: unsafe extern "C" fn(*mut Host),
    on_deferred_initialization_done: unsafe extern "C" fn(*mut Host, u32, u32),
    create_file_io: unsafe extern "C" fn(*mut Host, *mut c_void) -> *mut c_void,
    request_storage_id: unsafe extern "C" fn(*mut Host, u32),
}

/// cdm::KeyInformation: {key_id*, key_id_size, status, system_code}. We read the id, size and status.
#[repr(C)]
struct KeyInformation {
    key_id: *const u8,
    key_id_size: u32,
    status: u32,
    system_code: u32,
}

static HOST_VTABLE: HostVtable = HostVtable {
    allocate: host_allocate,
    set_timer: host_set_timer,
    get_current_wall_time: host_wall_time,
    on_initialized: host_on_initialized,
    on_resolve_key_status_promise: host_resolve_key_status,
    on_resolve_new_session_promise: host_resolve_new_session,
    on_resolve_promise: host_resolve_promise,
    on_reject_promise: host_reject_promise,
    on_session_message: host_session_message,
    on_session_keys_change: host_session_keys_change,
    on_expiration_change: host_expiration_change,
    on_session_closed: host_session_closed,
    send_platform_challenge: host_send_platform_challenge,
    enable_output_protection: host_enable_output_protection,
    query_output_protection_status: host_query_output_protection,
    on_deferred_initialization_done: host_deferred_init_done,
    create_file_io: host_create_file_io,
    request_storage_id: host_request_storage_id,
};

unsafe extern "C" fn host_allocate(_h: *mut Host, capacity: u32) -> *mut Buffer {
    Buffer::allocate(capacity)
}
unsafe extern "C" fn host_set_timer(h: *mut Host, delay_ms: i64, context: *mut c_void) {
    (*h).timers.push(Timer { due: Instant::now() + Duration::from_millis(delay_ms.max(0) as u64), context });
}
unsafe extern "C" fn host_wall_time(_h: *mut Host) -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}
unsafe extern "C" fn host_on_initialized(h: *mut Host, success: bool) {
    (*h).initialized = true;
    (*h).init_ok = success;
}
unsafe extern "C" fn host_resolve_key_status(h: *mut Host, id: u32, _status: u32) {
    resolve(&mut *h, id, String::new());
}
unsafe extern "C" fn host_resolve_new_session(h: *mut Host, id: u32, session: *const c_char, size: u32) {
    let s = string_from(session as *const u8, size);
    resolve(&mut *h, id, s);
}
unsafe extern "C" fn host_resolve_promise(h: *mut Host, id: u32) {
    resolve(&mut *h, id, String::new());
}
unsafe extern "C" fn host_reject_promise(h: *mut Host, id: u32, exception: u32, system_code: u32, message: *const c_char, size: u32) {
    let detail = string_from(message as *const u8, size);
    let p = (*h).promises.entry(id).or_default();
    p.done = true;
    p.ok = false;
    p.error = format!("{detail} (exception {exception}, system code {system_code})");
}
unsafe extern "C" fn host_session_message(h: *mut Host, session: *const c_char, session_size: u32, kind: u32, message: *const c_char, size: u32) {
    let cb = (*h).callbacks;
    if !cb.is_null() {
        if let Some(on_message) = (*cb).on_message {
            on_message((*cb).user, session, session_size, kind, message as *const u8, size);
        }
    }
    // Also recorded so the wv_* entry points can read the licence request without the callback.
    let bytes = if message.is_null() || size == 0 { Vec::new() } else { std::slice::from_raw_parts(message as *const u8, size as usize).to_vec() };
    match kind {
        0 if (*h).observed.request.is_none() => (*h).observed.request = Some(bytes),
        1 => (*h).observed.renewals.push(bytes),
        other => (*h).observed.unhandled.push(other),
    }
}
unsafe extern "C" fn host_session_keys_change(h: *mut Host, _session: *const c_char, _session_size: u32, _additional: bool, keys: *const KeyInformation, count: u32) {
    let cb = (*h).callbacks;
    for i in 0..count as isize {
        let k = &*keys.offset(i);
        (*h).observed.keys.push(k.status);
        if !cb.is_null() {
            if let Some(on_key) = (*cb).on_key_status {
                on_key((*cb).user, k.key_id, k.key_id_size, k.status);
            }
        }
    }
}
unsafe extern "C" fn host_expiration_change(_h: *mut Host, _session: *const c_char, _size: u32, _time: f64) {}
unsafe extern "C" fn host_session_closed(_h: *mut Host, _session: *const c_char, _size: u32) {}
unsafe extern "C" fn host_send_platform_challenge(h: *mut Host, _service: *const c_char, _ss: u32, _challenge: *const c_char, _cs: u32) {
    // Windows has no platform verification here; answer with an empty response on the pump.
    (*h).deferred.push(Box::new(|host: &mut Host| unsafe {
        let challenge = PlatformChallengeResponse::default();
        cdm_call_platform_challenge(host, &challenge);
    }));
}
unsafe extern "C" fn host_enable_output_protection(_h: *mut Host, _mask: u32) {}
unsafe extern "C" fn host_query_output_protection(h: *mut Host) {
    // No way to vouch for the display link: report it succeeded with no link and no HDCP, as the
    // Linux shim does and a desktop browser reports.
    (*h).deferred.push(Box::new(|host: &mut Host| unsafe {
        cdm_call_output_protection(host, 0 /* kQuerySucceeded */, 0 /* kLinkTypeNone */, 0 /* kProtectionNone */);
    }));
}
unsafe extern "C" fn host_deferred_init_done(h: *mut Host, stream_type: u32, status: u32) {
    // kStreamTypeVideo == 1.
    if stream_type == 1 {
        (*h).video_deferred_done = true;
        (*h).video_deferred_status = status;
    }
}
unsafe extern "C" fn host_create_file_io(h: *mut Host, client: *mut c_void) -> *mut c_void {
    if client.is_null() {
        return std::ptr::null_mut();
    }
    // A FileIO backed by the host's in-memory storage. The module Open/Read/Write/Closes it; the
    // bytes live only for this instance (the licence is temporary), which is enough for the module
    // to install and read back the session state it needs to decrypt.
    let fio = Box::new(FileIo { vtable: &FILEIO_VTABLE, host: h, client, name: String::new() });
    Box::into_raw(fio) as *mut c_void
}
unsafe extern "C" fn host_request_storage_id(h: *mut Host, version: u32) {
    (*h).deferred.push(Box::new(move |host: &mut Host| unsafe {
        cdm_call_storage_id(host, version);
    }));
}

/// cdm::PlatformChallengeResponse is three (data, size) pairs; an empty one is all-zero.
#[repr(C)]
struct PlatformChallengeResponse {
    platform_key_certificate: *const u8,
    platform_key_certificate_length: u32,
    challenge_response: *const u8,
    challenge_response_length: u32,
    signed_data: *const u8,
    signed_data_length: u32,
}
impl Default for PlatformChallengeResponse {
    fn default() -> Self {
        PlatformChallengeResponse {
            platform_key_certificate: std::ptr::null(),
            platform_key_certificate_length: 0,
            challenge_response: std::ptr::null(),
            challenge_response_length: 0,
            signed_data: std::ptr::null(),
            signed_data_length: 0,
        }
    }
}

fn resolve(host: &mut Host, id: u32, session: String) {
    let p = host.promises.entry(id).or_default();
    p.done = true;
    p.ok = true;
    p.session = session;
}

unsafe fn log(host: &Host, message: &str) {
    if host.callbacks.is_null() {
        return;
    }
    if let Some(on_log) = (*host.callbacks).on_log {
        if let Ok(c) = std::ffi::CString::new(message) {
            on_log((*host.callbacks).user, c.as_ptr());
        }
    }
}

fn string_from(ptr: *const u8, size: u32) -> String {
    if ptr.is_null() || size == 0 {
        return String::new();
    }
    // SAFETY: the module gives valid pointer+size for its message strings.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, size as usize) };
    String::from_utf8_lossy(bytes).into_owned()
}

// ---- Calling into the module (ContentDecryptionModule_10 vtable) --------------------------------

/// ContentDecryptionModule_10 vtable, in declaration order. Only the slots we invoke are typed
/// precisely; the rest keep placeholders of the right width so later slots land at the right offset.
#[repr(C)]
struct CdmVtable {
    initialize: unsafe extern "C" fn(*mut c_void, bool, bool, bool),
    get_status_for_policy: unsafe extern "C" fn(*mut c_void, u32, *const c_void),
    set_server_certificate: unsafe extern "C" fn(*mut c_void, u32, *const u8, u32),
    create_session_and_generate_request: unsafe extern "C" fn(*mut c_void, u32, u32, u32, *const u8, u32),
    load_session: unsafe extern "C" fn(*mut c_void, u32, u32, *const c_char, u32),
    update_session: unsafe extern "C" fn(*mut c_void, u32, *const c_char, u32, *const u8, u32),
    close_session: unsafe extern "C" fn(*mut c_void, u32, *const c_char, u32),
    remove_session: unsafe extern "C" fn(*mut c_void, u32, *const c_char, u32),
    timer_expired: unsafe extern "C" fn(*mut c_void, *mut c_void),
    decrypt: unsafe extern "C" fn(*mut c_void, *const InputBuffer2, *mut DecryptedBlock) -> u32,
    initialize_audio_decoder: unsafe extern "C" fn(*mut c_void, *const c_void) -> u32,
    initialize_video_decoder: unsafe extern "C" fn(*mut c_void, *const c_void) -> u32,
    deinitialize_decoder: unsafe extern "C" fn(*mut c_void, u32),
    reset_decoder: unsafe extern "C" fn(*mut c_void, u32),
    decrypt_and_decode_frame: unsafe extern "C" fn(*mut c_void, *const InputBuffer2, *mut c_void) -> u32,
    decrypt_and_decode_samples: unsafe extern "C" fn(*mut c_void, *const InputBuffer2, *mut c_void) -> u32,
    on_platform_challenge_response: unsafe extern "C" fn(*mut c_void, *const PlatformChallengeResponse),
    on_query_output_protection_status: unsafe extern "C" fn(*mut c_void, u32, u32, u32),
    on_storage_id: unsafe extern "C" fn(*mut c_void, u32, *const u8, u32),
    destroy: unsafe extern "C" fn(*mut c_void),
}

/// cdm::Pattern.
#[repr(C)]
#[derive(Clone, Copy)]
struct Pattern {
    crypt_byte_block: u32,
    skip_byte_block: u32,
}

/// cdm::SubsampleEntry {clear_bytes, cipher_bytes}.
#[repr(C)]
#[derive(Clone, Copy)]
struct SubsampleEntry {
    clear_bytes: u32,
    cipher_bytes: u32,
}

/// cdm::InputBuffer_2, laid out exactly as the header specifies (padding between the trailing-u32
/// fields and the next pointer is explicit so 64-bit offsets match the C++ struct).
#[repr(C)]
struct InputBuffer2 {
    data: *const u8,
    data_size: u32,
    encryption_scheme: u32,
    key_id: *const u8,
    key_id_size: u32,
    _pad0: u32,
    iv: *const u8,
    iv_size: u32,
    _pad1: u32,
    subsamples: *const SubsampleEntry,
    num_subsamples: u32,
    _pad2: u32,
    pattern: Pattern,
    timestamp: i64,
}

// InputBuffer_2 must match the C++ struct the module reads: 80 bytes on 64-bit, with key_id at 16,
// iv at 32 and subsamples at 48 (CHECK_TYPE(InputBuffer_2, 64, 80) in content_decryption_module.h).
const _: () = {
    assert!(std::mem::size_of::<InputBuffer2>() == 80);
    assert!(std::mem::offset_of!(InputBuffer2, key_id) == 16);
    assert!(std::mem::offset_of!(InputBuffer2, iv) == 32);
    assert!(std::mem::offset_of!(InputBuffer2, subsamples) == 48);
    assert!(std::mem::offset_of!(InputBuffer2, pattern) == 64);
    assert!(std::mem::offset_of!(InputBuffer2, timestamp) == 72);
};

unsafe fn cdm_vtable(host: &Host) -> &CdmVtable {
    &*host.cdm_vtable
}

unsafe fn cdm_call_platform_challenge(host: &mut Host, response: *const PlatformChallengeResponse) {
    (cdm_vtable(host).on_platform_challenge_response)(host.cdm, response);
}
unsafe fn cdm_call_output_protection(host: &mut Host, result: u32, links: u32, protection: u32) {
    (cdm_vtable(host).on_query_output_protection_status)(host.cdm, result, links, protection);
}
unsafe fn cdm_call_storage_id(host: &mut Host, version: u32) {
    (cdm_vtable(host).on_storage_id)(host.cdm, version, std::ptr::null(), 0);
}

// ---- The pump: run deferred host replies and fire due timers at top level -----------------------

unsafe fn run_deferred(host: &mut Host) {
    while let Some(mut task) = (!host.deferred.is_empty()).then(|| host.deferred.remove(0)) {
        task(host);
    }
}

unsafe fn tick(host: &mut Host) -> bool {
    run_deferred(host);
    let now = Instant::now();
    let mut fired = false;
    let mut i = 0;
    while i < host.timers.len() {
        if host.timers[i].due <= now {
            let context = host.timers.remove(i).context;
            (cdm_vtable(host).timer_expired)(host.cdm, context);
            fired = true;
        } else {
            i += 1;
        }
    }
    run_deferred(host);
    fired
}

/// Pumps until `done` or the deadline. `done` is evaluated against the host between ticks.
unsafe fn pump(host: &mut Host, done: impl Fn(&Host) -> bool, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        run_deferred(host);
        if done(host) {
            return true;
        }
        if Instant::now() > deadline {
            return false;
        }
        if !tick(host) {
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}

unsafe fn new_promise(host: &mut Host) -> u32 {
    let id = host.next_promise;
    host.next_promise += 1;
    host.promises.insert(id, Promise::default());
    id
}

/// Waits for promise `id`. Returns 0 ok (filling `session`), -1 timeout, -2 rejected.
unsafe fn wait_promise(host: &mut Host, id: u32) -> (c_int, String) {
    if !pump(host, |h| h.promises.get(&id).is_some_and(|p| p.done), Duration::from_secs(15)) {
        log(host, &format!("promise {id} timed out"));
        return (-1, String::new());
    }
    let p = host.promises.remove(&id).unwrap_or_default();
    if !p.ok {
        log(host, &format!("promise {id} rejected: {}", p.error));
        return (-2, String::new());
    }
    (0, p.session)
}

// ---- get_cdm_host_func: the module asks us for the host object -----------------------------------

unsafe extern "C" fn get_host(version: c_int, user: *mut c_void) -> *mut c_void {
    // We only speak interface 10; anything else gets null (the module then falls back or fails).
    if version == 10 {
        user // `user` is the &mut Host we passed as user_data; its first field is the vtable.
    } else {
        std::ptr::null_mut()
    }
}

// ---- The wv_* C ABI, matching native/widevine/host.cc -------------------------------------------

/// The handle `cdm.rs` holds. One boxed Host plus the interface it opened on.
#[repr(C)]
pub struct WvHost {
    host: Box<Host>,
    interface: c_int,
}

pub unsafe extern "C" fn wv_module_load(cdm_path: *const c_char, err: *mut c_char, err_len: usize) -> c_int {
    let path = match CStr::from_ptr(cdm_path).to_str() {
        Ok(p) => p.to_string(),
        Err(_) => {
            set_err(err, err_len, "non-UTF-8 module path");
            return -1;
        }
    };
    let mut guard = match module().lock() {
        Ok(g) => g,
        Err(_) => {
            set_err(err, err_len, "module registry poisoned");
            return -1;
        }
    };
    if let Some(m) = guard.as_ref() {
        if m.path == path {
            return 0;
        }
        set_err(err, err_len, "another Widevine module is already loaded; restart izumi");
        return -1;
    }
    // SAFETY: loading a trusted module from a path the host resolved.
    let library = match libloading::Library::new(&path) {
        Ok(l) => l,
        Err(e) => {
            set_err(err, err_len, &format!("could not load the module: {e}"));
            return -1;
        }
    };
    let init: libloading::Symbol<InitFn> = match library.get(b"InitializeCdmModule_4\0") {
        Ok(s) => s,
        Err(_) => {
            set_err(err, err_len, "not a CDM library (missing InitializeCdmModule_4)");
            return -1;
        }
    };
    let create: libloading::Symbol<CreateFn> = match library.get(b"CreateCdmInstance\0") {
        Ok(s) => s,
        Err(_) => {
            set_err(err, err_len, "not a CDM library (missing CreateCdmInstance)");
            return -1;
        }
    };
    let version: String = library
        .get::<VersionFn>(b"GetCdmVersion\0")
        .ok()
        .and_then(|f| CStr::from_ptr(f()).to_str().ok().map(str::to_string))
        .unwrap_or_else(|| "unknown".into());
    init();
    let create = *create;
    *module_version_string().lock().unwrap() = version;
    // Keep the library resolved for the process lifetime: never unload (module threads may outlive us).
    *guard = Some(Module { _library: library, path, create });
    0
}

pub unsafe extern "C" fn wv_module_version() -> *const c_char {
    // A process-lifetime CString so the returned pointer stays valid.
    static VERSION_C: OnceLock<std::ffi::CString> = OnceLock::new();
    let v = VERSION_C.get_or_init(|| {
        let s = module_version_string().lock().map(|g| g.clone()).unwrap_or_default();
        std::ffi::CString::new(s).unwrap_or_default()
    });
    v.as_ptr()
}

pub unsafe extern "C" fn wv_host_open(preferred_interface: c_int, callbacks: *const WvCallbacks, err: *mut c_char, err_len: usize) -> *mut WvHost {
    let create = match module().lock().ok().and_then(|g| g.as_ref().map(|m| m.create)) {
        Some(c) => c,
        None => {
            set_err(err, err_len, "Widevine module not loaded");
            return std::ptr::null_mut();
        }
    };
    let mut host = Box::new(Host {
        vtable: &HOST_VTABLE,
        cdm: std::ptr::null_mut(),
        cdm_vtable: std::ptr::null(),
        callbacks,
        initialized: false,
        init_ok: false,
        video_deferred_done: false,
        video_deferred_status: 0,
        next_promise: 1,
        promises: std::collections::HashMap::new(),
        observed: Observed::default(),
        timers: Vec::new(),
        deferred: Vec::new(),
        storage: std::collections::HashMap::new(),
    });
    let key_system = b"com.widevine.alpha";
    let host_ptr: *mut Host = &mut *host;
    // The WebView2 module ships interface 10 only; honour an explicit request, else take 10.
    let mut opened = 0;
    for v in [11, 10] {
        if preferred_interface != 0 && v != preferred_interface {
            continue;
        }
        let instance = create(v, key_system.as_ptr() as *const c_char, key_system.len() as u32, get_host, host_ptr as *mut c_void);
        if instance.is_null() {
            continue;
        }
        // The instance's first word is its vtable pointer.
        host.cdm = instance;
        host.cdm_vtable = *(instance as *const *const CdmVtable);
        opened = v;
        break;
    }
    if opened == 0 {
        set_err(err, err_len, "the Widevine module refused CDM interfaces 11 and 10");
        return std::ptr::null_mut();
    }
    // Initialize(distinctive_id=false, persistent_state=true, use_hw_secure_codecs=false). The
    // Windows module build installs the content key through FileIO storage, so persistent_state MUST
    // be true or Decrypt returns kNoKey for every sample; that storage is kept in memory only
    // (host_create_file_io), never on disk. No distinctive identifier and no hardware security (L3).
    (cdm_vtable(&host).initialize)(host.cdm, false, true, false);
    if !pump(&mut host, |h| h.initialized, Duration::from_secs(15)) || !host.init_ok {
        let destroy = cdm_vtable(&host).destroy;
        destroy(host.cdm);
        set_err(err, err_len, "Widevine module initialisation failed");
        return std::ptr::null_mut();
    }
    Box::into_raw(Box::new(WvHost { host, interface: opened }))
}

pub unsafe extern "C" fn wv_host_interface(h: *const WvHost) -> c_int {
    (*h).interface
}

pub unsafe extern "C" fn wv_host_tick(h: *mut WvHost) {
    tick(&mut (*h).host);
}

pub unsafe extern "C" fn wv_set_server_certificate(h: *mut WvHost, cert: *const u8, len: u32) -> c_int {
    let host = &mut (*h).host;
    let id = new_promise(host);
    (cdm_vtable(host).set_server_certificate)(host.cdm, id, cert, len);
    wait_promise(host, id).0
}

pub unsafe extern "C" fn wv_session_create(h: *mut WvHost, init: *const u8, len: u32, sid: *mut c_char, cap: u32) -> c_int {
    let host = &mut (*h).host;
    let id = new_promise(host);
    // kTemporary = 0, kCenc (InitDataType) = 0 (cenc pssh).
    (cdm_vtable(host).create_session_and_generate_request)(host.cdm, id, 0, 0, init, len);
    let (rc, session) = wait_promise(host, id);
    if rc != 0 {
        return rc;
    }
    if session.len() + 1 > cap as usize {
        return -3;
    }
    let bytes = session.as_bytes();
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), sid as *mut u8, bytes.len());
    *sid.add(bytes.len()) = 0;
    0
}

pub unsafe extern "C" fn wv_session_update(h: *mut WvHost, sid: *const c_char, resp: *const u8, len: u32) -> c_int {
    let host = &mut (*h).host;
    let session = CStr::from_ptr(sid).to_bytes();
    let id = new_promise(host);
    (cdm_vtable(host).update_session)(host.cdm, id, sid, session.len() as u32, resp, len);
    wait_promise(host, id).0
}

pub unsafe extern "C" fn wv_session_close(h: *mut WvHost, sid: *const c_char) -> c_int {
    let host = &mut (*h).host;
    let session = CStr::from_ptr(sid).to_bytes();
    let id = new_promise(host);
    (cdm_vtable(host).close_session)(host.cdm, id, sid, session.len() as u32);
    wait_promise(host, id).0
}

/// Fills an InputBuffer_2 for one CENC sample. An 8-byte IV is the high half of the AES-CTR counter.
unsafe fn cenc_input(
    iv16: &mut [u8; 16],
    entries: &mut Vec<SubsampleEntry>,
    key_id: *const u8,
    key_id_len: u32,
    iv: *const u8,
    iv_len: u32,
    subsamples: *const u32,
    pairs: u32,
    data: *const u8,
    len: u32,
) -> Option<InputBuffer2> {
    if iv_len != 8 && iv_len != 16 {
        return None;
    }
    iv16.fill(0);
    std::ptr::copy_nonoverlapping(iv, iv16.as_mut_ptr(), iv_len as usize);
    entries.clear();
    for i in 0..pairs as usize {
        entries.push(SubsampleEntry { clear_bytes: *subsamples.add(2 * i), cipher_bytes: *subsamples.add(2 * i + 1) });
    }
    Some(InputBuffer2 {
        data,
        data_size: len,
        encryption_scheme: 1, // kCenc
        key_id,
        key_id_size: key_id_len,
        _pad0: 0,
        iv: iv16.as_ptr(),
        iv_size: 16,
        _pad1: 0,
        subsamples: if pairs > 0 { entries.as_ptr() } else { std::ptr::null() },
        num_subsamples: pairs,
        _pad2: 0,
        pattern: Pattern { crypt_byte_block: 0, skip_byte_block: 0 },
        timestamp: 0,
    })
}

pub unsafe extern "C" fn wv_decrypt(
    h: *mut WvHost,
    key_id: *const u8,
    key_id_len: u32,
    iv: *const u8,
    iv_len: u32,
    subsamples: *const u32,
    pairs: u32,
    data: *mut u8,
    len: u32,
) -> c_int {
    let host = &mut (*h).host;
    let mut iv16 = [0u8; 16];
    let mut entries: Vec<SubsampleEntry> = Vec::new();
    let input = match cenc_input(&mut iv16, &mut entries, key_id, key_id_len, iv, iv_len, subsamples, pairs, data, len) {
        Some(i) => i,
        None => return -3,
    };
    let mut block = DecryptedBlock { vtable: &BLOCK_VTABLE, buffer: std::ptr::null_mut(), timestamp: 0 };
    let status = (cdm_vtable(host).decrypt)(host.cdm, &input, &mut block);
    run_deferred(host);
    if status != K_SUCCESS {
        if !block.buffer.is_null() {
            buffer_destroy(block.buffer);
        }
        return status as c_int;
    }
    let clear = block.buffer;
    if clear.is_null() || (*clear).size != len {
        if !clear.is_null() {
            buffer_destroy(clear);
        }
        return -4;
    }
    std::ptr::copy_nonoverlapping((*clear).bytes, data, len as usize);
    buffer_destroy(clear);
    0
}

/// cdm::VideoDecoderConfig_2 (40 bytes on 64-bit). Only used to put the module in decode mode.
#[repr(C)]
struct VideoDecoderConfig2 {
    codec: u32,
    profile: u32,
    format: u32,
    _pad: u32,
    coded_width: i32,
    coded_height: i32,
    extra_data: *mut u8,
    extra_data_size: u32,
    encryption_scheme: u32,
}

const _: () = assert!(std::mem::size_of::<VideoDecoderConfig2>() == 40);

/// Initializes the module's H.264 decoder, so video can be decrypted-and-decoded to I420 pictures
/// (the Windows module refuses decrypt-only for some non-reference frames, so saved video goes
/// through the decoder and is re-encoded).
pub unsafe extern "C" fn wv_video_init(h: *mut WvHost, profile: u32, width: c_int, height: c_int, extra: *const u8, extra_len: u32) -> c_int {
    let host = &mut (*h).host;
    let config = VideoDecoderConfig2 {
        codec: 2,  // kCodecH264 (kUnknownVideoCodec=0, kCodecVp8=1, kCodecH264=2)
        profile,
        format: 2, // kI420 (kUnknownVideoFormat=0, kYv12=1, kI420=2)
        _pad: 0,
        coded_width: width,
        coded_height: height,
        extra_data: extra as *mut u8,
        extra_data_size: extra_len,
        encryption_scheme: 1, // kCenc
    };
    host.video_deferred_done = false;
    let status = (cdm_vtable(host).initialize_video_decoder)(host.cdm, &config as *const _ as *const c_void);
    run_deferred(host);
    // kDeferredInitialization (6): wait for OnDeferredInitializationDone.
    let rc = if status == 6 {
        if !pump(host, |h| h.video_deferred_done, Duration::from_secs(15)) {
            -1
        } else {
            host.video_deferred_status as c_int
        }
    } else {
        status as c_int
    };
    // config (and its extra_data) must outlive the module's reads above.
    let _ = &config;
    rc
}
/// Decrypts and decodes one access unit (data null/len 0 drains). Writes a tightly packed I420
/// picture to `out`. Returns 0 with a picture, 1 when the decoder needs more input, else a status.
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn wv_video_decode(
    h: *mut WvHost,
    key_id: *const u8,
    key_id_len: u32,
    iv: *const u8,
    iv_len: u32,
    subsamples: *const u32,
    pairs: u32,
    data: *const u8,
    len: u32,
    timestamp: i64,
    out: *mut u8,
    out_cap: u32,
    out_width: *mut c_int,
    out_height: *mut c_int,
    out_timestamp: *mut i64,
) -> c_int {
    let host = &mut (*h).host;
    let mut iv16 = [0u8; 16];
    let mut entries: Vec<SubsampleEntry> = Vec::new();
    let mut input = InputBuffer2 {
        data: std::ptr::null(),
        data_size: 0,
        encryption_scheme: 0, // kUnencrypted: end-of-stream drain
        key_id: std::ptr::null(),
        key_id_size: 0,
        _pad0: 0,
        iv: std::ptr::null(),
        iv_size: 0,
        _pad1: 0,
        subsamples: std::ptr::null(),
        num_subsamples: 0,
        _pad2: 0,
        pattern: Pattern { crypt_byte_block: 0, skip_byte_block: 0 },
        timestamp,
    };
    if !data.is_null() && len > 0 {
        match cenc_input(&mut iv16, &mut entries, key_id, key_id_len, iv, iv_len, subsamples, pairs, data, len) {
            Some(mut i) => {
                i.timestamp = timestamp;
                input = i;
            }
            None => return -3,
        }
    }
    let mut frame = VideoFrame {
        vtable: &VIDEO_FRAME_VTABLE,
        format: 0,
        size: Size { width: 0, height: 0 },
        buffer: std::ptr::null_mut(),
        plane_offset: [0; 3],
        stride: [0; 3],
        timestamp: 0,
    };
    let status = (cdm_vtable(host).decrypt_and_decode_frame)(host.cdm, &input, &mut frame as *mut _ as *mut c_void);
    run_deferred(host);
    if status == 1 {
        return 1; // kNeedMoreData
    }
    if status != K_SUCCESS {
        if !frame.buffer.is_null() {
            buffer_destroy(frame.buffer);
        }
        return status as c_int;
    }
    // Extract tightly packed I420. kI420 = 1, kYv12 = 0 (V before U, so swap chroma).
    let rc = extract_i420(&frame, out, out_cap, out_width, out_height, out_timestamp);
    if !frame.buffer.is_null() {
        buffer_destroy(frame.buffer);
    }
    rc
}

/// Copies the decoder's I420/YV12 planes tightly packed into `out`. Mirrors the C++ shim.
unsafe fn extract_i420(frame: &VideoFrame, out: *mut u8, out_cap: u32, out_width: *mut c_int, out_height: *mut c_int, out_timestamp: *mut i64) -> c_int {
    let buffer = frame.buffer;
    let (w, ht) = (frame.size.width, frame.size.height);
    let yv12 = frame.format == 1; // kYv12=1; kI420=2
    if buffer.is_null() || w <= 0 || ht <= 0 || (!yv12 && frame.format != 2) {
        return -5;
    }
    let cw = (w as u64 + 1) / 2;
    let ch = (ht as u64 + 1) / 2;
    let need = w as u64 * ht as u64 + 2 * cw * ch;
    if (out_cap as u64) < need {
        return -6;
    }
    let base = (*buffer).bytes;
    let buffer_size = (*buffer).size as u64;
    let mut dst = out;
    // Y, then (U,V) for I420 or (V,U) swapped for YV12. Plane order indices: kYPlane 0, kUPlane 1, kVPlane 2.
    let order: [u32; 3] = [0, if yv12 { 2 } else { 1 }, if yv12 { 1 } else { 2 }];
    for (p, plane) in order.iter().enumerate() {
        let pw = if p > 0 { cw } else { w as u64 };
        let ph = if p > 0 { ch } else { ht as u64 };
        let offset = frame.plane_offset[*plane as usize] as u64;
        let stride = frame.stride[*plane as usize] as u64;
        if stride < pw || offset + stride * (ph - 1) + pw > buffer_size {
            return -7;
        }
        let src = base.add(offset as usize);
        for row in 0..ph {
            std::ptr::copy_nonoverlapping(src.add((row * stride) as usize), dst.add((row * pw) as usize), pw as usize);
        }
        dst = dst.add((pw * ph) as usize);
    }
    *out_width = w;
    *out_height = ht;
    *out_timestamp = frame.timestamp;
    0
}
pub unsafe extern "C" fn wv_video_reset(h: *mut WvHost) {
    let host = &mut (*h).host;
    (cdm_vtable(host).reset_decoder)(host.cdm, 1 /* kStreamTypeVideo */);
    run_deferred(host);
}

pub unsafe extern "C" fn wv_host_close(h: *mut WvHost) {
    if h.is_null() {
        return;
    }
    let mut boxed = Box::from_raw(h);
    if !boxed.host.cdm.is_null() {
        let destroy = cdm_vtable(&boxed.host).destroy;
        destroy(boxed.host.cdm);
        boxed.host.cdm = std::ptr::null_mut();
    }
    // Box<Host> drops here, taking its promises/observed/timers with it.
}
