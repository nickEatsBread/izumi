use tauri::{command, AppHandle, Runtime};

use crate::{
    models::{
        AutoPipRequest, BrightnessRequest, CommandRequest, FullscreenRequest, GetRequest,
        GifSaveRequest, GifStartRequest, HapticRequest, KeepScreenAwakeRequest, LoadRequest,
        MediaSessionRequest, SetRequest, ThumbRequest, TransformRequest, ViewportRequest,
    },
    MpvExt, Result,
};

#[command]
pub(crate) async fn mpv_prepare<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.mpv().prepare()
}

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
pub(crate) async fn mpv_auto_pip<R: Runtime>(
    app: AppHandle<R>,
    payload: AutoPipRequest,
) -> Result<()> {
    app.mpv().auto_pip(payload)
}

#[command]
pub(crate) async fn mpv_media_session<R: Runtime>(
    app: AppHandle<R>,
    payload: MediaSessionRequest,
) -> Result<()> {
    app.mpv().media_session(payload)
}

#[command]
pub(crate) async fn mpv_request_notifications<R: Runtime>(
    app: AppHandle<R>,
) -> Result<serde_json::Value> {
    app.mpv().request_notifications()
}

#[command]
pub(crate) async fn mpv_viewport<R: Runtime>(
    app: AppHandle<R>,
    payload: ViewportRequest,
) -> Result<serde_json::Value> {
    app.mpv().viewport(payload)
}

#[command]
pub(crate) async fn mpv_fullscreen<R: Runtime>(
    app: AppHandle<R>,
    payload: FullscreenRequest,
) -> Result<()> {
    app.mpv().fullscreen(payload)
}

#[command]
pub(crate) async fn mpv_keep_screen_awake<R: Runtime>(
    app: AppHandle<R>,
    payload: KeepScreenAwakeRequest,
) -> Result<()> {
    app.mpv().keep_screen_awake(payload)
}

#[command]
pub(crate) async fn mpv_transform<R: Runtime>(
    app: AppHandle<R>,
    payload: TransformRequest,
) -> Result<()> {
    app.mpv().transform(payload)
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

#[command]
pub(crate) async fn mpv_gif_start<R: Runtime>(
    app: AppHandle<R>,
    payload: GifStartRequest,
) -> Result<()> {
    app.mpv().gif_start(payload)
}

#[command]
pub(crate) async fn mpv_gif_stop<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.mpv().gif_stop()
}

#[command]
pub(crate) async fn mpv_gif_abort<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.mpv().gif_abort()
}

#[command]
pub(crate) async fn mpv_gif_save<R: Runtime>(
    app: AppHandle<R>,
    payload: GifSaveRequest,
) -> Result<serde_json::Value> {
    app.mpv().gif_save(payload)
}
