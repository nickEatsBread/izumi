use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{
    AutoPipRequest, BrightnessRequest, CommandRequest, FullscreenRequest, GetRequest,
    GifSaveRequest, GifStartRequest, HapticRequest, KeepScreenAwakeRequest, LoadRequest,
    MediaSessionRequest, RenderOptsRequest, SetRequest, ThumbRequest, TransformRequest,
    ViewportRequest,
};

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
    pub fn prepare(&self) -> crate::Result<serde_json::Value> {
        self.0.run_mobile_plugin("prepare", ()).map_err(Into::into)
    }

    pub fn load(&self, payload: LoadRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("load", payload)
            .map_err(Into::into)
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

    pub fn set_render_opts(&self, payload: RenderOptsRequest) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("setRenderOpts", payload)
            .map_err(Into::into)
    }

    pub fn stop(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("stop", ()).map_err(Into::into)
    }

    pub fn pip(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("pip", ()).map_err(Into::into)
    }

    pub fn auto_pip(&self, payload: AutoPipRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("autoPip", payload)
            .map_err(Into::into)
    }

    pub fn media_session(&self, payload: MediaSessionRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("mediaSession", payload)
            .map_err(Into::into)
    }

    /// Resolves `{ granted }` — POST_NOTIFICATIONS, without which the media transport is hidden.
    pub fn request_notifications(&self) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("requestNotifications", ())
            .map_err(Into::into)
    }

    pub fn viewport(&self, payload: ViewportRequest) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("viewport", payload)
            .map_err(Into::into)
    }

    pub fn fullscreen(&self, payload: FullscreenRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("fullscreen", payload)
            .map_err(Into::into)
    }

    // The Kotlin method is `keepScreenAwake`; `run_mobile_plugin` matches the native method name
    // verbatim, so this string must stay camelCase even though the Rust command is snake_case.
    pub fn keep_screen_awake(&self, payload: KeepScreenAwakeRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("keepScreenAwake", payload)
            .map_err(Into::into)
    }

    pub fn transform(&self, payload: TransformRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("transform", payload)
            .map_err(Into::into)
    }

    pub fn brightness(&self, payload: BrightnessRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("brightness", payload)
            .map_err(Into::into)
    }

    pub fn haptic(&self, payload: HapticRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("haptic", payload)
            .map_err(Into::into)
    }

    pub fn thumb(&self, payload: ThumbRequest) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("thumb", payload)
            .map_err(Into::into)
    }

    pub fn snapshot(&self) -> crate::Result<serde_json::Value> {
        self.0.run_mobile_plugin("snapshot", ()).map_err(Into::into)
    }

    pub fn gif_start(&self, payload: GifStartRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("gifStart", payload)
            .map_err(Into::into)
    }

    /// Resolves `{ dir, frames, capturedMs }` — the captured frame directory, ready to encode.
    pub fn gif_stop(&self) -> crate::Result<serde_json::Value> {
        self.0.run_mobile_plugin("gifStop", ()).map_err(Into::into)
    }

    pub fn gif_abort(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("gifAbort", ()).map_err(Into::into)
    }

    /// Resolves `{ name, location }` once the GIF has been published to the gallery.
    pub fn gif_save(&self, payload: GifSaveRequest) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("gifSave", payload)
            .map_err(Into::into)
    }
}
