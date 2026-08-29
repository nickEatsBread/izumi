package app.izumi.mpv

import android.Manifest
import android.app.Activity
import android.app.Application
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaMetadataRetriever
import android.media.MediaFormat
import android.net.Uri
import android.content.pm.ActivityInfo
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.util.Rational
import org.json.JSONArray
import android.view.OrientationEventListener
import android.view.Display
import android.view.PixelCopy
import android.view.SurfaceView
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.core.content.ContextCompat
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import dev.jdtech.mpv.MPVLib
import kotlin.math.max

@InvokeArg
class SubtitleArgs {
    var url: String = ""
    var title: String? = null
    var lang: String? = null
    var selected: Boolean = false
}

@InvokeArg
class LoadArgs {
    var url: String = ""
    var title: String? = null
    var startPos: Double = 0.0
    var subtitles: Array<SubtitleArgs> = arrayOf()
    var alang: String? = null
    var slang: String? = null
    var headers: Map<String, String> = emptyMap()
    var autoplay: Boolean = true
    /** Request direct MediaCodec/SurfaceView playback for a known HDR source. The native side
     * still verifies the current display and a matching 10-bit/Dolby Vision decoder. */
    var preferNativeHdr: String? = null
}

private data class PendingSubtitles(
    val url: String,
    val tracks: Array<SubtitleArgs>,
)

private data class NativeTrack(
    val id: Int,
    val type: Int,
    val group: androidx.media3.common.TrackGroup,
    val index: Int,
    val format: Format,
    val selected: Boolean,
)

@InvokeArg
class CommandArgs {
    var args: Array<String> = arrayOf()
}

@InvokeArg
class GetArgs {
    var property: String = ""
}

@InvokeArg
class SetArgs {
    var property: String = ""
    var value: String = ""
}

@InvokeArg
class RenderOpt {
    var key: String = ""
    var value: String = ""
}

@InvokeArg
class RenderOptsArgs {
    var opts: Array<RenderOpt> = arrayOf()
}

@InvokeArg
class BrightnessArgs {
    var value: Double = -1.0
}

@InvokeArg
class KeepScreenAwakeArgs {
    var enabled: Boolean = false
}

@InvokeArg
class HapticArgs {
    var ms: Int = 20
}

@InvokeArg
class ThumbArgs {
    var url: String = ""
    var headers: Map<String, String> = emptyMap()
    var timeSec: Double = 0.0
    var width: Int = 320
}

@InvokeArg
class ViewportArgs {
    /** Physical pixels from the top of the activity content. */
    var top: Int = 0
    /** Physical pixel height. Zero means fill the activity. */
    var height: Int = 0
    var immersive: Boolean = false
    var left: Int = 0
    /** Physical pixel width. Zero means fill the activity. */
    var width: Int = 0
    /** The in-app mini-player must sit above the now-visible browse WebView. */
    var floating: Boolean = false
}

@InvokeArg
class FullscreenArgs {
    var enabled: Boolean = false
}

@InvokeArg
class TransformArgs {
    /** Unitless player-container scale (1.0 = resting 16:9). */
    var scale: Double = 1.0
    /** Vertical translate in physical pixels (negative = up). */
    var translateY: Int = 0
    var translateX: Int = 0
    /** Raise a shrinking in-app mini-player above the browse WebView. */
    var floating: Boolean = false
}

@InvokeArg
class AutoPipArgs {
    /** Enter the miniplayer automatically when the user leaves the app while a video is playing. */
    var enabled: Boolean = true
}

@InvokeArg
class MediaSessionArgs {
    /** False tears the session + notification down (playback stopped / left the player). */
    var enabled: Boolean = true
    /** Primary line — the series. */
    var title: String = ""
    /** Secondary line — the episode. */
    var subtitle: String = ""
    /** Poster URL, fetched natively and shown as the transport's artwork. */
    var artwork: String? = null
    var hasPrev: Boolean = false
    var hasNext: Boolean = false
}

@InvokeArg
class GifStartArgs {
    /** Burn the displayed subtitle track into the captured frames. */
    var includeSubtitles: Boolean = false
}

@InvokeArg
class GifSaveArgs {
    /** Absolute path of the encoded .gif in the app cache. */
    var path: String = ""
    /** Frame directory to delete once the GIF has been published. */
    var cleanupDir: String? = null
}

/** A live GIF frame capture. Owned by [MpvPlugin.gifSession]; the worker only reads the flags. */
private class GifSession(val dir: File) {
    @Volatile var stop = false
    @Volatile var frames = 0
    @Volatile var capturedMs = 0L
    var thread: Thread? = null
}

/** Broadcast fired by the picture-in-picture remote action. Package-scoped, never exported. */
private const val PIP_ACTION = "app.izumi.mpv.PIP_ACTION"
private const val PIP_EXTRA_CODE = "code"
private const val PIP_CODE_PLAY_PAUSE = 1

// A landscape-side flip crosses a portrait sensor reading briefly. Only treat portrait as an exit
// when the phone rests there; this mirrors the grace period used by touch-first video players.
private const val LANDSCAPE_PORTRAIT_DWELL_MS = 650L

// Bounds for a capture, matched to the desktop recorder so both platforms produce comparable files.
private const val GIF_FRAME_INTERVAL_MS = 50L
private const val GIF_MAX_FRAMES = 600
private const val GIF_MAX_MS = 30_000L

/**
 * Embedded libmpv player. Renders into a [IzumiMpvView] (SurfaceView) inserted behind the
 * (made-transparent) Tauri WebView, and forwards observed properties to JS as plugin events.
 * libmpv itself is thread-safe, so only view-hierarchy work (create/destroy) runs on the UI thread.
 */
@UnstableApi
@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ],
)
class MpvPlugin(private val activity: Activity) : Plugin(activity), MPVLib.EventObserver {
    private var mpv: MPVLib? = null
    private var view: IzumiMpvView? = null
    /** Genuine Android Dolby Vision path: encoded DV samples go straight from Media3/MediaCodec to
     * this Surface instead of being copied back through mpv's OpenGL renderer. */
    private var nativeDvPlayer: ExoPlayer? = null
    private var nativeDvView: PlayerView? = null
    private var nativeDvLoad: LoadArgs? = null
    private var nativeDvFirstFrame = false
    private var nativeDvSeeking = false
    private var nativeDvProgressTask: Runnable? = null
    private var nativeHdrType: String? = null
    private var preferredSubLanguage: String? = null
    private var pendingSubtitles: PendingSubtitles? = null
    /** The first load must wait for SurfaceView.surfaceCreated or mpv can initialize its VO with
     * no Android surface and remain black at 0:00 even though demuxed metadata is available. */
    private var pendingSurfaceLoad: LoadArgs? = null
    /** Clips the SurfaceView and moves with the web player shell during direct-manipulation gestures. */
    private var container: FrameLayout? = null
    private var landscapeReleaseListener: OrientationEventListener? = null
    private var landscapeReleaseTask: Runnable? = null
    /** The last viewport the web shell asked for, replayed when picture-in-picture ends. */
    private var lastViewport: ViewportArgs? = null
    /** True once Android reports the activity is actually in PiP (see [installPipWatcher]). */
    private var pipActive = false
    /** True from the moment PiP is requested until it ends — covers the transition, during which
     *  `isInPictureInPictureMode` is still false but the portrait geometry must NOT be re-applied. */
    private var pipRequested = false
    private var contentView: ViewGroup? = null
    /** Kept separately so native PiP can hide every HTML overlay even after Android freezes JS. */
    private var webView: WebView? = null
    /** Android WebView supplies its own long-press vibration before the web player's hold-to-2x
     *  gesture fires. Remember the host setting so playback can suppress that duplicate feedback
     *  without changing the rest of the app once the native player closes. */
    private var webViewHapticsWereEnabled: Boolean? = null
    private var pipLayoutListener: View.OnLayoutChangeListener? = null
    private var pipReceiver: BroadcastReceiver? = null
    /** Pre-31 auto-PiP hook, see [installAutoPipHook]. Null on API 31+, where the system does it. */
    private var autoPipCallbacks: Application.ActivityLifecycleCallbacks? = null
    private var resumeGuardCallbacks: Application.ActivityLifecycleCallbacks? = null
    /** Last applied FLAG_KEEP_SCREEN_ON state, so repeat requests skip the window relayout. */
    private var keepScreenAwakeOn = false
    private var gifSession: GifSession? = null
    /** The most recent GIF worker thread, kept after its session has been cleared: the worker calls
     *  into the LIVE core, so teardown still has to wait for it even once nothing owns the session. */
    private var gifWorker: Thread? = null
    /** User preference: enter the miniplayer automatically when leaving the app while playing. */
    private var autoPipEnabled = true
    /** Mirror of mpv's `pause`, kept from the observer so the UI thread never has to read back into
     *  libmpv just to decide whether playback is live. */
    private var corePaused = false
    /** A prepared mpv core is deliberately kept alive while browsing and after EOF. Neither state
     *  owns a video that Android may shrink into PiP, so track FILE_LOADED separately from `mpv`. */
    private var mediaLoaded = false
    private var mediaReceiver: BroadcastReceiver? = null
    /** Frontend quality-preset keys, replayed at the next `ensureCore` the same way
     *  desktop `RENDER_OPTS` is. Replaced as a whole set so leaving High clears deband. */
    private val storedRenderOpts = LinkedHashMap<String, String>()
    /** Encoded-audio transport and Dolby Vision output policy. Separate from quality because a
     * scaler preset is replaced wholesale and must never clear the receiver configuration. */
    private val storedDolbyOpts = LinkedHashMap<String, String>()
    private var audioDeviceCallback: AudioDeviceCallback? = null

    override fun load(webView: WebView) {
        if (Build.VERSION.SDK_INT >= 23 && audioDeviceCallback == null) {
            val manager = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            audioDeviceCallback = object : AudioDeviceCallback() {
                override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
                    trigger("dolby", JSObject().put("reason", "audio-route-changed"))
                }

                override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
                    trigger("dolby", JSObject().put("reason", "audio-route-changed"))
                }
            }.also { manager.registerAudioDeviceCallback(it, Handler(Looper.getMainLooper())) }
        }
    }

    private fun cancelLandscapeReleaseTask() {
        landscapeReleaseTask?.let { activity.window.decorView.removeCallbacks(it) }
        landscapeReleaseTask = null
    }

    private fun stopLandscapeReleaseListener() {
        cancelLandscapeReleaseTask()
        landscapeReleaseListener?.disable()
        landscapeReleaseListener = null
    }

    /**
     * Force the initial portrait -> landscape transition and keep the landscape family locked while
     * the phone crosses portrait on its way to the other landscape side. After it has reached either
     * landscape side, a sustained portrait reading hands orientation back to Android so a deliberate
     * turn still exits fullscreen without tapping a control.
     */
    private fun enterLandscapeWithSensorReturn() {
        stopLandscapeReleaseListener()
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        var hasReachedLandscape = false
        val listener = object : OrientationEventListener(activity) {
            override fun onOrientationChanged(orientation: Int) {
                if (orientation == ORIENTATION_UNKNOWN) {
                    cancelLandscapeReleaseTask()
                    return
                }
                val physicallyLandscape = orientation in 60..120 || orientation in 240..300
                if (physicallyLandscape) {
                    hasReachedLandscape = true
                    cancelLandscapeReleaseTask()
                    return
                }
                // Include upside-down portrait too: either path between the two landscape sides
                // should retain fullscreen as long as the device keeps moving through it.
                val physicallyPortrait = orientation <= 30 || orientation >= 330 || orientation in 150..210
                if (!hasReachedLandscape || !physicallyPortrait) {
                    cancelLandscapeReleaseTask()
                    return
                }
                if (landscapeReleaseTask != null) return
                val releaseTask = Runnable {
                    if (activity.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE) {
                        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                    }
                    stopLandscapeReleaseListener()
                }
                landscapeReleaseTask = releaseTask
                activity.window.decorView.postDelayed(releaseTask, LANDSCAPE_PORTRAIT_DWELL_MS)
            }
        }
        if (listener.canDetectOrientation()) {
            landscapeReleaseListener = listener
            listener.enable()
        }
    }

    /** Hide system bars for landscape playback and restore them for the portrait watch page/stop. */
    private fun setImmersive(on: Boolean) {
        val win = activity.window
        WindowCompat.setDecorFitsSystemWindows(win, !on)
        val ctrl = WindowInsetsControllerCompat(win, win.decorView)
        ctrl.isAppearanceLightStatusBars = false
        ctrl.isAppearanceLightNavigationBars = false
        if (on) {
            ctrl.hide(WindowInsetsCompat.Type.systemBars())
            ctrl.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
            ctrl.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun findWebView(v: View): WebView? = when {
        v is WebView -> v
        v is ViewGroup ->
            (0 until v.childCount).asSequence().mapNotNull { findWebView(v.getChildAt(it)) }.firstOrNull()
        else -> null
    }

    /**
     * Stage izumi's bundled subtitle fonts where libass can see them and return that directory.
     *
     * Android has no Nunito, and `config=no` (below) also disables mpv's `subfont.ttf` lookup, so the
     * app's default subtitle font could never resolve here — the appearance settings looked broken
     * even once they were being applied. `sub-fonts-dir` is ADDITIVE: the platform font provider
     * still supplies the device's own families (and CJK coverage) on top of these.
     *
     * Returns null when no fonts are bundled (the assets directory is populated at build time), in
     * which case mpv is left on its own defaults.
     */
    private fun prepareFontsDir(): String? {
        return try {
            val names = activity.assets.list("fonts")?.filter {
                it.endsWith(".ttf", true) || it.endsWith(".otf", true) || it.endsWith(".ttc", true)
            }.orEmpty()
            if (names.isEmpty()) return null
            val dir = File(activity.filesDir, "mpv-fonts")
            dir.mkdirs()
            // Assets only change with a reinstall/update, and they are stored compressed (so their
            // uncompressed size isn't cheaply readable) — stamp the copy with the build instead.
            val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
            @Suppress("DEPRECATION")
            val build = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
            // Kept OUTSIDE the fonts directory — libass scans everything in there.
            val stamp = File(activity.filesDir, "mpv-fonts.stamp")
            val want = "$build|${names.sorted().joinToString(",")}"
            if (stamp.isFile && stamp.readText() == want) return dir.absolutePath
            for (name in names) {
                activity.assets.open("fonts/$name").use { input ->
                    File(dir, name).outputStream().use { input.copyTo(it) }
                }
            }
            stamp.writeText(want)
            dir.absolutePath
        } catch (e: Exception) {
            Log.w("MpvPlugin", "subtitle fonts unavailable: ${e.message}")
            null
        }
    }

    /** Create and configure libmpv without touching the view hierarchy. UI thread only. */
    private fun ensureCore(): MPVLib {
        mpv?.let { return it }
        val m = MPVLib.create(activity) ?: error("libmpv: MPVLib.create returned null")
        // izumi controls all options — never read the user's ~/.config/mpv.
        m.setOptionString("config", "no")
        prepareFontsDir()?.let { m.setOptionString("sub-fonts-dir", it) }
        m.setOptionString("vo", "gpu")
        m.setOptionString("gpu-context", "android")
        m.setOptionString("hwdec", "mediacodec-copy")
        m.setOptionString("force-window", "no")
        // Same color/HDR defaults as the desktop cores (stock mpv, no izumi look).
        m.setOptionString("keepaspect", "yes")
        m.setOptionString("tone-mapping", "auto")
        m.setOptionString("hdr-compute-peak", "auto")
        m.setOptionString("gamut-mapping-mode", "auto")
        m.setOptionString("dither-depth", "auto")
        m.setOptionString("target-colorspace-hint", "auto")
        // Picture quality is frontend-owned (Video quality preset). Apply before init so the
        // first frame is not a stock-defaults flash; live changes go through setRenderOpts.
        for ((k, v) in storedRenderOpts) {
            m.setOptionString(k, v)
        }
        for ((k, v) in storedDolbyOpts) {
            m.setOptionString(k, v)
        }
        // MUST be "yes", not "once": the core is cached across episodes (see `ensure`), and with
        // "once" mpv shuts itself down the moment the first file reaches EOF. Auto-advance and
        // "Change source" then issued `loadfile` against a dead core — the command silently
        // succeeded, no properties ever updated, and the UI sat on `buffering: true` over a black
        // screen forever. `force-window=no` already keeps an idle core from showing a window.
        m.setOptionString("idle", "yes")
        m.setOptionString("cache", "yes")
        // Local torrent playback is a seekable HTTP range stream. Match the desktop fast-start
        // limits: FFmpeg's uncapped/default probe can read several megabytes and analyze for
        // several seconds before presenting the first frame, which is especially visible while
        // those bytes are arriving as torrent pieces. Two MiB / one second remains large enough
        // to discover anime's secondary audio and subtitle tracks.
        m.setOptionString("force-seekable", "yes")
        // Refill the demuxer cache in chunks instead of waking continuously to keep it topped up.
        // mpv recommends 10 seconds for lower CPU/network load and better handheld battery life.
        m.setOptionString("demuxer-hysteresis-secs", "10")
        m.setOptionString("demuxer-lavf-probesize", "2097152")
        m.setOptionString("demuxer-lavf-analyzeduration", "1")
        // Avoid a run of tiny loopback reads while libavformat probes MKV headers and Cues.
        m.setOptionString("stream-buffer-size", "262144")
        m.setOptionString("network-timeout", "30")
        m.setOptionString("sub-auto", "fuzzy")
        m.init()
        m.addObserver(this)
        m.observeProperty("time-pos", MPVLib.MpvFormat.MPV_FORMAT_DOUBLE)
        m.observeProperty("duration", MPVLib.MpvFormat.MPV_FORMAT_DOUBLE)
        m.observeProperty("pause", MPVLib.MpvFormat.MPV_FORMAT_FLAG)
        m.observeProperty("eof-reached", MPVLib.MpvFormat.MPV_FORMAT_FLAG)
        m.observeProperty("paused-for-cache", MPVLib.MpvFormat.MPV_FORMAT_FLAG)
        m.observeProperty("demuxer-cache-time", MPVLib.MpvFormat.MPV_FORMAT_DOUBLE)
        // `paused-for-cache` alone only covers a stall during *playback*. Seeking into a region the
        // demuxer hasn't fetched never sets it — mpv reports `seeking` (a seek is resolving) and
        // `core-idle` (no frame is being shown) instead, so without these two a fast-forward into
        // unbuffered data froze on the last frame with no indication anything was happening.
        m.observeProperty("seeking", MPVLib.MpvFormat.MPV_FORMAT_FLAG)
        m.observeProperty("core-idle", MPVLib.MpvFormat.MPV_FORMAT_FLAG)
        mpv = m
        return m
    }

    /** Attach the prepared core to a SurfaceView on first playback. UI thread only. */
    private fun ensure(): MPVLib {
        if (nativeDvPlayer != null) releaseNativeDolbyVision(removeContainer = true)
        val m = ensureCore()
        if (view != null) return m
        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        // Make WRY's WebView transparent so the SurfaceView (added behind it) shows through.
        val web = findWebView(content)
        webView = web
        if (web != null) {
            webViewHapticsWereEnabled = web.isHapticFeedbackEnabled
            web.isHapticFeedbackEnabled = false
            web.setBackgroundColor(Color.TRANSPARENT)
            web.background = null
            Log.i("MpvPlugin", "webview made transparent (${web.javaClass.simpleName})")
        } else {
            Log.w("MpvPlugin", "WebView NOT found under android.R.id.content")
        }
        val v = IzumiMpvView(activity, m, onSurfaceReady@{
            if (mpv !== m) return@onSurfaceReady
            pendingSurfaceLoad?.let { args ->
                pendingSurfaceLoad = null
                loadIntoCore(m, args)
            }
        })
        // SurfaceView must live inside a real clipped player container. Transforming the surface
        // directly let decoded video spill over the watch page while the HTML player frame stayed
        // still. YouTube moves one bounded player rectangle; this FrameLayout gives us that same
        // unit and keeps letterbox/background pixels inside it.
        val playerContainer = FrameLayout(activity).apply {
            setBackgroundColor(Color.BLACK)
            clipChildren = true
            clipToPadding = true
        }
        playerContainer.addView(
            v,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        // Fill the screen — a container with no layout params can size to 0x0 (invisible).
        val lp = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        content.addView(playerContainer, 0, lp) // index 0 → behind the WebView
        setImmersive(true)
        Log.i("MpvPlugin", "surface added; content children=${content.childCount}")
        view = v
        container = playerContainer
        // A fresh container starts with the view flag cleared, so re-assert whatever the web side
        // last asked for — otherwise a surface rebuilt mid-episode silently drops keep-awake.
        playerContainer.keepScreenOn = keepScreenAwakeOn
        contentView = content
        installPipWatcher(content)
        installAutoPipHook()
        installResumeGuard()
        return m
    }

    private fun decoderSupportsProfile(mime: String, profiles: Set<Int>): Boolean = runCatching {
        MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { codec ->
            !codec.isEncoder && codec.supportedTypes.any { it.equals(mime, ignoreCase = true) } &&
                codec.getCapabilitiesForType(mime).profileLevels.any { it.profile in profiles }
        }
    }.getOrDefault(false)

    @Suppress("DEPRECATION")
    private fun supportedHdrTypes(): IntArray = if (Build.VERSION.SDK_INT >= 34) {
        activity.display?.mode?.supportedHdrTypes ?: intArrayOf()
    } else {
        activity.display?.hdrCapabilities?.supportedHdrTypes ?: intArrayOf()
    }

    private fun deviceSupportsNativeHdr(kind: String): Boolean {
        if (Build.VERSION.SDK_INT < 24) return false
        val hdrTypes = supportedHdrTypes()
        return when (kind) {
            "dolby-vision" -> hasDolbyVisionDecoder() &&
                hdrTypes.contains(Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION)
            "hdr10-plus" -> Build.VERSION.SDK_INT >= 29 &&
                hdrTypes.contains(Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS) && (
                    decoderSupportsProfile(MediaFormat.MIMETYPE_VIDEO_HEVC, setOf(MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10Plus)) ||
                    decoderSupportsProfile(MediaFormat.MIMETYPE_VIDEO_VP9, setOf(MediaCodecInfo.CodecProfileLevel.VP9Profile2HDR10Plus)) ||
                    decoderSupportsProfile(MediaFormat.MIMETYPE_VIDEO_AV1, setOf(MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10HDR10Plus))
                )
            "hlg" -> hdrTypes.contains(Display.HdrCapabilities.HDR_TYPE_HLG) && (
                decoderSupportsProfile(MediaFormat.MIMETYPE_VIDEO_HEVC, setOf(
                    MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10,
                    MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10,
                    MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10Plus,
                )) || decoderSupportsProfile(MediaFormat.MIMETYPE_VIDEO_VP9, setOf(
                    MediaCodecInfo.CodecProfileLevel.VP9Profile2,
                    MediaCodecInfo.CodecProfileLevel.VP9Profile2HDR,
                    MediaCodecInfo.CodecProfileLevel.VP9Profile2HDR10Plus,
                )) || decoderSupportsProfile(MediaFormat.MIMETYPE_VIDEO_AV1, setOf(
                    MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10,
                    MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10HDR10,
                    MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10HDR10Plus,
                ))
            )
            else -> false
        }
    }

    private fun subtitleMime(url: String): String = when {
        url.substringBefore('?').endsWith(".ass", true) || url.substringBefore('?').endsWith(".ssa", true) -> MimeTypes.TEXT_SSA
        url.substringBefore('?').endsWith(".srt", true) -> MimeTypes.APPLICATION_SUBRIP
        else -> MimeTypes.TEXT_VTT
    }

    private fun publishNativeDolbyProgress() {
        val player = nativeDvPlayer ?: return
        val duration = player.duration.takeIf { it != C.TIME_UNSET }?.coerceAtLeast(0L) ?: 0L
        trigger("progress", JSObject().put("property", "time-pos").put("value", player.currentPosition / 1000.0))
        trigger("progress", JSObject().put("property", "duration").put("value", duration / 1000.0))
        trigger("progress", JSObject().put("property", "pause").put("value", !player.isPlaying))
        trigger("progress", JSObject().put("property", "paused-for-cache").put("value", player.playbackState == Player.STATE_BUFFERING))
        trigger("progress", JSObject().put("property", "seeking").put("value", nativeDvSeeking))
        trigger("progress", JSObject().put("property", "core-idle").put("value", player.playbackState == Player.STATE_IDLE))
        trigger("progress", JSObject().put("property", "demuxer-cache-time").put("value", player.bufferedPosition / 1000.0))
    }

    private fun startNativeDolbyProgress() {
        nativeDvProgressTask?.let { activity.window.decorView.removeCallbacks(it) }
        nativeDvProgressTask = object : Runnable {
            override fun run() {
                if (nativeDvPlayer == null) return
                publishNativeDolbyProgress()
                activity.window.decorView.postDelayed(this, 250L)
            }
        }.also { activity.window.decorView.post(it) }
    }

    private val nativeDolbyListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
                Player.STATE_BUFFERING -> {
                    trigger("progress", JSObject().put("property", "paused-for-cache").put("value", true))
                    trigger("progress", JSObject().put("property", "core-idle").put("value", true))
                }
                Player.STATE_READY -> {
                    trigger("progress", JSObject().put("property", "paused-for-cache").put("value", false))
                    trigger("progress", JSObject().put("property", "core-idle").put("value", false))
                    trigger("event", JSObject().put("id", 8)) // MPV_EVENT_FILE_LOADED contract
                }
                Player.STATE_ENDED -> {
                    trigger("progress", JSObject().put("property", "eof-reached").put("value", true))
                    trigger("event", JSObject().put("id", 7))
                }
            }
            publishNativeDolbyProgress()
        }

        override fun onRenderedFirstFrame() {
            if (nativeDvFirstFrame) return
            nativeDvFirstFrame = true
            mediaLoaded = true
            trigger("event", JSObject().put("id", 21)) // MPV_EVENT_PLAYBACK_RESTART contract
            trigger("dolby", JSObject().put("reason", "native-${nativeHdrType ?: "hdr"}-active"))
            publishPipParams()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            corePaused = !isPlaying
            trigger("progress", JSObject().put("property", "pause").put("value", !isPlaying))
            MediaController.setPlaying(isPlaying)
            updatePipActions()
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int,
        ) {
            nativeDvSeeking = false
            publishNativeDolbyProgress()
        }

        override fun onPlayerError(error: PlaybackException) {
            val args = nativeDvLoad ?: return
            Log.w("MpvPlugin", "native HDR path failed; falling back to mpv: ${error.message}")
            trigger("dolby", JSObject().put("reason", "native-${nativeHdrType ?: "hdr"}-fallback"))
            activity.runOnUiThread {
                releaseNativeDolbyVision(removeContainer = true)
                loadWithMpv(args)
            }
        }
    }

    private fun setupVideoContainer(child: View): FrameLayout {
        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        val web = findWebView(content)
        webView = web
        if (web != null) {
            webViewHapticsWereEnabled = web.isHapticFeedbackEnabled
            web.isHapticFeedbackEnabled = false
            web.setBackgroundColor(Color.TRANSPARENT)
            web.background = null
        }
        val playerContainer = FrameLayout(activity).apply {
            setBackgroundColor(Color.BLACK)
            clipChildren = true
            clipToPadding = true
            addView(child, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ))
        }
        content.addView(playerContainer, 0, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))
        container = playerContainer
        contentView = content
        playerContainer.keepScreenOn = keepScreenAwakeOn
        setImmersive(true)
        installPipWatcher(content)
        installAutoPipHook()
        installResumeGuard()
        return playerContainer
    }

    private fun loadNativeHdr(args: LoadArgs, kind: String) {
        mpv?.command(arrayOf("stop"))
        container?.let { (it.parent as? ViewGroup)?.removeView(it) }
        container = null
        view = null
        releaseNativeDolbyVision(removeContainer = false)

        val httpFactory = DefaultHttpDataSource.Factory()
            .setDefaultRequestProperties(args.headers)
            .setConnectTimeoutMs(30_000)
            .setReadTimeoutMs(30_000)
        val dataSourceFactory = DefaultDataSource.Factory(activity, httpFactory)
        val mediaSourceFactory = DefaultMediaSourceFactory(dataSourceFactory)
        val renderers = DefaultRenderersFactory(activity).setEnableDecoderFallback(true)
        val player = ExoPlayer.Builder(activity, renderers, mediaSourceFactory).build()
        val playerView = PlayerView(activity).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            this.player = player
            setShutterBackgroundColor(Color.BLACK)
        }
        // TextureView may be composed through an SDR intermediate on Android 13. PlayerView's
        // SurfaceView is the documented HDR path; fail closed if a future UI default changes it.
        if (playerView.videoSurfaceView !is SurfaceView) {
            player.release()
            trigger("dolby", JSObject().put("reason", "native-hdr-surface-unavailable"))
            loadWithMpv(args)
            return
        }
        setupVideoContainer(playerView)
        nativeDvPlayer = player
        nativeDvView = playerView
        nativeDvLoad = args
        nativeDvFirstFrame = false
        nativeDvSeeking = false
        nativeHdrType = kind
        mediaLoaded = false
        corePaused = args.autoplay.not()

        val trackParameters = player.trackSelectionParameters.buildUpon()
        args.alang?.trim()?.takeIf { it.isNotEmpty() && it != "auto" }?.let {
            trackParameters.setPreferredAudioLanguage(it)
        }
        val subtitleLanguage = args.slang?.trim().orEmpty()
        if (subtitleLanguage.equals("none", ignoreCase = true)) {
            trackParameters.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else if (subtitleLanguage.isNotEmpty() && !subtitleLanguage.equals("auto", ignoreCase = true)) {
            trackParameters.setPreferredTextLanguage(subtitleLanguage)
        }
        player.trackSelectionParameters = trackParameters.build()

        val subtitleConfigs = args.subtitles.map { subtitle ->
            MediaItem.SubtitleConfiguration.Builder(Uri.parse(subtitle.url))
                .setMimeType(subtitleMime(subtitle.url))
                .setLanguage(subtitle.lang)
                .setLabel(subtitle.title)
                .setSelectionFlags(if (subtitle.selected) C.SELECTION_FLAG_DEFAULT else 0)
                .build()
        }
        val item = MediaItem.Builder()
            .setUri(args.url)
            .setSubtitleConfigurations(subtitleConfigs)
            .build()
        player.addListener(nativeDolbyListener)
        trigger("event", JSObject().put("id", 6)) // MPV_EVENT_START_FILE contract
        player.setMediaItem(item, (args.startPos * 1000.0).toLong().coerceAtLeast(0L))
        player.prepare()
        player.playWhenReady = args.autoplay
        startNativeDolbyProgress()
        publishPipParams()
    }

    private fun releaseNativeDolbyVision(removeContainer: Boolean) {
        nativeDvProgressTask?.let { activity.window.decorView.removeCallbacks(it) }
        nativeDvProgressTask = null
        nativeDvPlayer?.removeListener(nativeDolbyListener)
        nativeDvView?.player = null
        nativeDvPlayer?.release()
        nativeDvPlayer = null
        nativeDvView = null
        nativeDvLoad = null
        nativeDvFirstFrame = false
        nativeDvSeeking = false
        nativeHdrType = null
        if (removeContainer) {
            container?.let { (it.parent as? ViewGroup)?.removeView(it) }
            container = null
        }
    }

    /** Pay libmpv and font initialization while the app is idle, without exposing a video view. */
    @Command
    fun prepare(invoke: Invoke) {
        activity.runOnUiThread {
            val created = mpv == null
            val started = System.nanoTime()
            try {
                ensureCore()
                invoke.resolve(
                    JSObject()
                        .put("created", created)
                        .put("durationMs", (System.nanoTime() - started) / 1_000_000),
                )
            } catch (error: Exception) {
                invoke.reject(error.message ?: "mpv-prepare-failed")
            }
        }
    }

    // --- Picture-in-picture -------------------------------------------------------------------
    //
    // The player container is normally laid out for the PORTRAIT watch page: a top margin for the
    // status-bar inset and an explicit 16:9 pixel height, with the web shell painting the rest of
    // the screen. Entering PiP shrinks the window to a small floating rectangle but left those
    // physical-pixel values untouched, so the video sat below the window's top edge and was clipped
    // to a band — only a slice of the picture was ever visible. PiP therefore takes the container
    // to a plain fill, and the previous viewport is replayed when it ends.

    /** Detect PiP enter/exit without depending on an activity subclass: entering or leaving PiP
     *  always resizes the activity window, and `isInPictureInPictureMode` is authoritative. */
    private fun installPipWatcher(content: ViewGroup) {
        if (pipLayoutListener != null) return
        val listener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            val now = Build.VERSION.SDK_INT >= 24 && activity.isInPictureInPictureMode
            if (now == pipActive) return@OnLayoutChangeListener
            pipActive = now
            if (now) onEnteredPip() else onLeftPip()
        }
        content.addOnLayoutChangeListener(listener)
        pipLayoutListener = listener
    }

    private fun removePipWatcher() {
        pipLayoutListener?.let { contentView?.removeOnLayoutChangeListener(it) }
        pipLayoutListener = null
        contentView = null
    }

    private fun showWebPlayerUi(show: Boolean) {
        webView?.visibility = if (show) View.VISIBLE else View.INVISIBLE
    }

    /** Fill the (now tiny) PiP window with the video rectangle: no inset margin, no fixed height,
     *  no leftover gesture transform. */
    private fun applyPipLayout() {
        // PiP contains only the native video. JS may be suspended before its `pip` event arrives.
        showWebPlayerUi(false)
        container?.let { playerContainer ->
            val params = (playerContainer.layoutParams as? FrameLayout.LayoutParams)
                ?: FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            params.width = ViewGroup.LayoutParams.MATCH_PARENT
            params.height = ViewGroup.LayoutParams.MATCH_PARENT
            params.leftMargin = 0
            params.topMargin = 0
            playerContainer.layoutParams = params
            playerContainer.scaleX = 1f
            playerContainer.scaleY = 1f
            playerContainer.translationX = 0f
            playerContainer.translationY = 0f
            playerContainer.requestLayout()
        }
    }

    /** The PiP window's shape. Android rejects anything outside 1:2.39 … 2.39:1, so the video's own
     *  display aspect is clamped rather than passed through (and 16:9 stands in before it is known). */
    private fun pipAspect(): Rational {
        nativeDvPlayer?.videoSize?.let { size ->
            if (size.width > 0 && size.height > 0) {
                val ratio = size.width.toDouble() / size.height.toDouble()
                return when {
                    ratio < 1.0 / 2.39 -> Rational(100, 239)
                    ratio > 2.39 -> Rational(239, 100)
                    else -> Rational(size.width, size.height)
                }
            }
        }
        val m = mpv
        val width = m?.getPropertyString("video-params/dw")?.toIntOrNull() ?: 0
        val height = m?.getPropertyString("video-params/dh")?.toIntOrNull() ?: 0
        if (width <= 0 || height <= 0) return Rational(16, 9)
        val ratio = width.toDouble() / height.toDouble()
        return when {
            ratio < 1.0 / 2.39 -> Rational(100, 239)
            ratio > 2.39 -> Rational(239, 100)
            else -> Rational(width, height)
        }
    }

    /** A single play/pause remote action. Without it the miniplayer is a picture you cannot stop. */
    private fun pipActions(): List<RemoteAction> {
        if (Build.VERSION.SDK_INT < 26) return emptyList()
        val paused = nativeDvPlayer?.let { !it.isPlaying }
            ?: (mpv?.getPropertyString("pause") == "yes")
        val label = if (paused) "Play" else "Pause"
        val icon = Icon.createWithResource(
            activity,
            if (paused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause,
        )
        val intent = PendingIntent.getBroadcast(
            activity,
            PIP_CODE_PLAY_PAUSE,
            Intent(PIP_ACTION)
                .setPackage(activity.packageName)
                .putExtra(PIP_EXTRA_CODE, PIP_CODE_PLAY_PAUSE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return listOf(RemoteAction(icon, label, label, intent))
    }

    /** The video rectangle as it sits on the watch page, captured BEFORE the PiP fill is applied so
     *  the system animates from where the user actually sees the video. Null when unavailable. */
    private fun captureSourceHint(): Rect? {
        val playerContainer = container ?: return null
        val rect = Rect()
        if (!playerContainer.getGlobalVisibleRect(rect)) return null
        return if (rect.width() > 0 && rect.height() > 0) rect else null
    }

    private var pipSourceHint: Rect? = null

    private fun pipParams(): PictureInPictureParams {
        val builder = PictureInPictureParams.Builder().setAspectRatio(pipAspect())
        // Lets the system animate FROM the on-screen video rectangle instead of cross-fading the
        // whole window, which is what makes the transition read as the video "shrinking".
        pipSourceHint?.let { builder.setSourceRectHint(it) }
        builder.setActions(pipActions())
        if (Build.VERSION.SDK_INT >= 31) {
            // The system-driven half of "press home and it becomes a miniplayer": Android enters
            // PiP itself on the home/recents gesture, so the transition is the platform's own
            // animation instead of a request we fire after the window has already gone away.
            // Armed only while a video is actually playing, or every trip to the home screen would
            // leave a miniplayer behind.
            builder.setAutoEnterEnabled(autoPipEnabled && mediaLoaded && !corePaused)
            builder.setSeamlessResizeEnabled(true)
        }
        return builder.build()
    }

    /**
     * Publish the current PiP params. Unlike the old in-PiP-only refresh this also runs on the
     * watch page, because auto-enter has to be armed BEFORE the user leaves — by the time the app
     * is backgrounded it is too late to ask.
     */
    private fun publishPipParams() {
        if (Build.VERSION.SDK_INT < 26) return
        // With no core there is nothing to shrink into a miniplayer, but the params the system still
        // holds from the last playback say auto-enter is armed — bailing out here left the WHOLE app
        // folding into a miniplayer on the next press of home. Disarm rather than return.
        if (mpv == null && nativeDvPlayer == null) {
            if (Build.VERSION.SDK_INT >= 31) {
                try {
                    activity.setPictureInPictureParams(
                        PictureInPictureParams.Builder().setAutoEnterEnabled(false).build(),
                    )
                } catch (e: Exception) {
                    Log.w("MpvPlugin", "pip auto-enter disarm failed: ${e.message}")
                }
            }
            return
        }
        // Keep the shrink-from-the-video animation honest: the rectangle is only meaningful while
        // the video is still laid out on the watch page.
        if (!pipActive && !pipRequested) pipSourceHint = captureSourceHint()
        try {
            activity.setPictureInPictureParams(pipParams())
        } catch (e: Exception) {
            Log.w("MpvPlugin", "pip params update failed: ${e.message}")
        }
    }

    /** Re-publish the params so the action button matches the CURRENT play/pause state. */
    private fun updatePipActions() = publishPipParams()

    @Command
    fun autoPip(invoke: Invoke) {
        val a = invoke.parseArgs(AutoPipArgs::class.java)
        activity.runOnUiThread {
            autoPipEnabled = a.enabled
            publishPipParams()
            invoke.resolve()
        }
    }

    private fun registerPipReceiver() {
        if (pipReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.getIntExtra(PIP_EXTRA_CODE, 0) != PIP_CODE_PLAY_PAUSE) return
                if (nativeDvPlayer != null) {
                    nativeDvPlayer?.playWhenReady = nativeDvPlayer?.playWhenReady != true
                } else {
                    mpv?.command(arrayOf("cycle", "pause"))
                }
                // The observed `pause` event also refreshes the button, but post one update so the
                // icon flips even if the property observer is momentarily behind.
                activity.window.decorView.postDelayed({ updatePipActions() }, 150L)
            }
        }
        ContextCompat.registerReceiver(
            activity,
            receiver,
            IntentFilter(PIP_ACTION),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        pipReceiver = receiver
    }

    private fun unregisterPipReceiver() {
        pipReceiver?.let { runCatching { activity.unregisterReceiver(it) } }
        pipReceiver = null
    }

    private fun onEnteredPip() {
        pipRequested = true
        applyPipLayout()
        setImmersive(true)
        registerPipReceiver()
        updatePipActions()
        trigger("pip", JSObject().put("active", true))
    }

    private fun onLeftPip() {
        pipRequested = false
        pipSourceHint = null
        unregisterPipReceiver()
        showWebPlayerUi(true)
        // Restore the watch-page geometry immediately. The web shell also re-syncs on its own resize
        // event; both converge on the same values, so a duplicate call is harmless.
        applyViewport(lastViewport ?: ViewportArgs())
        trigger("pip", JSObject().put("active", false))
    }

    @Command
    fun pip(invoke: Invoke) {
        activity.runOnUiThread {
            if (Build.VERSION.SDK_INT < 26) {
                invoke.reject("pip-unsupported")
                return@runOnUiThread
            }
            if (!mediaLoaded) {
                invoke.reject("pip-no-active-video")
                return@runOnUiThread
            }
            // Reshape BEFORE the transition: the system captures the window during the animation, so
            // fixing the layout only after `isInPictureInPictureMode` flips leaves a clipped first
            // frame. `pipRequested` then keeps a racing viewport() from undoing it mid-transition.
            // The source-rect hint is read first, while the video is still the watch-page rectangle.
            pipSourceHint = captureSourceHint()
            pipRequested = true
            applyPipLayout()
            // Denied (the per-app PiP permission is off, the device does not support it, the
            // activity is not resumed) — put the watch page back rather than leaving a stretched
            // surface behind. The API signals refusal BOTH ways: `false` and, for bad params, a throw.
            val failure = try {
                if (activity.enterPictureInPictureMode(pipParams())) null else "pip-denied"
            } catch (e: Exception) {
                Log.w("MpvPlugin", "enterPictureInPictureMode failed: ${e.message}")
                e.message ?: "pip-failed"
            }
            if (failure == null) {
                invoke.resolve()
            } else {
                pipRequested = false
                pipSourceHint = null
                showWebPlayerUi(true)
                applyViewport(lastViewport ?: ViewportArgs())
                invoke.reject(failure)
            }
        }
    }

    /**
     * Watch the player activity's own pause so pre-31 auto-PiP has a hook at all.
     *
     * Android 12 introduced `setAutoEnterEnabled`, which the system honours by itself; before that
     * the only chance to become a miniplayer is the moment the activity leaves the foreground.
     * Tauri's generated activity never forwards `onPause`/`onUserLeaveHint` to plugins, and the
     * generated sources are regenerated on every build, so the pause is observed through the
     * application's lifecycle callbacks instead — that works identically in local dev and CI.
     */
    private fun installAutoPipHook() {
        if (Build.VERSION.SDK_INT !in 26..30 || autoPipCallbacks != null) return
        val callbacks = object : Application.ActivityLifecycleCallbacks {
            override fun onActivityPaused(paused: Activity) {
                if (paused === activity) autoPipOnLeave()
            }

            override fun onActivityCreated(created: Activity, state: Bundle?) {}
            override fun onActivityStarted(started: Activity) {}
            override fun onActivityResumed(resumed: Activity) {}
            override fun onActivityStopped(stopped: Activity) {}
            override fun onActivitySaveInstanceState(saved: Activity, state: Bundle) {}
            override fun onActivityDestroyed(destroyed: Activity) {}
        }
        activity.application.registerActivityLifecycleCallbacks(callbacks)
        autoPipCallbacks = callbacks
    }

    private fun removeAutoPipHook() {
        autoPipCallbacks?.let { activity.application.unregisterActivityLifecycleCallbacks(it) }
        autoPipCallbacks = null
    }

    /**
     * Belt-and-braces visibility restore. [applyPipLayout] hides the WebView for the PiP window and
     * the layout listener's [onLeftPip] is what normally shows it again — but a missed PiP-exit
     * edge (system dismissed the miniplayer while the activity was stopped, listener saw no layout
     * pass) left the WebView INVISIBLE after the app came back to the foreground. An invisible view
     * receives no touch dispatch, which presents as "the whole app stopped responding". Whenever
     * the activity resumes NOT in PiP, the web UI must be visible; showing an already-visible view
     * is free.
     */
    private fun installResumeGuard() {
        if (resumeGuardCallbacks != null) return
        val callbacks = object : Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(resumed: Activity) {
                if (resumed !== activity) return
                val inPip = Build.VERSION.SDK_INT >= 24 && activity.isInPictureInPictureMode
                if (!inPip) showWebPlayerUi(true)
            }

            override fun onActivityCreated(created: Activity, state: Bundle?) {}
            override fun onActivityStarted(started: Activity) {}
            override fun onActivityPaused(paused: Activity) {}
            override fun onActivityStopped(stopped: Activity) {}
            override fun onActivitySaveInstanceState(saved: Activity, state: Bundle) {}
            override fun onActivityDestroyed(destroyed: Activity) {}
        }
        activity.application.registerActivityLifecycleCallbacks(callbacks)
        resumeGuardCallbacks = callbacks
    }

    private fun removeResumeGuard() {
        resumeGuardCallbacks?.let { activity.application.unregisterActivityLifecycleCallbacks(it) }
        resumeGuardCallbacks = null
    }

    /**
     * Pre-31 auto-PiP, driven by [installAutoPipHook]. Best effort by nature — the window may
     * already be gone, and the platform is free to refuse.
     *
     * A pause is a broader signal than `onUserLeaveHint`: it also fires when the activity is going
     * away for good, when it is being recreated for a configuration change, and when the screen
     * simply turns off. None of those are the user stepping out of the app with a video running, so
     * they are filtered out before the miniplayer is requested.
     */
    private fun autoPipOnLeave() {
        if (Build.VERSION.SDK_INT !in 26..30) return
        if (!autoPipEnabled || !mediaLoaded || corePaused || pipActive || pipRequested) return
        if (activity.isFinishing || activity.isChangingConfigurations) return
        val power = activity.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (power != null && !power.isInteractive) return
        try {
            pipSourceHint = captureSourceHint()
            pipRequested = true
            applyPipLayout()
            if (!activity.enterPictureInPictureMode(pipParams())) {
                pipRequested = false
                pipSourceHint = null
                showWebPlayerUi(true)
                applyViewport(lastViewport ?: ViewportArgs())
            }
        } catch (e: Exception) {
            pipRequested = false
            pipSourceHint = null
            showWebPlayerUi(true)
            applyViewport(lastViewport ?: ViewportArgs())
            Log.w("MpvPlugin", "auto pip failed: ${e.message}")
        }
    }

    // --- Media session / notification -----------------------------------------------------------
    //
    // The lock-screen and notification-shade transport. Play/pause and the scrubber are answered
    // natively (a direct libmpv command lands even when the WebView has been frozen by Android);
    // next/previous/stop need the JS episode logic, so they are forwarded as plugin events.

    private val mediaTransport = object : MediaTransport {
        override fun onPlay() {
            nativeDvPlayer?.play() ?: mpv?.command(arrayOf("set", "pause", "no"))
        }

        override fun onPause() {
            nativeDvPlayer?.pause() ?: mpv?.command(arrayOf("set", "pause", "yes"))
        }

        override fun onSeekTo(positionMs: Long) {
            val seconds = (positionMs.coerceAtLeast(0L) / 1000.0)
            nativeDvPlayer?.seekTo((seconds * 1000.0).toLong())
                ?: mpv?.command(arrayOf("seek", seconds.toString(), "absolute+exact"))
        }

        override fun onSkipNext() {
            trigger("media", JSObject().put("action", "next"))
        }

        override fun onSkipPrev() {
            trigger("media", JSObject().put("action", "prev"))
        }

        override fun onStop() {
            // Silence it immediately rather than waiting for the web layer to wake up and unwind
            // the session; the JS side still gets the event and does the real teardown.
            nativeDvPlayer?.pause() ?: mpv?.command(arrayOf("set", "pause", "yes"))
            trigger("media", JSObject().put("action", "stop"))
            // Retire the transport here too. Dismissing the notification is a stop, and leaving the
            // session alive means the very next state update posts the notification straight back.
            // `mpv_stop` repeats this once JS unwinds; the teardown is idempotent.
            activity.runOnUiThread { teardownMediaSession() }
        }
    }

    private fun registerMediaReceiver() {
        if (mediaReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val code = intent?.getIntExtra(MediaController.EXTRA_CODE, 0) ?: return
                if (code == 0) return
                MediaController.handleAction(code)
            }
        }
        ContextCompat.registerReceiver(
            activity,
            receiver,
            IntentFilter(MediaController.ACTION),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        mediaReceiver = receiver
    }

    private fun unregisterMediaReceiver() {
        mediaReceiver?.let { runCatching { activity.unregisterReceiver(it) } }
        mediaReceiver = null
    }

    private fun teardownMediaSession() {
        unregisterMediaReceiver()
        MediaController.stop()
    }

    @Command
    fun mediaSession(invoke: Invoke) {
        val a = invoke.parseArgs(MediaSessionArgs::class.java)
        activity.runOnUiThread {
            if (!a.enabled || (mpv == null && nativeDvPlayer == null)) {
                teardownMediaSession()
                invoke.resolve()
                return@runOnUiThread
            }
            registerMediaReceiver()
            MediaController.start(activity, mediaTransport)
            MediaController.setMetadata(a.title, a.subtitle, a.artwork, a.hasPrev, a.hasNext)
            MediaController.setPlaying(!corePaused)
            invoke.resolve()
        }
    }

    /** Ask for POST_NOTIFICATIONS. Without it the media notification — and therefore the whole
     *  lock-screen transport — is silently suppressed on API 33+. Resolves `{ granted }`. */
    @Command
    fun requestNotifications(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < 33) {
            invoke.resolve(JSObject().put("granted", true))
            return
        }
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            invoke.resolve(JSObject().put("granted", true))
            return
        }
        requestPermissionForAliases(arrayOf("notifications"), invoke, "notificationsResult")
    }

    @PermissionCallback
    fun notificationsResult(invoke: Invoke) {
        val granted = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        invoke.resolve(JSObject().put("granted", granted))
    }

    /** mpv treats `slang` as a preference, not a restriction: if English is absent it may still
     * select a source-default Chinese track. Enforce the user's language once the file's embedded
     * track list exists; an explicitly-selected external English track added just after load can
     * still override this through `sub-add ... select`. */
    private fun enforcePreferredSubtitle(m: MPVLib) {
        val preferred = normalizedTrackLanguage(preferredSubLanguage)
        if (preferred.isEmpty()) return
        if (preferred == "none") {
            m.setPropertyString("sid", "no")
            return
        }
        val count = m.getPropertyString("track-list/count")?.toIntOrNull() ?: 0
        val tracks = (0 until count).map { index ->
            SemanticTrack(
                id = m.getPropertyString("track-list/$index/id").orEmpty(),
                kind = m.getPropertyString("track-list/$index/type").orEmpty(),
                title = m.getPropertyString("track-list/$index/title").orEmpty(),
                lang = m.getPropertyString("track-list/$index/lang").orEmpty(),
                selected = m.getPropertyString("track-list/$index/selected")
                    .equals("yes", ignoreCase = true),
            )
        }
        val match = preferredSubtitleId(preferred, tracks)
        m.setPropertyString("sid", match?.takeIf { it.isNotBlank() } ?: "no")
    }

    private fun loadIntoCore(m: MPVLib, args: LoadArgs) {
        // Replacing a file is asynchronous. Until FILE_LOADED confirms the new entry, there is no
        // current video for Android to auto-enter into; this also ignores the outgoing file's tail.
        mediaLoaded = false
        args.alang?.takeIf { it.isNotBlank() }?.let {
            m.setPropertyString("alang", it)
        }
        val slang = args.slang?.trim().orEmpty()
        preferredSubLanguage = slang
        if (slang.equals("none", ignoreCase = true)) {
            m.setPropertyString("sid", "no")
        } else {
            m.setPropertyString("sid", "auto")
            if (slang.isNotEmpty()) m.setPropertyString("slang", slang)
        }
        // Aniyomi/HTTP streams commonly require Referer/Origin. libmpv's HTTP header field is
        // process-global, so reset it on every load rather than leaking the previous source's
        // headers into the next episode.
        m.setPropertyString(
            "http-header-fields",
            args.headers.entries.joinToString(",") { "${it.key}: ${it.value}" },
        )
        pendingSubtitles = PendingSubtitles(args.url, args.subtitles)
        // Resume position via mpv's `start` option, set BEFORE loadfile — the same rule the
        // desktop backends follow. The old post-loadfile `seek` was silently rejected: mpv
        // refuses seeks until the file's playback is initialized (hundreds of ms away for a
        // network stream), the ignored return code hid the failure, playback began at 0:00 —
        // and the throttled progress loop then overwrote the real saved position with ~0.
        // Every Continue Watching tap is a cold open through the deferred-surface path, so the
        // reported "doesn't go to where you last watched" was deterministic.
        // Always set it ("none" clears): `start` is sticky, and a resumed file must not leak
        // its offset into the next episode loaded on the reused core.
        m.setPropertyString("start", if (args.startPos > 0) args.startPos.toString() else "none")
        m.command(arrayOf("loadfile", args.url))
        if (slang.equals("none", ignoreCase = true)) {
            m.setPropertyString("sid", "no")
        }
    }

    private fun loadWithMpv(args: LoadArgs) {
        val m = ensure()
        // BaseMPVView from mpv-android follows the same rule: the first loadfile is retained until
        // surfaceCreated has attached the Android Surface. Later loads can reuse it.
        if (view?.surfaceReady == true) {
            pendingSurfaceLoad = null
            loadIntoCore(m, args)
        } else {
            pendingSurfaceLoad = args
        }
        publishPipParams()
    }

    @Command
    fun load(invoke: Invoke) {
        val args = invoke.parseArgs(LoadArgs::class.java)
        activity.runOnUiThread {
            val nativeHdr = args.preferNativeHdr?.lowercase(Locale.ROOT)
            if (nativeHdr != null && deviceSupportsNativeHdr(nativeHdr)) {
                loadNativeHdr(args, nativeHdr)
            } else {
                if (nativeHdr != null) {
                    trigger("dolby", JSObject().put("reason", "native-$nativeHdr-unavailable"))
                }
                loadWithMpv(args)
            }
            invoke.resolve()
        }
    }

    private fun nativeTracks(): List<NativeTrack> {
        val player = nativeDvPlayer ?: return emptyList()
        var id = 1
        val result = mutableListOf<NativeTrack>()
        for (group in player.currentTracks.groups) {
            if (group.type != C.TRACK_TYPE_AUDIO && group.type != C.TRACK_TYPE_TEXT && group.type != C.TRACK_TYPE_VIDEO) continue
            for (index in 0 until group.length) {
                result += NativeTrack(
                    id = id++,
                    type = group.type,
                    group = group.mediaTrackGroup,
                    index = index,
                    format = group.getTrackFormat(index),
                    selected = group.isTrackSelected(index),
                )
            }
        }
        return result
    }

    private fun setNativeTrack(property: String, value: String) {
        val player = nativeDvPlayer ?: return
        val type = if (property == "aid") C.TRACK_TYPE_AUDIO else C.TRACK_TYPE_TEXT
        val builder = player.trackSelectionParameters.buildUpon().clearOverridesOfType(type)
        if (value == "no") {
            builder.setTrackTypeDisabled(type, true)
        } else {
            val track = nativeTracks().firstOrNull { it.type == type && it.id == value.toIntOrNull() }
            builder.setTrackTypeDisabled(type, false)
            if (track != null) builder.setOverrideForType(TrackSelectionOverride(track.group, listOf(track.index)))
        }
        player.trackSelectionParameters = builder.build()
    }

    private fun handleNativeCommand(args: Array<String>): Boolean {
        val player = nativeDvPlayer ?: return false
        when (args.firstOrNull()) {
            "cycle" -> if (args.getOrNull(1) == "pause") player.playWhenReady = !player.playWhenReady
            "seek" -> {
                val amount = args.getOrNull(1)?.toDoubleOrNull() ?: return true
                nativeDvSeeking = true
                val absolute = args.getOrNull(2)?.startsWith("absolute") == true
                val target = if (absolute) amount else player.currentPosition / 1000.0 + amount
                player.seekTo((target * 1000.0).toLong().coerceAtLeast(0L))
            }
            "set" -> {
                val property = args.getOrNull(1).orEmpty()
                val value = args.getOrNull(2).orEmpty()
                when (property) {
                    "pause" -> player.playWhenReady = value != "yes"
                    "volume" -> player.volume = ((value.toFloatOrNull() ?: 100f) / 100f).coerceIn(0f, 1f)
                    "mute" -> player.volume = if (value == "yes") 0f else 1f
                    "speed" -> player.setPlaybackSpeed((value.toFloatOrNull() ?: 1f).coerceIn(0.25f, 4f))
                    "aid", "sid" -> setNativeTrack(property, value)
                    "keepaspect", "panscan" -> {
                        nativeDvView?.resizeMode = if (property == "panscan" && value != "0") {
                            AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                        } else AspectRatioFrameLayout.RESIZE_MODE_FIT
                    }
                    // libass/audio filters are intentionally not emulated. Native DV is selected
                    // only when those features are inactive; otherwise the frontend requests mpv.
                    "af", "vf" -> Unit
                }
            }
            "stop" -> player.stop()
            else -> return false
        }
        return true
    }

    private fun nativeProperty(name: String): String? {
        val player = nativeDvPlayer ?: return null
        val video = player.videoFormat
        val audio = player.audioFormat
        val indexed = Regex("track-list/(\\d+)/(.*)").matchEntire(name)
        if (indexed != null) {
            val track = nativeTracks().getOrNull(indexed.groupValues[1].toInt()) ?: return null
            return when (indexed.groupValues[2]) {
                "id" -> track.id.toString()
                "type" -> when (track.type) { C.TRACK_TYPE_AUDIO -> "audio"; C.TRACK_TYPE_TEXT -> "sub"; else -> "video" }
                "title" -> track.format.label.orEmpty()
                "lang" -> track.format.language.orEmpty()
                "selected" -> if (track.selected) "yes" else "no"
                "codec", "format-name" -> track.format.sampleMimeType.orEmpty()
                "codec-profile" -> track.format.codecs.orEmpty()
                "external-filename" -> ""
                else -> ""
            }
        }
        return when (name) {
            "idle-active" -> "no"
            "pause" -> if (player.playWhenReady) "no" else "yes"
            "time-pos" -> (player.currentPosition / 1000.0).toString()
            "duration" -> ((player.duration.takeIf { it != C.TIME_UNSET } ?: 0L) / 1000.0).toString()
            "volume" -> (player.volume * 100f).toInt().toString()
            "speed" -> player.playbackParameters.speed.toString()
            "file-format" -> nativeDvLoad?.url?.substringBefore('?')?.substringAfterLast('.', "") ?: ""
            "track-list/count" -> nativeTracks().size.toString()
            "chapter-list/count" -> "0"
            "video-params/dw", "video-params/w" -> player.videoSize.width.toString()
            "video-params/dh", "video-params/h" -> player.videoSize.height.toString()
            "video-format" -> video?.sampleMimeType.orEmpty()
            "video-params/codec-profile" -> video?.codecs.orEmpty()
            "video-params/primaries" -> when (video?.colorInfo?.colorSpace) {
                C.COLOR_SPACE_BT2020 -> "bt.2020"
                C.COLOR_SPACE_BT709 -> "bt.709"
                else -> ""
            }
            "video-params/gamma" -> when (video?.colorInfo?.colorTransfer) {
                C.COLOR_TRANSFER_ST2084 -> "pq"
                C.COLOR_TRANSFER_HLG -> "hlg"
                C.COLOR_TRANSFER_SDR -> "bt.1886"
                else -> ""
            }
            "audio-codec-name" -> audio?.sampleMimeType.orEmpty()
            "audio-params/format" -> audio?.sampleMimeType.orEmpty()
            "current-vo" -> "mediacodec-surface"
            "current-ao" -> "audiotrack"
            "audio-device" -> "android-routed"
            else -> ""
        }
    }

    @Command
    fun command(invoke: Invoke) {
        val a = invoke.parseArgs(CommandArgs::class.java)
        if (!handleNativeCommand(a.args)) mpv?.command(a.args) // libmpv command queue is thread-safe
        invoke.resolve()
    }

    @Command
    fun get(invoke: Invoke) {
        val a = invoke.parseArgs(GetArgs::class.java)
        val ret = JSObject()
        ret.put("value", nativeProperty(a.property) ?: mpv?.getPropertyString(a.property))
        invoke.resolve(ret)
    }

    @Command
    fun set(invoke: Invoke) {
        val a = invoke.parseArgs(SetArgs::class.java)
        if (!handleNativeCommand(arrayOf("set", a.property, a.value))) {
            mpv?.setPropertyString(a.property, a.value)
        }
        invoke.resolve()
    }

    /** Store the complete quality-preset option set and live-apply it when a core exists. */
    @Command
    fun setRenderOpts(invoke: Invoke) {
        val a = invoke.parseArgs(RenderOptsArgs::class.java)
        activity.runOnUiThread {
            storedRenderOpts.clear()
            val failed = JSONArray()
            val live = mpv
            for (opt in a.opts) {
                val key = opt.key.trim()
                if (key.isEmpty()) continue
                storedRenderOpts[key] = opt.value
                if (live != null) {
                    try {
                        live.setPropertyString(key, opt.value)
                    } catch (e: Exception) {
                        failed.put(key)
                    }
                }
            }
            invoke.resolve(JSObject().put("failed", failed))
        }
    }

    /**
     * Keep the native SurfaceView aligned with the web player shell. In portrait the WebView
     * presents a YouTube-style watch page with a 16:9 video at the top; in landscape the video
     * returns to a full-screen immersive surface. Values arrive in physical pixels because Android
     * layout params do not use WebView CSS pixels.
     *
     * Returns the window's safe-area insets as { top, right, bottom, left } physical pixels. Must
     * run on the UI thread.
     */
    private fun setVideoZOrderOnTop(onTop: Boolean) {
        view?.setZOrderOnTop(onTop)
        (nativeDvView?.videoSurfaceView as? android.view.SurfaceView)?.setZOrderOnTop(onTop)
    }

    private fun applyViewport(a: ViewportArgs): JSObject {
        setImmersive(a.immersive)
        val rootInsets = ViewCompat.getRootWindowInsets(activity.window.decorView)
        val cutout = rootInsets?.getInsetsIgnoringVisibility(
            WindowInsetsCompat.Type.displayCutout(),
        ) ?: Insets.NONE
        val status = if (a.immersive) Insets.NONE else rootInsets?.getInsetsIgnoringVisibility(
            WindowInsetsCompat.Type.statusBars(),
        ) ?: Insets.NONE
        val navigation = if (a.immersive) Insets.NONE else rootInsets?.getInsetsIgnoringVisibility(
            WindowInsetsCompat.Type.navigationBars(),
        ) ?: Insets.NONE
        val safeTop = max(cutout.top, status.top)
        val safeRight = max(cutout.right, max(status.right, navigation.right))
        val safeBottom = max(cutout.bottom, navigation.bottom)
        val safeLeft = max(cutout.left, max(status.left, navigation.left))
        Log.i(
            "MpvPlugin",
            "viewport immersive=${a.immersive} top=$safeTop height=${a.height}",
        )
        container?.let { playerContainer ->
            val height = if (a.height > 0) a.height else ViewGroup.LayoutParams.MATCH_PARENT
            val width = if (a.width > 0) a.width else ViewGroup.LayoutParams.MATCH_PARENT
            val params = (playerContainer.layoutParams as? FrameLayout.LayoutParams)
                ?: FrameLayout.LayoutParams(width, height)
            params.width = width
            params.height = height
            params.leftMargin = a.left.coerceAtLeast(0)
            params.topMargin = a.top.coerceAtLeast(0) + if (a.immersive) 0 else safeTop
            playerContainer.layoutParams = params
            // Once browse content is painted again it would cover a behind-WebView SurfaceView.
            // Raise only the bounded mini rectangle; the adjacent HTML transport remains clickable.
            setVideoZOrderOnTop(a.floating)
            // A viewport settle returns the whole player rectangle to identity. The child
            // SurfaceView is never transformed independently.
            playerContainer.scaleX = 1f
            playerContainer.scaleY = 1f
            playerContainer.translationX = 0f
            playerContainer.translationY = 0f
            playerContainer.requestLayout()
        }
        val ret = JSObject()
        ret.put("top", safeTop)
        ret.put("right", safeRight)
        ret.put("bottom", safeBottom)
        ret.put("left", safeLeft)
        return ret
    }

    @Command
    fun viewport(invoke: Invoke) {
        val a = invoke.parseArgs(ViewportArgs::class.java)
        activity.runOnUiThread {
            lastViewport = a
            // In (or entering) picture-in-picture the container must stay a plain fill. The web shell
            // still re-syncs on the PiP window's resize, and applying the watch-page geometry there
            // is exactly what pushed the video out of the miniplayer. Insets are still reported so
            // the caller's own layout maths stay correct.
            val ret = if (pipActive || pipRequested) {
                val fill = JSObject()
                fill.put("top", 0)
                fill.put("right", 0)
                fill.put("bottom", 0)
                fill.put("left", 0)
                fill
            } else {
                val insets = applyViewport(a)
                // The video rectangle just moved, so the auto-enter source hint is stale.
                publishPipParams()
                insets
            }
            invoke.resolve(ret)
        }
    }

    /**
     * Live scale + vertical translate of the clipped player container for the portrait
     * pull-to-fullscreen gesture. The video, black frame and HTML-aligned viewport therefore move
     * as one bounded rectangle. Identity is restored by [viewport] on the next settle.
     */
    @Command
    fun transform(invoke: Invoke) {
        val a = invoke.parseArgs(TransformArgs::class.java)
        activity.runOnUiThread {
            // PiP owns a plain fill layout. A coalesced WebView drag command may already be queued
            // when Home triggers auto-PiP; accepting it after applyPipLayout() is what left the
            // system miniplayer scaled and offset. The next normal viewport settle restores gesture
            // transforms outside PiP, so ignoring them here loses no legitimate state.
            if (pipActive || pipRequested) {
                invoke.resolve()
                return@runOnUiThread
            }
            container?.let { playerContainer ->
                setVideoZOrderOnTop(a.floating)
                playerContainer.pivotX = playerContainer.width / 2f
                playerContainer.pivotY = playerContainer.height / 2f
                val s = a.scale.toFloat().coerceIn(0.2f, 4f)
                playerContainer.scaleX = s
                playerContainer.scaleY = s
                playerContainer.translationX = a.translateX.toFloat()
                playerContainer.translationY = a.translateY.toFloat()
            }
            invoke.resolve()
        }
    }

    /** Enter the landscape player from the portrait watch page, or return to portrait. */
    @Command
    fun fullscreen(invoke: Invoke) {
        val a = invoke.parseArgs(FullscreenArgs::class.java)
        activity.runOnUiThread {
            if (a.enabled) {
                enterLandscapeWithSensorReturn()
            } else {
                stopLandscapeReleaseListener()
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                // Release the temporary portrait request once rotation has settled so turning the
                // phone naturally can enter landscape again on the next playback interaction.
                activity.window.decorView.postDelayed({
                    if (activity.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT) {
                        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                    }
                }, 650L)
            }
            invoke.resolve()
        }
    }

    /** Set window brightness (0..1), or -1 to restore system/auto. Must touch the window on UI thread. */
    @Command
    fun brightness(invoke: Invoke) {
        val a = invoke.parseArgs(BrightnessArgs::class.java)
        activity.runOnUiThread {
            val lp = activity.window.attributes
            lp.screenBrightness = if (a.value < 0) -1f else a.value.toFloat().coerceIn(0.01f, 1f)
            activity.window.attributes = lp
            invoke.resolve()
        }
    }

    /** Fire a short haptic pulse (ms). Requires the VIBRATE permission (declared in the plugin manifest). */
    @Command
    fun haptic(invoke: Invoke) {
        val a = invoke.parseArgs(HapticArgs::class.java)
        val vib = if (Build.VERSION.SDK_INT >= 31) {
            (activity.getSystemService(android.content.Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(android.content.Context.VIBRATOR_SERVICE) as Vibrator
        }
        if (Build.VERSION.SDK_INT >= 26) {
            vib.vibrate(VibrationEffect.createOneShot(a.ms.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vib.vibrate(a.ms.toLong())
        }
        invoke.resolve()
    }

    /** Extract a preview frame at `timeSec` via MediaMetadataRetriever. Off the UI thread — decoding
     *  a network frame is slow. Resolves { value: dataUrl } or { value: null } when unsupported. */
    @Command
    fun thumb(invoke: Invoke) {
        val a = invoke.parseArgs(ThumbArgs::class.java)
        Thread {
            val ret = JSObject()
            try {
                // release() must be in a finally: it used to sit on the happy path, so any throw
                // from setDataSource/getFrameAtTime (a dead link, a timeout) left the retriever's
                // native decoder to the finalizer. Under scrub pressure that stacks up.
                val mmr = MediaMetadataRetriever()
                val bmp = try {
                    if (a.headers.isEmpty()) mmr.setDataSource(a.url, HashMap())
                    else mmr.setDataSource(a.url, HashMap(a.headers))
                    val us = (a.timeSec * 1_000_000L).toLong()
                    if (Build.VERSION.SDK_INT >= 27) {
                        mmr.getScaledFrameAtTime(
                            us,
                            MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
                            a.width,
                            a.width * 9 / 16,
                        )
                    } else {
                        mmr.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                    }
                } finally {
                    mmr.release()
                }
                if (bmp != null) {
                    val bos = ByteArrayOutputStream()
                    bmp.compress(Bitmap.CompressFormat.JPEG, 70, bos)
                    ret.put(
                        "value",
                        "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP),
                    )
                } else {
                    ret.put("value", null as String?)
                }
            } catch (e: Exception) {
                Log.w("MpvPlugin", "thumb failed: ${e.message}")
                ret.put("value", null as String?)
            }
            invoke.resolve(ret)
        }.start()
    }

    /** Store and live-apply the complete encoded-audio/HDR output policy. */
    @Command
    fun setDolbyOpts(invoke: Invoke) {
        val a = invoke.parseArgs(RenderOptsArgs::class.java)
        activity.runOnUiThread {
            storedDolbyOpts.clear()
            val failed = JSONArray()
            val live = mpv
            for (opt in a.opts) {
                val key = opt.key.trim()
                if (key.isEmpty()) continue
                storedDolbyOpts[key] = opt.value
                if (live != null) {
                    try {
                        live.setPropertyString(key, opt.value)
                    } catch (e: Exception) {
                        failed.put(key)
                    }
                }
            }
            if (live != null && a.opts.any { it.key.startsWith("audio-") }) {
                runCatching { live.command(arrayOf("ao-reload")) }
            }
            invoke.resolve(JSObject().put("failed", failed))
        }
    }

    private fun encodingName(encoding: Int): String = when (encoding) {
        AudioFormat.ENCODING_AC3 -> "ac3"
        AudioFormat.ENCODING_E_AC3 -> "eac3"
        AudioFormat.ENCODING_E_AC3_JOC -> "eac3-joc"
        AudioFormat.ENCODING_DOLBY_TRUEHD -> "truehd"
        AudioFormat.ENCODING_DOLBY_MAT -> "mat"
        AudioFormat.ENCODING_DTS -> "dts"
        AudioFormat.ENCODING_DTS_HD -> "dts-hd"
        AudioFormat.ENCODING_DTS_HD_MA -> "dts-hd-ma"
        AudioFormat.ENCODING_DTS_UHD_P1 -> "dts-uhd-p1"
        AudioFormat.ENCODING_DTS_UHD_P2 -> "dts-uhd-p2"
        else -> encoding.toString()
    }

    private fun mediaAudioAttributes(): AudioAttributes =
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build()

    private fun routedAudioDevices(manager: AudioManager): List<AudioDeviceInfo> {
        if (Build.VERSION.SDK_INT >= 33) {
            return runCatching { manager.getAudioDevicesForAttributes(mediaAudioAttributes()) }
                .getOrDefault(emptyList())
        }
        if (Build.VERSION.SDK_INT < 23) return emptyList()
        // Android did not expose predicted media routing before API 33. Restrict the fallback to
        // currently connected digital endpoints; never infer passthrough from the phone speaker or
        // from a decoder/offload capability. The diagnostics label this result as inferred.
        return manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).filter { device ->
            device.type == AudioDeviceInfo.TYPE_HDMI ||
                device.type == AudioDeviceInfo.TYPE_HDMI_ARC ||
                (Build.VERSION.SDK_INT >= 29 && device.type == AudioDeviceInfo.TYPE_HDMI_EARC) ||
                device.type == AudioDeviceInfo.TYPE_USB_DEVICE ||
                device.type == AudioDeviceInfo.TYPE_USB_HEADSET
        }
    }

    private fun directAudioSupported(manager: AudioManager, encoding: Int): Boolean {
        val routed = routedAudioDevices(manager)
        if (routed.none { encoding in it.encodings }) return false
        if (Build.VERSION.SDK_INT < 33) return true
        val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build()
        return listOf(
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.CHANNEL_OUT_5POINT1,
            AudioFormat.CHANNEL_OUT_7POINT1_SURROUND,
        ).any { mask ->
            runCatching {
                val format = AudioFormat.Builder()
                    .setEncoding(encoding)
                    .setSampleRate(48_000)
                    .setChannelMask(mask)
                    .build()
                val support = AudioManager.getDirectPlaybackSupport(format, attributes)
                support and AudioManager.DIRECT_PLAYBACK_BITSTREAM_SUPPORTED != 0
            }.getOrDefault(false)
        }
    }

    private fun hasDolbyVisionDecoder(): Boolean = runCatching {
        MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.any { codec ->
            !codec.isEncoder && codec.supportedTypes.any {
                it.equals(MediaFormat.MIMETYPE_VIDEO_DOLBY_VISION, ignoreCase = true)
            }
        }
    }.getOrDefault(false)

    private fun decoderProfiles(mime: String): List<MediaCodecInfo.CodecProfileLevel> = runCatching {
        MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
            .asSequence()
            .filter { !it.isEncoder && it.supportedTypes.any { type -> type.equals(mime, ignoreCase = true) } }
            .flatMap { it.getCapabilitiesForType(mime).profileLevels.asSequence() }
            .toList()
    }.getOrDefault(emptyList())

    private fun dolbyVisionProfileName(profile: Int): String? = when (profile) {
        MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheDer,
        MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheDen -> "4"
        MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheStn -> "5"
        MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheDtr,
        MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheDth,
        MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheDtb -> "7"
        MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheSt -> "8"
        MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvavPen,
        MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvavPer,
        MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvavSe -> "9"
        MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvav110 -> "10"
        else -> null
    }

    private fun currentVideoTrackSupport(): Pair<Boolean?, String> {
        val groups = nativeDvPlayer?.currentTracks?.groups ?: return null to ""
        for (group in groups) {
            if (group.type != C.TRACK_TYPE_VIDEO) continue
            for (index in 0 until group.length) {
                if (group.isTrackSelected(index)) {
                    return group.isTrackSupported(index) to group.getTrackFormat(index).codecs.orEmpty()
                }
            }
        }
        return null to ""
    }

    private fun dolbyCapabilitiesSnapshot(): JSObject {
        val manager = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val devices = routedAudioDevices(manager)
        val deviceJson = JSONArray()
        for (device in devices) {
            val encodings = JSONArray()
            for (encoding in device.encodings) encodings.put(encodingName(encoding))
            deviceJson.put(JSObject()
                .put("id", device.id.toString())
                .put("name", device.productName?.toString() ?: "Android output")
                .put("encodings", encodings))
        }
        val ac3 = directAudioSupported(manager, AudioFormat.ENCODING_AC3)
        val eac3 = directAudioSupported(manager, AudioFormat.ENCODING_E_AC3)
        val joc = Build.VERSION.SDK_INT >= 28 &&
            directAudioSupported(manager, AudioFormat.ENCODING_E_AC3_JOC)
        val truehd = directAudioSupported(manager, AudioFormat.ENCODING_DOLBY_TRUEHD)
        val mat = Build.VERSION.SDK_INT >= 29 &&
            directAudioSupported(manager, AudioFormat.ENCODING_DOLBY_MAT)
        val dts = directAudioSupported(manager, AudioFormat.ENCODING_DTS)
        val dtsHd = directAudioSupported(manager, AudioFormat.ENCODING_DTS_HD)
        val dtsHdMa = Build.VERSION.SDK_INT >= 35 &&
            directAudioSupported(manager, AudioFormat.ENCODING_DTS_HD_MA)
        val dtsUhdP1 = Build.VERSION.SDK_INT >= 34 &&
            directAudioSupported(manager, AudioFormat.ENCODING_DTS_UHD_P1)
        val dtsUhdP2 = Build.VERSION.SDK_INT >= 36 &&
            directAudioSupported(manager, AudioFormat.ENCODING_DTS_UHD_P2)
        val hdrTypes = if (Build.VERSION.SDK_INT >= 24) supportedHdrTypes() else intArrayOf()
        val dvDisplay = Build.VERSION.SDK_INT >= 24 &&
            hdrTypes.contains(Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION)
        val hdr10Display = Build.VERSION.SDK_INT >= 24 &&
            hdrTypes.contains(Display.HdrCapabilities.HDR_TYPE_HDR10)
        val hlgDisplay = Build.VERSION.SDK_INT >= 24 &&
            hdrTypes.contains(Display.HdrCapabilities.HDR_TYPE_HLG)
        val hdr10PlusDisplay = Build.VERSION.SDK_INT >= 29 &&
            hdrTypes.contains(Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS)
        val decoder = hasDolbyVisionDecoder()
        val nativeVideo = nativeDvPlayer?.videoFormat
        val (currentSupported, currentCodecString) = currentVideoTrackSupport()
        val nativeDvActive = nativeHdrType == "dolby-vision" && nativeDvPlayer != null &&
            nativeVideo?.sampleMimeType == MediaFormat.MIMETYPE_VIDEO_DOLBY_VISION && currentSupported == true
        val nativeHdr10PlusActive = nativeHdrType == "hdr10-plus" && nativeDvPlayer != null &&
            nativeVideo?.colorInfo?.colorTransfer == C.COLOR_TRANSFER_ST2084 && currentSupported == true
        val nativeHlgActive = nativeHdrType == "hlg" && nativeDvPlayer != null &&
            nativeVideo?.colorInfo?.colorTransfer == C.COLOR_TRANSFER_HLG && currentSupported == true
        val dvProfiles = decoderProfiles(MediaFormat.MIMETYPE_VIDEO_DOLBY_VISION)
            .mapNotNull { dolbyVisionProfileName(it.profile) }.distinct().sorted()
        val hevcMain10 = decoderProfiles(MediaFormat.MIMETYPE_VIDEO_HEVC).any { it.profile in setOf(
            MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10,
            MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10,
            MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10Plus,
        ) }
        val av1Main10 = decoderProfiles(MediaFormat.MIMETYPE_VIDEO_AV1).any { it.profile in setOf(
            MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10,
            MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10HDR10,
            MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10HDR10Plus,
        ) }
        val vp9Profile2 = decoderProfiles(MediaFormat.MIMETYPE_VIDEO_VP9).any { it.profile in setOf(
            MediaCodecInfo.CodecProfileLevel.VP9Profile2,
            MediaCodecInfo.CodecProfileLevel.VP9Profile2HDR,
            MediaCodecInfo.CodecProfileLevel.VP9Profile2HDR10Plus,
        ) }
        val currentVo = nativeProperty("current-vo") ?: mpv?.getPropertyString("current-vo").orEmpty()
        val limitations = JSONArray()
            .put("Android Atmos is IEC-61937 passthrough; the connected receiver performs object rendering.")
        if (nativeDvActive) {
            limitations.put("Native Dolby Vision is device/profile dependent; Profile 7 FEL is not claimed without hardware validation.")
        } else {
            limitations.put("The current mpv mediacodec-copy/gpu path cannot claim native Dolby Vision output.")
        }
        return JSObject()
            .put("platform", "android")
            .put("engine", if (nativeDvPlayer != null) "Media3/MediaCodec" else "libmpv/AudioTrack")
            .put("mpvVersion", mpv?.getPropertyString("mpv-version").orEmpty())
            .put("audioConfidence", if (Build.VERSION.SDK_INT >= 33) "reported" else "inferred")
            .put("audio", JSObject()
                .put("ac3", ac3).put("eac3", eac3).put("eac3Joc", joc)
                .put("truehd", truehd).put("mat", mat)
                .put("dts", dts).put("dtsHd", dtsHd).put("dtsHdMa", dtsHdMa)
                .put("dtsX", dtsUhdP1 || dtsUhdP2))
            .put("audioDevices", deviceJson)
            .put("receiverDetected", devices.isNotEmpty())
            .put("recommendedAudioDevice", devices.firstOrNull()?.id?.toString().orEmpty())
            .put("displays", JSONArray().put(JSObject()
                .put("id", activity.display?.displayId?.toString() ?: "android-display")
                .put("name", "Android display")
                .put("connection", "Android routed display")
                .put("hdrSupported", hdrTypes.isNotEmpty())
                .put("hdrEnabled", null as Boolean?)
                .put("bitsPerColor", null as Int?)
                .put("source", "os")))
            .put("video", JSObject()
                .put("hdr10Display", hdr10Display)
                .put("hdr10PlusDisplay", hdr10PlusDisplay)
                .put("hlgDisplay", hlgDisplay)
                .put("dolbyVisionDisplay", dvDisplay)
                .put("dolbyVisionDecoder", decoder)
                .put("dolbyVisionNativePath", nativeDvActive)
                .put("hdr10PlusNativePath", nativeHdr10PlusActive)
                .put("hlgNativePath", nativeHlgActive)
                .put("nativeHdrType", nativeHdrType.orEmpty())
                .put("dolbyVisionAwareRenderer", currentVo == "gpu-next" || nativeDvActive))
            .put("codecs", JSObject()
                .put("dolbyVisionProfiles", JSONArray(dvProfiles))
                .put("hevcMain10", hevcMain10)
                .put("av1Main10", av1Main10)
                .put("vp9Profile2", vp9Profile2)
                .put("currentCodecString", currentCodecString)
                .put("currentSupported", currentSupported)
                .put("currentReason", if (currentSupported == null)
                    "No native Media3 video track is active."
                else "Media3 checked the selected profile, level, size and frame rate against CodecCapabilities."))
            .put("current", JSObject()
                .put("ao", nativeProperty("current-ao") ?: mpv?.getPropertyString("current-ao").orEmpty())
                .put("vo", currentVo)
                .put("audioDevice", nativeProperty("audio-device") ?: mpv?.getPropertyString("audio-device").orEmpty())
                .put("audioCodec", nativeProperty("audio-codec-name") ?: mpv?.getPropertyString("audio-codec-name").orEmpty())
                .put("audioFormat", nativeProperty("audio-params/format") ?: mpv?.getPropertyString("audio-params/format").orEmpty())
                .put("videoFormat", nativeProperty("video-format") ?: mpv?.getPropertyString("video-format").orEmpty())
                .put("videoProfile", nativeProperty("video-params/codec-profile") ?: mpv?.getPropertyString("video-params/codec-profile").orEmpty())
                .put("videoPrimaries", nativeProperty("video-params/primaries") ?: mpv?.getPropertyString("video-params/primaries").orEmpty())
                .put("videoTransfer", nativeProperty("video-params/gamma") ?: mpv?.getPropertyString("video-params/gamma").orEmpty()))
            .put("limitations", limitations)
    }

    @Command
    fun dolbyCapabilities(invoke: Invoke) {
        activity.runOnUiThread { invoke.resolve(dolbyCapabilitiesSnapshot()) }
    }

    /** Capture the frame that is on the live player without publishing it to the gallery. The
     * subtitle editor uses this still as its background after pausing playback. Asking mpv for
     * `video` excludes the old subtitle line; PixelCopy remains a fallback for hardware surfaces
     * that cannot be read through mpv's software screenshot path. */
    @Command
    fun snapshot(invoke: Invoke) {
        if (nativeDvPlayer != null) {
            // Protected/secure Dolby surfaces intentionally cannot be read back. The subtitle
            // editor remains available after choosing an mpv fallback source.
            invoke.resolve(JSObject().apply { put("value", null as String?) })
            return
        }
        val m = mpv
        if (m == null) {
            invoke.resolve(JSObject().apply { put("value", null as String?) })
            return
        }
        Thread {
            val ret = JSObject()
            val file = File(activity.cacheDir, "subtitle-editor-${System.currentTimeMillis()}.jpg")
            try {
                m.setPropertyString("screenshot-format", "jpg")
                m.setPropertyString("screenshot-jpeg-quality", "90")
                m.setPropertyString("screenshot-sw", "yes")
                m.command(arrayOf("screenshot-to-file", file.absolutePath, "video"))
                val deadline = System.currentTimeMillis() + 1_500L
                while (System.currentTimeMillis() < deadline && (!file.isFile || file.length() == 0L)) {
                    Thread.sleep(15L)
                }
                if ((!file.isFile || file.length() == 0L) && !copyVisibleFrame(file)) {
                    ret.put("value", null as String?)
                } else {
                    ret.put(
                        "value",
                        "data:image/jpeg;base64," + Base64.encodeToString(file.readBytes(), Base64.NO_WRAP),
                    )
                }
            } catch (e: Exception) {
                Log.w("MpvPlugin", "subtitle editor snapshot failed: ${e.message}")
                ret.put("value", null as String?)
            } finally {
                file.delete()
            }
            invoke.resolve(ret)
        }.start()
    }

    // --- GIF recording ------------------------------------------------------------------------
    //
    // Same shape as the desktop recorder: bounded JPEG frames are pulled straight out of the LIVE
    // core with `screenshot-to-file`, so signed/DRM-free-but-header-gated streams are captured
    // exactly as mpv renders them and nothing has to reopen the source. Android has no ffmpeg, so
    // the palette + LZW encode happens in Rust (`android_gif_encode`) and the finished file is
    // published to the gallery by [gifSave].

    /** Hardware surfaces are not always readable through mpv's screenshot path on Android. When
     * that path fails, PixelCopy gives us the frame the user can actually see instead of ending a
     * recording with an empty directory. The destination is bounded because GIF encoding scales to
     * 480 px anyway; avoiding a full-resolution bitmap matters on memory-constrained phones. */
    private fun copyVisibleFrame(file: File): Boolean {
        if (Build.VERSION.SDK_INT < 24) return false
        val surface = view ?: return false
        val sourceWidth = surface.width
        val sourceHeight = surface.height
        if (sourceWidth <= 0 || sourceHeight <= 0 || !surface.isShown) return false
        val width = minOf(sourceWidth, 640)
        val height = max(1, sourceHeight * width / sourceWidth)
        val bitmap = try {
            Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        } catch (_: Exception) {
            return false
        }
        val done = CountDownLatch(1)
        var result = PixelCopy.ERROR_UNKNOWN
        activity.runOnUiThread {
            if (view !== surface || !surface.isShown) {
                done.countDown()
                return@runOnUiThread
            }
            try {
                PixelCopy.request(surface, bitmap, { code -> result = code; done.countDown() }, Handler(Looper.getMainLooper()))
            } catch (_: Exception) {
                done.countDown()
            }
        }
        val completed = try { done.await(1_500L, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            false
        }
        val saved = completed && result == PixelCopy.SUCCESS && try {
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        } catch (_: Exception) {
            false
        }
        bitmap.recycle()
        if (!saved) file.delete()
        return saved && file.isFile && file.length() > 0L
    }

    /** Prevent Android's display timeout only while the web player says video is actively playing.
     *
     *  FLAG_KEEP_SCREEN_ON lives on the WINDOW, and a window rebuilt by the system — entering or
     *  leaving picture-in-picture, an activity recreation, a restore after process death — comes
     *  back WITHOUT it. The `keepScreenAwakeOn` cache below then made that unrecoverable: it
     *  recorded what we last asked for, the guard treated it as what the window actually has, and
     *  so every later "keep awake" request was skipped as a no-op while the real flag stayed off
     *  for the rest of the session. That is the screen-sleeps-mid-episode report.
     *
     *  The durable half is therefore owned by the VIEW: View.keepScreenOn is re-applied by the
     *  framework whenever the view re-attaches, so it survives exactly the rebuilds that lose a
     *  window flag, and it cannot desync from a cached boolean because there is nothing to cache.
     *  The window flag is kept alongside it for the case where the surface container does not
     *  exist yet, and its guard now only protects the relayout — see setKeepScreenAwake. */
    @Command
    fun keepScreenAwake(invoke: Invoke) {
        val a = invoke.parseArgs(KeepScreenAwakeArgs::class.java)
        activity.runOnUiThread {
            setKeepScreenAwake(a.enabled)
            invoke.resolve()
        }
    }

    /** Apply the desired keep-awake state. UI thread only. */
    private fun setKeepScreenAwake(enabled: Boolean) {
        // Idempotent and local: View.setFlags early-returns when the value is unchanged, so this
        // costs nothing on a repeat and never reaches WindowManagerService.
        container?.keepScreenOn = enabled
        // Skip repeats on the WINDOW path only: addFlags/clearFlags dispatch a relayout (a binder
        // round-trip) even when the value is unchanged, and the web side used to re-request this
        // per video frame — a relayout storm that saturated the main looper for entire episodes.
        // The guard is safe here precisely because the view above, not this cache, is what has to
        // survive a window rebuild.
        if (enabled != keepScreenAwakeOn) {
            keepScreenAwakeOn = enabled
            if (enabled) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    @Command
    fun gifStart(invoke: Invoke) {
        if (nativeDvPlayer != null) {
            invoke.reject("native-dolby-vision-capture-unavailable")
            return
        }
        val a = invoke.parseArgs(GifStartArgs::class.java)
        val m = mpv
        if (m == null) {
            invoke.reject("mpv-not-running")
            return
        }
        if (gifSession != null) {
            invoke.reject("gif-already-recording")
            return
        }
        val dir = File(activity.cacheDir, "gif-capture/${System.currentTimeMillis()}")
        if (!dir.mkdirs() && !dir.isDirectory) {
            invoke.reject("gif-dir-failed")
            return
        }
        val session = GifSession(dir)
        val mode = if (a.includeSubtitles) "subtitles" else "video"
        val worker = Thread {
            m.setPropertyString("screenshot-format", "jpg")
            m.setPropertyString("screenshot-jpeg-quality", "90")
            // Software readback: the GPU surface is not guaranteed to be readable on Android.
            m.setPropertyString("screenshot-sw", "yes")
            val started = System.currentTimeMillis()
            var useSurfaceFallback = false
            while (!session.stop &&
                session.frames < GIF_MAX_FRAMES &&
                System.currentTimeMillis() - started < GIF_MAX_MS
            ) {
                val frameStart = System.currentTimeMillis()
                val file = File(session.dir, String.format(Locale.US, "f%05d.jpg", session.frames))
                if (!useSurfaceFallback) {
                    // The command queues the screenshot. Wait for mpv's encoder instead of deleting
                    // the destination immediately and racing every frame write.
                    m.command(arrayOf("screenshot-to-file", file.absolutePath, mode))
                    val writeDeadline = System.currentTimeMillis() + 1_000L
                    while (!session.stop && System.currentTimeMillis() < writeDeadline &&
                        (!file.isFile || file.length() == 0L)
                    ) {
                        try {
                            Thread.sleep(10L)
                        } catch (e: InterruptedException) {
                            Thread.currentThread().interrupt()
                            break
                        }
                    }
                }
                var captured = file.isFile && file.length() > 0L
                if (!captured && !session.stop) {
                    useSurfaceFallback = true
                    file.delete()
                    captured = copyVisibleFrame(file)
                }
                if (captured) {
                    session.frames += 1
                    session.capturedMs = System.currentTimeMillis() - started
                } else {
                    file.delete()
                }
                val spent = System.currentTimeMillis() - frameStart
                if (spent < GIF_FRAME_INTERVAL_MS) {
                    try {
                        Thread.sleep(GIF_FRAME_INTERVAL_MS - spent)
                    } catch (e: InterruptedException) {
                        Thread.currentThread().interrupt()
                        break
                    }
                }
            }
        }
        session.thread = worker
        gifSession = session
        gifWorker = worker
        worker.start()
        invoke.resolve()
    }

    /** Stop capturing and hand back the frame directory for encoding. */
    @Command
    fun gifStop(invoke: Invoke) {
        val session = gifSession
        gifSession = null
        if (session == null) {
            invoke.reject("gif-not-recording")
            return
        }
        session.stop = true
        // Join off the caller's thread: the worker may be inside a blocking screenshot.
        Thread {
            try {
                session.thread?.join(5_000)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            val ret = JSObject()
            ret.put("dir", session.dir.absolutePath)
            ret.put("frames", session.frames)
            ret.put("capturedMs", session.capturedMs)
            invoke.resolve(ret)
        }.start()
    }

    /** Cancel a live capture and drop its frames. Safe to call when nothing is recording. */
    @Command
    fun gifAbort(invoke: Invoke) {
        val session = gifSession
        gifSession = null
        if (session != null) {
            session.stop = true
            Thread {
                try {
                    session.thread?.join(5_000)
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                }
                session.dir.deleteRecursively()
            }.start()
        }
        invoke.resolve()
    }

    /**
     * Publish an encoded GIF to the gallery and clean up the working files.
     *
     * API 29+ uses MediaStore, which needs no storage permission and puts the file in Pictures/izumi
     * where the gallery picks it up. Older devices would need the legacy WRITE_EXTERNAL_STORAGE
     * permission for that, which is not worth requesting, so they get the app-scoped Pictures folder.
     */
    @Command
    fun gifSave(invoke: Invoke) {
        val a = invoke.parseArgs(GifSaveArgs::class.java)
        Thread {
            val source = File(a.path)
            val cleanup = {
                source.delete()
                a.cleanupDir?.takeIf { it.isNotBlank() }?.let { File(it).deleteRecursively() }
                Unit
            }
            try {
                if (!source.isFile || source.length() == 0L) error("gif-missing")
                val name = "izumi-gif-${System.currentTimeMillis()}.gif"
                val location: String
                if (Build.VERSION.SDK_INT >= 29) {
                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                        put(MediaStore.MediaColumns.MIME_TYPE, "image/gif")
                        put(
                            MediaStore.MediaColumns.RELATIVE_PATH,
                            Environment.DIRECTORY_PICTURES + "/izumi",
                        )
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }
                    val resolver = activity.contentResolver
                    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                        ?: error("gif-insert-failed")
                    resolver.openOutputStream(uri).use { out ->
                        if (out == null) error("gif-open-failed")
                        source.inputStream().use { it.copyTo(out) }
                    }
                    values.clear()
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                    location = "Pictures/izumi"
                } else {
                    val dir = activity.getExternalFilesDir(Environment.DIRECTORY_PICTURES)
                        ?: activity.filesDir
                    dir.mkdirs()
                    source.copyTo(File(dir, name), overwrite = true)
                    location = dir.absolutePath
                }
                cleanup()
                val ret = JSObject()
                ret.put("name", name)
                ret.put("location", location)
                invoke.resolve(ret)
            } catch (e: Exception) {
                cleanup()
                Log.w("MpvPlugin", "gifSave failed: ${e.message}")
                invoke.reject(e.message ?: "gif-save-failed")
            }
        }.start()
    }

    @Command
    fun stop(invoke: Invoke) {
        val recording = gifSession
        gifSession = null
        recording?.stop = true
        // Stop decoding right now rather than behind the join below. Waiting on a GIF worker can
        // take the full 5 s on a stalled stream, and until the core stops the user still hears
        // audio and auto-enter stays armed — pressing home in that window would still shrink the
        // app into a miniplayer. libmpv's command queue is thread-safe, so this needs no hop.
        mpv?.command(arrayOf("stop"))
        nativeDvPlayer?.stop()
        // Disarm Android 12+ auto-enter immediately. Teardown may legitimately wait several
        // seconds for a GIF worker, during which the prepared core still exists.
        activity.runOnUiThread {
            mediaLoaded = false
            publishPipParams()
        }
        // A GIF worker pulls frames out of the LIVE core, so destroying the handle while it sits in
        // a blocking `screenshot-to-file` (which is exactly what it does on a stalled network
        // stream) is a use-after-free. Wait for it to exit BEFORE tearing the core down — on a
        // background thread, because that wait must never block the UI thread. `gifWorker` outlives
        // the session, so a capture that gifAbort already detached is still waited on here, and it
        // is cleared only once the wait is over: clearing it up front let a second `stop()` see no
        // worker and tear the core down underneath the first one's join.
        val worker = gifWorker?.takeIf { it.isAlive }
        if (worker == null) {
            gifWorker = null
            recording?.dir?.deleteRecursively()
            activity.runOnUiThread { teardownCore(invoke) }
            return
        }
        Thread {
            try {
                worker.join(5_000)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            gifWorker = null
            recording?.dir?.deleteRecursively()
            activity.runOnUiThread { teardownCore(invoke) }
        }.start()
    }

    /** Release everything the core owns. UI thread only, and only once no GIF worker is live. */
    private fun teardownCore(invoke: Invoke) {
        stopLandscapeReleaseListener()
        unregisterPipReceiver()
        removePipWatcher()
        removeAutoPipHook()
        removeResumeGuard()
        teardownMediaSession()
        pipActive = false
        pipRequested = false
        pipSourceHint = null
        corePaused = false
        mediaLoaded = false
        lastViewport = null
        showWebPlayerUi(true)
        setImmersive(false)
        container?.keepScreenOn = false
        keepScreenAwakeOn = false
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        container?.let { (it.parent as? ViewGroup)?.removeView(it) }
        releaseNativeDolbyVision(removeContainer = false)
        mpv?.let {
            it.command(arrayOf("stop"))
            it.removeObserver(this)
            it.destroy()
        }
        mpv = null
        view = null
        container = null
        webView?.let { web ->
            webViewHapticsWereEnabled?.let { web.isHapticFeedbackEnabled = it }
        }
        webViewHapticsWereEnabled = null
        webView = null
        pendingSurfaceLoad = null
        // The system is still holding the last params, which armed auto-enter. Publish once more
        // with no core so it is disarmed, or pressing home would shrink the whole app into a
        // miniplayer long after playback ended.
        publishPipParams()
        invoke.resolve()
    }

    // --- MPVLib.EventObserver → forward to JS (addPluginListener('mpv','progress'|'event', cb)) ---
    override fun eventProperty(property: String) {}
    override fun eventProperty(property: String, value: Long) {
        trigger("progress", JSObject().put("property", property).put("value", value))
    }
    override fun eventProperty(property: String, value: Boolean) {
        // Keep the miniplayer's play/pause button, the auto-enter arming and the notification
        // transport honest. Posted to the UI thread: this callback runs on libmpv's event thread
        // holding its observer monitor, and pipParams() reads back from the core (see the note in
        // `event` below).
        if (property == "pause") {
            activity.window.decorView.post {
                corePaused = value
                updatePipActions()
                MediaController.setPlaying(!value)
            }
        }
        trigger("progress", JSObject().put("property", property).put("value", value))
    }
    override fun eventProperty(property: String, value: String) {
        trigger("progress", JSObject().put("property", property).put("value", value))
    }
    override fun eventProperty(property: String, value: Double) {
        // MediaController hops to the main thread itself and throttles its own publishing, so the
        // per-frame time-pos stream costs a comparison here and nothing more.
        when (property) {
            "time-pos" -> MediaController.setPosition(value)
            "duration" -> MediaController.setDuration(value)
        }
        trigger("progress", JSObject().put("property", property).put("value", value))
    }
    override fun event(eventId: Int) {
        // MPVLib dispatches observers while holding its observer monitor on the native event
        // thread. Never call back into synchronous libmpv APIs from that callback: FILE_LOADED can
        // otherwise leave metadata (including duration) visible while the event loop and decoder
        // remain stuck at 0:00. Posting also preserves the original reason for waiting until
        // FILE_LOADED: adding sidecars immediately after `loadfile` races the async replacement.
        if (eventId == 7) {
            activity.window.decorView.post {
                mediaLoaded = false
                publishPipParams()
            }
        } else if (eventId == 8) {
            val loadedCore = mpv
            activity.window.decorView.post {
                if (loadedCore == null || mpv !== loadedCore) return@post
                mediaLoaded = true
                publishPipParams()
                val pending = pendingSubtitles
                if (pending != null && loadedCore.getPropertyString("path") == pending.url) {
                    pendingSubtitles = null
                    for (subtitle in pending.tracks) {
                        if (subtitle.url.isBlank()) continue
                        loadedCore.command(arrayOf(
                            "sub-add",
                            subtitle.url,
                            if (subtitle.selected) "select" else "auto",
                            subtitle.title?.takeIf { it.isNotBlank() } ?: "Subtitles",
                            subtitle.lang?.takeIf { it.isNotBlank() } ?: "und",
                        ))
                    }
                }
                enforcePreferredSubtitle(loadedCore)
            }
        }
        trigger("event", JSObject().put("id", eventId))
    }
}
