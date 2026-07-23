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
    BrightnessRequest, CommandRequest, GetRequest, HapticRequest, LoadRequest, SetRequest,
    ThumbRequest, TransformRequest, ViewportRequest,
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
            commands::mpv_load,
            commands::mpv_command,
            commands::mpv_get,
            commands::mpv_set,
            commands::mpv_stop,
            commands::mpv_pip,
            commands::mpv_viewport,
            commands::mpv_fullscreen,
            commands::mpv_transform,
            commands::mpv_brightness,
            commands::mpv_haptic,
            commands::mpv_thumb
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
