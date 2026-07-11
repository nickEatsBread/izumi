use tauri::{command, AppHandle, Runtime};

use crate::{models::PlayRequest, ExtPlayerExt, Result};

#[command]
pub(crate) async fn play_external<R: Runtime>(
    app: AppHandle<R>,
    payload: PlayRequest,
) -> Result<()> {
    app.extplayer().play(payload)
}
