/// The source between `start` and the first `end` after it.
fn section<'a>(source: &'a str, start: &str, end: &str) -> &'a str {
    let from = source.find(start).unwrap_or_else(|| panic!("missing {start}"));
    let rest = &source[from..];
    let to = rest[start.len()..].find(end).map_or(rest.len(), |i| i + start.len());
    &rest[..to]
}

#[test]
fn desktop_keeps_dolby_policy_separate_and_reloads_audio_only_when_asked() {
    let player = include_str!("../src/player/mod.rs");
    assert!(player.contains("static DOLBY_OPTS"));
    assert!(
        player
            .matches("if let Ok(opts) = DOLBY_OPTS.lock()")
            .count()
            >= 2
    );
    // A speed change can push this policy. A forced ao-reload throws the buffered audio away,
    // so it must sit behind the explicit route-change flag, never behind "an audio-* key was sent".
    let set = section(player, "pub fn set_dolby_opts", "\n    pub fn ");
    assert!(set.contains("reload: bool"));
    let gate = set.find("if reload {").expect("ao-reload is gated on the reload flag");
    let reload = set.find("mpv.command(\"ao-reload\"").expect("route changes still reload");
    assert!(gate < reload);
    assert!(!set.contains("starts_with(\"audio-\")"));
    let command = section(
        include_str!("../src/lib.rs"),
        "fn player_set_dolby_opts(",
        "\n}",
    );
    assert!(command.contains("reload: Option<bool>"));
    assert!(command.contains("reload.unwrap_or(false)"));
}

#[test]
fn android_probes_the_routed_sink_instead_of_trusting_a_badge() {
    let plugin =
        include_str!("../tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt");
    for required in [
        "getDirectPlaybackSupport",
        "getAudioDevicesForAttributes",
        "DIRECT_PLAYBACK_BITSTREAM_SUPPORTED",
        "ENCODING_E_AC3_JOC",
        "ENCODING_DOLBY_TRUEHD",
        "ENCODING_DOLBY_MAT",
        "ENCODING_DTS_HD_MA",
        "ENCODING_DTS_UHD_P1",
        "registerAudioDeviceCallback",
        "fun setDolbyOpts",
        "storedDolbyOpts",
        "class DolbyOptsArgs",
    ] {
        assert!(
            plugin.contains(required),
            "missing Android Dolby contract: {}",
            required
        );
    }
}

#[test]
fn android_reloads_audio_only_when_the_route_asks() {
    let plugin =
        include_str!("../tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt");
    let set = section(plugin, "fun setDolbyOpts(", "fun encodingName(");
    assert!(set.contains("parseArgs(DolbyOptsArgs::class.java)"));
    assert!(set.contains("if (live != null && a.reload) {"));
    assert!(!set.contains("startsWith(\"audio-\")"));
    // setRenderOpts keeps its own argument class; the flag travels in a dedicated request so
    // serde cannot drop it before it reaches Kotlin.
    let models = include_str!("../tauri-plugin-mpv/src/models.rs");
    let request = section(models, "pub struct DolbyOptsRequest", "}");
    assert!(request.contains("#[serde(default)]"));
    assert!(request.contains("pub reload: bool"));
    let commands = include_str!("../tauri-plugin-mpv/src/commands.rs");
    assert!(section(commands, "async fn mpv_set_dolby_opts", "\n}").contains("DolbyOptsRequest"));
}

#[test]
fn android_has_guarded_native_hdr_surface_paths_and_profile_checks() {
    let plugin =
        include_str!("../tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt");
    assert!(plugin.contains("setOptionString(\"hwdec\", \"mediacodec-copy\")"));
    assert!(plugin.contains("MediaFormat.MIMETYPE_VIDEO_DOLBY_VISION"));
    assert!(plugin.contains("deviceSupportsNativeHdr(kind: String)"));
    assert!(plugin.contains("playerView.videoSurfaceView !is SurfaceView"));
    assert!(plugin.contains("HDR_TYPE_HDR10_PLUS"));
    assert!(plugin.contains("HDR_TYPE_HLG"));
    assert!(plugin.contains("HEVCProfileMain10HDR10Plus"));
    assert!(plugin.contains("AV1ProfileMain10"));
    assert!(plugin.contains("VP9Profile2"));
    assert!(plugin.contains("group.isTrackSupported(index)"));
    assert!(
        plugin.contains("nativeVideo?.sampleMimeType == MediaFormat.MIMETYPE_VIDEO_DOLBY_VISION")
    );
    assert!(plugin.contains("put(\"dolbyVisionNativePath\", nativeDvActive)"));
    assert!(plugin.contains("loadWithMpv(args)"));
    let gradle = include_str!("../tauri-plugin-mpv/android/build.gradle.kts");
    assert!(gradle.contains("media3-exoplayer"));
    assert!(gradle.contains("media3-ui"));
}

#[test]
fn frontend_uses_dynamic_metadata_for_hdr10_conversion() {
    let policy = include_str!("../../src/lib/player/dolby.ts");
    assert!(policy.contains("['target-colorspace-hint-mode', 'source-dynamic']"));
    assert!(policy.contains("['target-trc', 'pq']"));
    assert!(policy.contains("['target-trc', 'bt.1886']"));
}
