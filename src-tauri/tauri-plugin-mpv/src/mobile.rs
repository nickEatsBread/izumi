use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{CommandRequest, GetRequest, LoadRequest, SetRequest};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.izumi.mpv";

// Only Android is a supported mobile target for this plugin (iOS is out of scope).
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Mpv<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "MpvPlugin")?;
    Ok(Mpv(handle))
}

/// Bridge to the Kotlin `MpvPlugin` (embedded libmpv into a SurfaceView).
pub struct Mpv<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Mpv<R> {
    pub fn load(&self, payload: LoadRequest) -> crate::Result<()> {
        self.0.run_mobile_plugin("load", payload).map_err(Into::into)
    }

    pub fn command(&self, payload: CommandRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("command", payload)
            .map_err(Into::into)
    }

    pub fn get(&self, payload: GetRequest) -> crate::Result<serde_json::Value> {
        self.0.run_mobile_plugin("get", payload).map_err(Into::into)
    }

    pub fn set(&self, payload: SetRequest) -> crate::Result<()> {
        self.0.run_mobile_plugin("set", payload).map_err(Into::into)
    }

    pub fn stop(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("stop", ()).map_err(Into::into)
    }
}
