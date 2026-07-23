use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{
    BrowserRequest, DaLoginRequest, DaLoginResponse, DaReactRequest, DaReactionStateRequest,
    DeviceStatus, InstallRequest, LanDiscoveryRequest, OAuthRequest, OAuthResponse, PlayRequest,
    ReactResponse, ReactionStateResponse,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.izumi.extplayer";

// Only Android is a supported mobile target for this plugin (iOS is out of scope).
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<ExtPlayer<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "ExtPlayerPlugin")?;
    Ok(ExtPlayer(handle))
}

pub struct ExtPlayer<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ExtPlayer<R> {
    pub fn play(&self, payload: PlayRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("play", payload)
            .map_err(Into::into)
    }

    pub fn install_apk(&self, payload: InstallRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("installApk", payload)
            .map_err(Into::into)
    }

    pub fn open_browser(&self, payload: BrowserRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("openBrowser", payload)
            .map_err(Into::into)
    }

    pub fn device_status(&self) -> crate::Result<DeviceStatus> {
        self.0
            .run_mobile_plugin("deviceStatus", ())
            .map_err(Into::into)
    }

    pub fn set_lan_discovery(&self, payload: LanDiscoveryRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("setLanDiscovery", payload)
            .map_err(Into::into)
    }

    pub fn oauth_capture(&self, payload: OAuthRequest) -> crate::Result<OAuthResponse> {
        self.0
            .run_mobile_plugin("oauthCapture", payload)
            .map_err(Into::into)
    }

    pub fn da_reaction_state(
        &self,
        payload: DaReactionStateRequest,
    ) -> crate::Result<ReactionStateResponse> {
        self.0
            .run_mobile_plugin("daReactionState", payload)
            .map_err(Into::into)
    }

    pub fn da_react(&self, payload: DaReactRequest) -> crate::Result<ReactResponse> {
        self.0
            .run_mobile_plugin("daReact", payload)
            .map_err(Into::into)
    }

    pub fn da_login(&self, payload: DaLoginRequest) -> crate::Result<DaLoginResponse> {
        self.0
            .run_mobile_plugin("daLogin", payload)
            .map_err(Into::into)
    }
}
