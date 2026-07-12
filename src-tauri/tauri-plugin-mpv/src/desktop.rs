use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::{CommandRequest, GetRequest, LoadRequest, SetRequest};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Mpv<R>> {
    Ok(Mpv(app.clone()))
}

/// Desktop stub. Desktop playback uses the embedded mpv player in `src-tauri/src/player`,
/// not this plugin, so every method is a no-op — it exists only to keep the `MpvExt` API
/// uniform across targets.
pub struct Mpv<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> Mpv<R> {
    pub fn load(&self, _payload: LoadRequest) -> crate::Result<()> {
        Ok(())
    }

    pub fn command(&self, _payload: CommandRequest) -> crate::Result<()> {
        Ok(())
    }

    pub fn get(&self, _payload: GetRequest) -> crate::Result<serde_json::Value> {
        Ok(serde_json::Value::Null)
    }

    pub fn set(&self, _payload: SetRequest) -> crate::Result<()> {
        Ok(())
    }

    pub fn stop(&self) -> crate::Result<()> {
        Ok(())
    }
}
