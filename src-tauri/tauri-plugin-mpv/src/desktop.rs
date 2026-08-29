use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::{
    AutoPipRequest, BrightnessRequest, CommandRequest, FullscreenRequest, GetRequest,
    GifSaveRequest, GifStartRequest, HapticRequest, KeepScreenAwakeRequest, LoadRequest,
    MediaSessionRequest, RenderOptsRequest, SetRequest, ThumbRequest, TransformRequest,
    ViewportRequest,
};

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
    pub fn prepare(&self) -> crate::Result<serde_json::Value> {
        Ok(serde_json::json!({ "created": false, "durationMs": 0 }))
    }

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

    pub fn set_render_opts(&self, _payload: RenderOptsRequest) -> crate::Result<serde_json::Value> {
        Ok(serde_json::json!({ "failed": [] }))
    }

    pub fn set_dolby_opts(&self, _payload: RenderOptsRequest) -> crate::Result<serde_json::Value> {
        Ok(serde_json::json!({ "failed": [] }))
    }

    pub fn dolby_capabilities(&self) -> crate::Result<serde_json::Value> {
        Ok(serde_json::json!({
            "platform": std::env::consts::OS,
            "engine": "desktop-stub",
            "audioConfidence": "unknown"
        }))
    }

    pub fn stop(&self) -> crate::Result<()> {
        Ok(())
    }

    pub fn pip(&self) -> crate::Result<()> {
        Ok(())
    }

    pub fn auto_pip(&self, _payload: AutoPipRequest) -> crate::Result<()> {
        Ok(())
    }

    pub fn media_session(&self, _payload: MediaSessionRequest) -> crate::Result<()> {
        Ok(())
    }

    pub fn request_notifications(&self) -> crate::Result<serde_json::Value> {
        Ok(serde_json::json!({ "granted": false }))
    }

    pub fn viewport(&self, _payload: ViewportRequest) -> crate::Result<serde_json::Value> {
        Ok(serde_json::json!({ "top": 0, "right": 0, "bottom": 0, "left": 0 }))
    }

    pub fn fullscreen(&self, _payload: FullscreenRequest) -> crate::Result<()> {
        Ok(())
    }

    pub fn keep_screen_awake(&self, _payload: KeepScreenAwakeRequest) -> crate::Result<()> {
        Ok(())
    }

    pub fn transform(&self, _payload: TransformRequest) -> crate::Result<()> {
        Ok(())
    }

    pub fn brightness(&self, _payload: BrightnessRequest) -> crate::Result<()> {
        Ok(())
    }

    pub fn haptic(&self, _payload: HapticRequest) -> crate::Result<()> {
        Ok(())
    }

    pub fn thumb(&self, _payload: ThumbRequest) -> crate::Result<serde_json::Value> {
        Ok(serde_json::Value::Null)
    }

    pub fn snapshot(&self) -> crate::Result<serde_json::Value> {
        Ok(serde_json::Value::Null)
    }

    pub fn gif_start(&self, _payload: GifStartRequest) -> crate::Result<()> {
        Ok(())
    }

    pub fn gif_stop(&self) -> crate::Result<serde_json::Value> {
        Ok(serde_json::Value::Null)
    }

    pub fn gif_abort(&self) -> crate::Result<()> {
        Ok(())
    }

    pub fn gif_save(&self, _payload: GifSaveRequest) -> crate::Result<serde_json::Value> {
        Ok(serde_json::Value::Null)
    }
}
