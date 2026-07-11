use tauri::{command, AppHandle, Runtime};

use crate::{
    models::{InstallRequest, PlayRequest},
    ExtPlayerExt, Result,
};

#[command]
pub(crate) async fn play_external<R: Runtime>(
    app: AppHandle<R>,
    payload: PlayRequest,
) -> Result<()> {
    app.extplayer().play(payload)
}

/// Hand a downloaded APK to the system package installer (Android self-update).
#[command]
pub(crate) async fn install_apk<R: Runtime>(
    app: AppHandle<R>,
    payload: InstallRequest,
) -> Result<()> {
    app.extplayer().install_apk(payload)
}
