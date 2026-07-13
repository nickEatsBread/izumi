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
pub use models::{InstallRequest, OAuthRequest, OAuthResponse, PlayRequest};

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

/// Register the plugin. On Android this bridges `play_external`/`install_apk` to the
/// Kotlin `ExtPlayerPlugin` (an ACTION_VIEW chooser + the package installer); on desktop
/// both are no-ops.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("extplayer")
        .invoke_handler(tauri::generate_handler![
            commands::play_external,
            commands::install_apk
        ])
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
