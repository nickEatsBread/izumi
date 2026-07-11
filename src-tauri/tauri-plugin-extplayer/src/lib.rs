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
pub use models::PlayRequest;

#[cfg(desktop)]
use desktop::ExtPlayer;
#[cfg(mobile)]
use mobile::ExtPlayer;

/// Access the external-player API from an `AppHandle`/`Manager`.
pub trait ExtPlayerExt<R: Runtime> {
    fn extplayer(&self) -> &ExtPlayer<R>;
}

impl<R: Runtime, T: Manager<R>> ExtPlayerExt<R> for T {
    fn extplayer(&self) -> &ExtPlayer<R> {
        self.state::<ExtPlayer<R>>().inner()
    }
}

/// Register the plugin. On Android this bridges `play_external` to the Kotlin
/// `ExtPlayerPlugin.play` (an ACTION_VIEW chooser); on desktop it's a no-op.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("extplayer")
        .invoke_handler(tauri::generate_handler![commands::play_external])
        .setup(|app, api| {
            #[cfg(mobile)]
            let extplayer = mobile::init(app, api)?;
            #[cfg(desktop)]
            let extplayer = desktop::init(app, api)?;
            app.manage(extplayer);
            Ok(())
        })
        .build()
}
