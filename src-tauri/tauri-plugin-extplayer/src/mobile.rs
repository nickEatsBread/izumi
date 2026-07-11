use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::PlayRequest;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.izumi.extplayer";

// Only Android is a supported mobile target for this plugin (iOS is out of scope).
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<ExtPlayer<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "ExtPlayerPlugin")?;
    Ok(ExtPlayer(handle))
}

pub struct ExtPlayer<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ExtPlayer<R> {
    pub fn play(&self, payload: PlayRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("play", payload)
            .map_err(Into::into)
    }
}
