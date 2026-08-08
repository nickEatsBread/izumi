use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleRequest {
    pub url: String,
    pub title: Option<String>,
    pub lang: Option<String>,
    #[serde(default)]
    pub selected: bool,
}

/// Load a stream (or local file) into the embedded player.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadRequest {
    /// A remote URL or an absolute local file path.
    pub url: String,
    /// Display title (shown in any player OSD).
    pub title: Option<String>,
    /// Resume position in seconds (0 = start).
    #[serde(default)]
    pub start_pos: f64,
    /// Optional external subtitle tracks to add after load.
    #[serde(default)]
    pub subtitles: Vec<SubtitleRequest>,
    /// Preferred mpv audio/subtitle language codes.
    pub alang: Option<String>,
    pub slang: Option<String>,
    /// HTTP headers shared by the video and sidecar requests.
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
}

/// A raw mpv command, e.g. ["seek","10","relative"] or ["set","pause","yes"].
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CommandRequest {
    pub args: Vec<String>,
}

/// Read a single mpv property as a string.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GetRequest {
    pub property: String,
}

/// Set a single mpv property from a string value.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRequest {
    pub property: String,
    pub value: String,
}

/// Set screen brightness (0.0..1.0), or -1.0 to restore system/auto brightness.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BrightnessRequest {
    pub value: f64,
}

/// Fire a short haptic pulse of the given duration in milliseconds.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HapticRequest {
    pub ms: u32,
}

/// Position the native video surface and toggle immersive system bars.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ViewportRequest {
    /// Physical pixels from the top of the activity content.
    pub top: i32,
    /// Physical pixel height. Zero fills the activity.
    pub height: i32,
    pub immersive: bool,
}

/// Lock playback to landscape, or return to the normal portrait watch page.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FullscreenRequest {
    pub enabled: bool,
}

/// Hold (or release) the display while video is actually playing. The Kotlin side owns both
/// halves — `View.keepScreenOn` on the surface container plus `FLAG_KEEP_SCREEN_ON` on the
/// window — so this only carries the desired state.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KeepScreenAwakeRequest {
    pub enabled: bool,
}

/// Live scale + vertical translate for the portrait pull-to-fullscreen gesture. `scale` is a unitless
/// view scale (1.0 = resting 16:9); `translate_y` is physical pixels (negative = up).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformRequest {
    pub scale: f64,
    pub translate_y: i32,
}

/// Grab a preview frame from a stream at `time_sec`, scaled to `width` px wide.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbRequest {
    pub url: String,
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
    pub time_sec: f64,
    #[serde(default = "default_thumb_width")]
    pub width: u32,
}

fn default_thumb_width() -> u32 {
    320
}

/// Arm (or disarm) automatic picture-in-picture when the user leaves the app while playing.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AutoPipRequest {
    pub enabled: bool,
}

/// Publish (or tear down) the lock-screen / notification-shade media transport.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSessionRequest {
    /// False removes the session and its notification.
    pub enabled: bool,
    /// Primary line — the series.
    #[serde(default)]
    pub title: String,
    /// Secondary line — the episode.
    #[serde(default)]
    pub subtitle: String,
    /// Poster URL, fetched natively for the transport artwork.
    pub artwork: Option<String>,
    #[serde(default)]
    pub has_prev: bool,
    #[serde(default)]
    pub has_next: bool,
}

/// Begin capturing GIF frames from the live core.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GifStartRequest {
    /// Burn the displayed subtitle track into the captured frames.
    #[serde(default)]
    pub include_subtitles: bool,
}

/// Publish an encoded GIF to the gallery and delete the working files.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GifSaveRequest {
    /// Absolute path of the encoded `.gif` produced by `android_gif_encode`.
    pub path: String,
    /// Frame directory to remove once the GIF has been published.
    pub cleanup_dir: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_request_camel_case() {
        let j = r#"{"url":"http://x/v.mkv","title":"Ep 1","startPos":42.5,"subtitles":[{"url":"http://x/s.ass","title":"English","lang":"eng","selected":true}],"alang":"jpn","slang":"eng","headers":{"Referer":"https://x/"}}"#;
        let r: LoadRequest = serde_json::from_str(j).unwrap();
        assert_eq!(r.url, "http://x/v.mkv");
        assert_eq!(r.title.as_deref(), Some("Ep 1"));
        assert_eq!(r.start_pos, 42.5);
        assert_eq!(r.subtitles[0].url, "http://x/s.ass");
        assert_eq!(r.subtitles[0].lang.as_deref(), Some("eng"));
        assert!(r.subtitles[0].selected);
        assert_eq!(r.slang.as_deref(), Some("eng"));
        assert_eq!(r.headers.get("Referer").map(String::as_str), Some("https://x/"));
    }

    #[test]
    fn load_request_defaults() {
        let r: LoadRequest = serde_json::from_str(r#"{"url":"u"}"#).unwrap();
        assert_eq!(r.url, "u");
        assert_eq!(r.title, None);
        assert_eq!(r.start_pos, 0.0);
        assert!(r.subtitles.is_empty());
        assert!(r.headers.is_empty());
    }

    #[test]
    fn command_request_args() {
        let r: CommandRequest =
            serde_json::from_str(r#"{"args":["seek","10","relative"]}"#).unwrap();
        assert_eq!(r.args, vec!["seek", "10", "relative"]);
    }

    #[test]
    fn set_request_camel_case() {
        let r: SetRequest = serde_json::from_str(r#"{"property":"pause","value":"yes"}"#).unwrap();
        assert_eq!(r.property, "pause");
        assert_eq!(r.value, "yes");
    }

    #[test]
    fn viewport_request_deserializes() {
        let r: ViewportRequest =
            serde_json::from_str(r#"{"top":12,"height":1080,"immersive":false}"#).unwrap();
        assert_eq!(r.top, 12);
        assert_eq!(r.height, 1080);
        assert!(!r.immersive);
    }

    #[test]
    fn fullscreen_request_deserializes() {
        let r: FullscreenRequest = serde_json::from_str(r#"{"enabled":true}"#).unwrap();
        assert!(r.enabled);
    }

    #[test]
    fn keep_screen_awake_request_deserializes() {
        let r: KeepScreenAwakeRequest = serde_json::from_str(r#"{"enabled":true}"#).unwrap();
        assert!(r.enabled);
    }

    #[test]
    fn auto_pip_request_deserializes() {
        let r: AutoPipRequest = serde_json::from_str(r#"{"enabled":false}"#).unwrap();
        assert!(!r.enabled);
    }

    #[test]
    fn media_session_request_camel_case() {
        let j = r#"{"enabled":true,"title":"Frieren","subtitle":"Episode 4","artwork":"https://x/p.jpg","hasPrev":true,"hasNext":false}"#;
        let r: MediaSessionRequest = serde_json::from_str(j).unwrap();
        assert!(r.enabled);
        assert_eq!(r.title, "Frieren");
        assert_eq!(r.subtitle, "Episode 4");
        assert_eq!(r.artwork.as_deref(), Some("https://x/p.jpg"));
        assert!(r.has_prev);
        assert!(!r.has_next);
    }

    #[test]
    fn media_session_request_teardown_defaults() {
        let r: MediaSessionRequest = serde_json::from_str(r#"{"enabled":false}"#).unwrap();
        assert!(!r.enabled);
        assert!(r.title.is_empty());
        assert_eq!(r.artwork, None);
        assert!(!r.has_next);
    }
}
