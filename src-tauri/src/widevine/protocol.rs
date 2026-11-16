//! `izcr://<session>/<track>`: mpv reads protected media from izumi's memory through libmpv's
//! in-process stream callbacks, never through a socket, pipe or file. Registered per playback core,
//! so the headless thumbnail core cannot open these URLs at all. Uses the C API directly (the
//! libmpv2 wrapper has no cancel callback, so a stop during a slow fetch would wait it out).
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::sync::atomic::{AtomicU64, Ordering};

use libmpv2_sys as sys;

use super::media::Cancel;
use super::session::{self, Source};

pub const SCHEME: &str = "izcr";

struct Reader {
    source: Source,
    pos: AtomicU64,
    cancel: Cancel,
}

/// Registers the protocol on one mpv core. Safe to call once per core.
pub fn register(mpv: &libmpv2::Mpv) -> Result<(), String> {
    let name = CString::new(SCHEME).map_err(|e| e.to_string())?;
    // SAFETY: a live core handle and a static callback; user_data is unused.
    let rc = unsafe { sys::mpv_stream_cb_add_ro(mpv.ctx.as_ptr(), name.as_ptr(), std::ptr::null_mut(), Some(open)) };
    if rc < 0 {
        return Err(format!("could not register the protected-media protocol ({rc})"));
    }
    Ok(())
}

unsafe extern "C" fn open(_: *mut c_void, uri: *mut c_char, info: *mut sys::mpv_stream_cb_info) -> c_int {
    let uri = match CStr::from_ptr(uri).to_str() {
        Ok(uri) => uri,
        Err(_) => return sys::mpv_error_MPV_ERROR_LOADING_FAILED,
    };
    let Some(source) = session::source(uri) else {
        return sys::mpv_error_MPV_ERROR_LOADING_FAILED;
    };
    let reader = Box::new(Reader { source, pos: AtomicU64::new(0), cancel: Cancel::default() });
    (*info).cookie = Box::into_raw(reader) as *mut c_void;
    (*info).read_fn = Some(read);
    (*info).seek_fn = Some(seek);
    (*info).size_fn = Some(size);
    (*info).close_fn = Some(close);
    (*info).cancel_fn = Some(cancel);
    0
}

/// All callbacks only borrow the reader shared: mpv may call `cancel` from another thread while a
/// read is blocked.
unsafe fn reader<'a>(cookie: *mut c_void) -> &'a Reader {
    &*(cookie as *const Reader)
}

unsafe extern "C" fn read(cookie: *mut c_void, buf: *mut c_char, nbytes: u64) -> i64 {
    let r = reader(cookie);
    let out = std::slice::from_raw_parts_mut(buf as *mut u8, nbytes as usize);
    let pos = r.pos.load(Ordering::SeqCst);
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| r.source.read_at(pos, out, &r.cancel))) {
        Ok(Ok(n)) => {
            r.pos.store(pos + n as u64, Ordering::SeqCst);
            n as i64
        }
        Ok(Err(e)) => {
            if r.cancel.is_cancelled() {
                eprintln!("[widevine] {} read at {pos} stopped: mpv cancelled the stream", r.source.name());
            } else {
                eprintln!("[widevine] {} read at {pos} failed: {e:#}", r.source.name());
            }
            -1
        }
        Err(_) => {
            eprintln!("[widevine] {} read at {pos} panicked", r.source.name());
            -1
        }
    }
}

unsafe extern "C" fn seek(cookie: *mut c_void, offset: i64) -> i64 {
    let r = reader(cookie);
    if offset < 0 || offset as u64 > r.source.total() {
        return sys::mpv_error_MPV_ERROR_GENERIC as i64;
    }
    r.pos.store(offset as u64, Ordering::SeqCst);
    offset
}

unsafe extern "C" fn size(cookie: *mut c_void) -> i64 {
    reader(cookie).source.total() as i64
}

unsafe extern "C" fn cancel(cookie: *mut c_void) {
    reader(cookie).cancel.cancel();
}

unsafe extern "C" fn close(cookie: *mut c_void) {
    drop(Box::from_raw(cookie as *mut Reader));
}
