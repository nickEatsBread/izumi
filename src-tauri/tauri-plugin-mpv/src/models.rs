use serde::{Deserialize, Serialize};

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
    /// Optional external subtitle URLs to add after load.
    #[serde(default)]
    pub subtitles: Vec<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_request_camel_case() {
        let j = r#"{"url":"http://x/v.mkv","title":"Ep 1","startPos":42.5,"subtitles":["http://x/s.ass"]}"#;
        let r: LoadRequest = serde_json::from_str(j).unwrap();
        assert_eq!(r.url, "http://x/v.mkv");
        assert_eq!(r.title.as_deref(), Some("Ep 1"));
        assert_eq!(r.start_pos, 42.5);
        assert_eq!(r.subtitles, vec!["http://x/s.ass"]);
    }

    #[test]
    fn load_request_defaults() {
        let r: LoadRequest = serde_json::from_str(r#"{"url":"u"}"#).unwrap();
        assert_eq!(r.url, "u");
        assert_eq!(r.title, None);
        assert_eq!(r.start_pos, 0.0);
        assert!(r.subtitles.is_empty());
    }

    #[test]
    fn command_request_args() {
        let r: CommandRequest = serde_json::from_str(r#"{"args":["seek","10","relative"]}"#).unwrap();
        assert_eq!(r.args, vec!["seek", "10", "relative"]);
    }

    #[test]
    fn set_request_camel_case() {
        let r: SetRequest = serde_json::from_str(r#"{"property":"pause","value":"yes"}"#).unwrap();
        assert_eq!(r.property, "pause");
        assert_eq!(r.value, "yes");
    }
}
