use tauri::{command, AppHandle, Runtime};

use crate::{
    models::{
        BrowserRequest, DaLoginRequest, DaLoginResponse, DaReactRequest, DaReactionStateRequest,
        DeviceStatus, InstallRequest, PlayRequest, ReactResponse, ReactionStateResponse,
    },
    ExtPlayerExt, Result,
};

#[command]
pub(crate) async fn play_external<R: Runtime>(
    app: AppHandle<R>,
    payload: PlayRequest,
) -> Result<()> {
    app.extplayer().play(payload)
}

/// Snapshot the Android network metering and charging signals. The frontend checks this at the
/// moment external/embedded playback closes before permitting optional post-play seeding.
#[command]
pub(crate) async fn device_status<R: Runtime>(app: AppHandle<R>) -> Result<DeviceStatus> {
    app.extplayer().device_status()
}

/// Hand a downloaded APK to the system package installer (Android self-update).
#[command]
pub(crate) async fn install_apk<R: Runtime>(
    app: AppHandle<R>,
    payload: InstallRequest,
) -> Result<()> {
    app.extplayer().install_apk(payload)
}

/// Open an HTTPS authentication page using Android's browser-backed Custom Tab.
#[command]
pub(crate) async fn open_browser<R: Runtime>(
    app: AppHandle<R>,
    payload: BrowserRequest,
) -> Result<()> {
    app.extplayer().open_browser(payload)
}

/// Read reaction counts + the signed-in user's selected key (carries the native `da_session` cookie).
#[command]
pub(crate) async fn da_reaction_state<R: Runtime>(
    app: AppHandle<R>,
    payload: DaReactionStateRequest,
) -> Result<ReactionStateResponse> {
    app.extplayer().da_reaction_state(payload)
}

/// Post (or clear) a discussanime reaction authenticated by the native `da_session` cookie.
#[command]
pub(crate) async fn da_react<R: Runtime>(
    app: AppHandle<R>,
    payload: DaReactRequest,
) -> Result<ReactResponse> {
    app.extplayer().da_react(payload)
}

/// Sign in to discussanime in the in-app overlay WebView (shared cookie jar).
#[command]
pub(crate) async fn da_login<R: Runtime>(
    app: AppHandle<R>,
    payload: DaLoginRequest,
) -> Result<DaLoginResponse> {
    app.extplayer().da_login(payload)
}
