//! Player bridge over libmpv2.
//!
//! This is the first real slice of the player: it can open libmpv's own
//! (mpv-managed) window and play a URL with audio. Later tasks will replace
//! the "own window" path with the render API + GL overlay embedded in the
//! Tauri webview, but the `PlayerHandle` / owned-`Mpv` lifetime model here is
//! meant to be reused.
//!
//! ## Send/Sync approach
//! `libmpv2::Mpv` declares `unsafe impl Send for Mpv {}` and
//! `unsafe impl Sync for Mpv {}` (see libmpv2 6.0.0 `src/mpv.rs`), so a plain
//! `Mutex<Option<Mpv>>` is `Send + Sync` and satisfies Tauri's `State`
//! requirements directly. No dedicated OS thread / mpsc channel is needed.

use std::sync::Mutex;

use libmpv2::Mpv;

/// Holds the live mpv instance behind a mutex so it is kept alive for the
/// lifetime of the app. Dropping the `Mpv` destroys the mpv core and closes
/// its window, so we must retain it in state.
pub struct PlayerHandle {
    mpv: Mutex<Option<Mpv>>,
}

impl PlayerHandle {
    /// Create an empty handle. No mpv core exists until the first playback.
    pub fn new() -> Self {
        PlayerHandle {
            mpv: Mutex::new(None),
        }
    }

    /// Open (or reuse) an mpv instance that manages its own window and start
    /// playing `url`.
    ///
    /// Video-output options (`vo`, `hwdec`) are set *before* initialization via
    /// `with_initializer`, because mpv only applies these at init time. We try
    /// `vo=gpu-next` first and transparently fall back to `vo=gpu` if creating
    /// the context with `gpu-next` fails.
    pub fn play_own_window(&self, url: &str) -> Result<(), String> {
        let mut guard = self.mpv.lock().map_err(|e| e.to_string())?;

        // If we already have an mpv core, just queue the new file into its
        // existing window.
        if let Some(mpv) = guard.as_ref() {
            mpv.command("loadfile", &[url])
                .map_err(|e| e.to_string())?;
            return Ok(());
        }

        // First launch: build a fresh mpv core with good defaults.
        let mpv = create_mpv().map_err(|e| e.to_string())?;

        mpv.command("loadfile", &[url])
            .map_err(|e| e.to_string())?;

        *guard = Some(mpv);
        Ok(())
    }
}

impl Default for PlayerHandle {
    fn default() -> Self {
        Self::new()
    }
}

/// Build an initialized `Mpv` with an own window and good defaults, preferring
/// `vo=gpu-next` and falling back to `vo=gpu`.
fn create_mpv() -> Result<Mpv, libmpv2::Error> {
    match new_mpv_with_vo("gpu-next") {
        Ok(mpv) => Ok(mpv),
        Err(_) => new_mpv_with_vo("gpu"),
    }
}

/// Create an mpv instance using the given video output driver. All the
/// window/vo/hwdec options are set before `mpv_initialize` runs.
fn new_mpv_with_vo(vo: &str) -> Result<Mpv, libmpv2::Error> {
    Mpv::with_initializer(|init| {
        // Make an actual window appear even before/without video geometry info.
        init.set_option("force-window", "yes")?;
        // Preferred GPU video output.
        init.set_option("vo", vo)?;
        // Safe hardware decoding (won't engage decoders known to be flaky).
        init.set_option("hwdec", "auto-safe")?;
        Ok(())
    })
}
