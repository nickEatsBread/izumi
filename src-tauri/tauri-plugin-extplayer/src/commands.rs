use tauri::{command, AppHandle, Runtime};

use crate::{
    models::{DeviceStatus, InstallRequest, PlayRequest},
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
