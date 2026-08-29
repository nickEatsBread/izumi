#[test]
fn desktop_keeps_dolby_policy_separate_and_reloads_audio() {
    let player = include_str!("../src/player/mod.rs");
    assert!(player.contains("static DOLBY_OPTS"));
    assert!(player.contains("pub fn set_dolby_opts"));
    assert!(player.contains("mpv.command(\"ao-reload\""));
    assert!(
        player
            .matches("if let Ok(opts) = DOLBY_OPTS.lock()")
            .count()
            >= 2
    );
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
        "it.key.startsWith(\"audio-\")",
    ] {
        assert!(
            plugin.contains(required),
            "missing Android Dolby contract: {}",
            required
        );
    }
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
