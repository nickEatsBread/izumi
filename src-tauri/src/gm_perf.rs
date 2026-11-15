//! Pure Game-mode performance helpers.
//!
//! Kept free of GTK/libmpv so Windows CI can test the policy without `mpv.lib`.
//! Shared by the Deck controller reader, the player and the torrent engine (including Android).

#![allow(dead_code)]

use std::num::NonZeroU32;
use std::sync::atomic::AtomicBool;

/// True between player open and stop. The Deck HID grip reader (L4/R4 = player-only actions) keys
/// its wake cadence off this so an idle browse session does not wake ~60×/s draining hidraw.
pub static PLAYER_ACTIVE: AtomicBool = AtomicBool::new(false);
/// Grip reader throttle while the player is open: display cadence keeps rear-button edges snappy.
pub const GRIP_POLL_ACTIVE_SLEEP_MS: u64 = 16;
/// Grip reader throttle while browsing: nothing consumes L4/R4, so a 200 ms wake is plenty.
pub const GRIP_POLL_IDLE_SLEEP_MS: u64 = 200;

/// How long the Deck grip reader sleeps after draining a burst of HID reports.
pub fn grip_poll_sleep_ms(player_active: bool) -> u64 {
    if player_active {
        GRIP_POLL_ACTIVE_SLEEP_MS
    } else {
        GRIP_POLL_IDLE_SLEEP_MS
    }
}

/// After the first frame, cap torrent download so piece hashing/IO does not fight the GPU.
pub const POST_START_DOWNLOAD_BPS: u32 = 4 * 1024 * 1024;

/// The Deck's compositor imports VAAPI surfaces directly into libmpv's EGL renderer. mpv's
/// `auto` policy already orders whitelisted direct methods before their copy variants and
/// retains software fallback; appending `auto-copy` is redundant. Other Linux desktops keep the
/// conservative copy path because their wider driver matrix is not Deck-qualified.
pub fn libmpv_hwdec(game_mode_wayland: bool) -> &'static str {
    if game_mode_wayland {
        "auto"
    } else {
        "auto-copy"
    }
}

/// Per-torrent peer ceiling. `None` uses librqbit's default (128). Game mode used to
/// cut this to 48; that is not needed once download is capped after the first healthy
/// frame, and it can starve a thin swarm of the peers that actually have the first pieces.
pub fn torrent_peer_limit(_game_mode: bool) -> Option<usize> {
    None
}

/// librqbit blocking-pool size. `None` uses the library default of 8.
///
/// Game mode used to pass 2. That deadlocked click-to-first-frame: mpv opens overlapping
/// range readers (start + Cues), each `spawn_blocking` wait-for-piece occupies a slot,
/// and with only two slots the incoming-piece hash/write work never runs. The HTTP
/// connections then sit in CLOSE-WAIT under an ASS loading spinner forever.
pub fn torrent_runtime_threads(_game_mode: bool) -> Option<usize> {
    None
}

/// After the first frame, and only while the playback buffer is healthy, cap download so
/// hashing/IO yields to the GPU. A stall or the pre-first-frame window keeps the user cap
/// (or unlimited).
pub fn playback_download_bps(
    user_limit: Option<NonZeroU32>,
    first_frame: bool,
    buffer_low: bool,
) -> Option<NonZeroU32> {
    if !first_frame || buffer_low {
        return user_limit;
    }
    let cap = NonZeroU32::new(POST_START_DOWNLOAD_BPS).expect("post-start cap is non-zero");
    Some(user_limit.map(|limit| limit.min(cap)).unwrap_or(cap))
}
