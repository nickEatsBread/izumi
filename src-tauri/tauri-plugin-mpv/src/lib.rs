use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod models;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

pub use error::{Error, Result};
pub use models::{
    AutoPipRequest, BrightnessRequest, CommandRequest, GetRequest, GifSaveRequest, GifStartRequest,
    HapticRequest, LoadRequest, MediaSessionRequest, RenderOpt, RenderOptsRequest, SetRequest,
    SubtitleRequest, ThumbRequest, TransformRequest, ViewportRequest,
};

#[cfg(desktop)]
use desktop::Mpv;
#[cfg(mobile)]
use mobile::Mpv;

/// Access the embedded-player API from an `AppHandle`/`Manager`.
pub trait MpvExt<R: Runtime> {
    fn mpv(&self) -> &Mpv<R>;
}

impl<R: Runtime, T: Manager<R>> MpvExt<R> for T {
    fn mpv(&self) -> &Mpv<R> {
        self.state::<Mpv<R>>().inner()
    }
}

/// Register the plugin. On Android this bridges the `mpv_*` commands to the Kotlin
/// `MpvPlugin` (libmpv rendering into a SurfaceView beneath the transparent WebView);
/// on desktop every command is a no-op (desktop uses the embedded mpv in `src/player`).
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mpv")
        .invoke_handler(tauri::generate_handler![
            commands::mpv_prepare,
            commands::mpv_load,
            commands::mpv_command,
            commands::mpv_get,
            commands::mpv_set,
            commands::mpv_set_render_opts,
            commands::mpv_stop,
            commands::mpv_pip,
            commands::mpv_auto_pip,
            commands::mpv_media_session,
            commands::mpv_request_notifications,
            commands::mpv_viewport,
            commands::mpv_fullscreen,
            commands::mpv_keep_screen_awake,
            commands::mpv_transform,
            commands::mpv_brightness,
            commands::mpv_haptic,
            commands::mpv_thumb,
            commands::mpv_gif_start,
            commands::mpv_gif_stop,
            commands::mpv_gif_abort,
            commands::mpv_gif_save
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let mpv = mobile::init(app, api)?;
            #[cfg(desktop)]
            let mpv = desktop::init(app, api)?;
            app.manage(mpv);
            Ok(())
        })
        .build()
}
