use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::PlayRequest;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<ExtPlayer<R>> {
    Ok(ExtPlayer(app.clone()))
}

/// Desktop stub. Desktop playback uses the embedded mpv player, not an external app,
/// so this is a no-op — it exists only to keep the `ExtPlayerExt` API uniform.
pub struct ExtPlayer<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> ExtPlayer<R> {
    pub fn play(&self, _payload: PlayRequest) -> crate::Result<()> {
        Ok(())
    }
}
