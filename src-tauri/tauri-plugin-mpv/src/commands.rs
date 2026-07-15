use tauri::{command, AppHandle, Runtime};

use crate::{
    models::{
        BrightnessRequest, CommandRequest, GetRequest, HapticRequest, LoadRequest, SetRequest,
        ThumbRequest,
    },
    MpvExt, Result,
};

#[command]
pub(crate) async fn mpv_load<R: Runtime>(app: AppHandle<R>, payload: LoadRequest) -> Result<()> {
    app.mpv().load(payload)
}

#[command]
pub(crate) async fn mpv_command<R: Runtime>(
    app: AppHandle<R>,
    payload: CommandRequest,
) -> Result<()> {
    app.mpv().command(payload)
}

#[command]
pub(crate) async fn mpv_get<R: Runtime>(
    app: AppHandle<R>,
    payload: GetRequest,
) -> Result<serde_json::Value> {
    app.mpv().get(payload)
}

#[command]
pub(crate) async fn mpv_set<R: Runtime>(app: AppHandle<R>, payload: SetRequest) -> Result<()> {
    app.mpv().set(payload)
}

#[command]
pub(crate) async fn mpv_stop<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.mpv().stop()
}

#[command]
pub(crate) async fn mpv_pip<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.mpv().pip()
}

#[command]
pub(crate) async fn mpv_brightness<R: Runtime>(
    app: AppHandle<R>,
    payload: BrightnessRequest,
) -> Result<()> {
    app.mpv().brightness(payload)
}

#[command]
pub(crate) async fn mpv_haptic<R: Runtime>(
    app: AppHandle<R>,
    payload: HapticRequest,
) -> Result<()> {
    app.mpv().haptic(payload)
}

#[command]
pub(crate) async fn mpv_thumb<R: Runtime>(
    app: AppHandle<R>,
    payload: ThumbRequest,
) -> Result<serde_json::Value> {
    app.mpv().thumb(payload)
}
