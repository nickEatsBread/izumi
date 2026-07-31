package app.izumi.mpv

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.Icon
import android.media.MediaMetadataRetriever
import android.content.pm.ActivityInfo
import android.os.Build
import android.os.Environment
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.util.Rational
import android.view.OrientationEventListener
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Locale
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.core.content.ContextCompat
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
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
}

private data class PendingSubtitles(
    val url: String,
    val tracks: Array<SubtitleArgs>,
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
class BrightnessArgs {
    var value: Double = -1.0
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

// Bounds for a capture, matched to the desktop recorder so both platforms produce comparable files.
private const val GIF_FRAME_INTERVAL_MS = 50L
private const val GIF_MAX_FRAMES = 600
private const val GIF_MAX_MS = 30_000L

/**
 * Embedded libmpv player. Renders into a [IzumiMpvView] (SurfaceView) inserted behind the
 * (made-transparent) Tauri WebView, and forwards observed properties to JS as plugin events.
 * libmpv itself is thread-safe, so only view-hierarchy work (create/destroy) runs on the UI thread.
 */
@TauriPlugin
class MpvPlugin(private val activity: Activity) : Plugin(activity), MPVLib.EventObserver {
    private var mpv: MPVLib? = null
    private var view: IzumiMpvView? = null
    private var preferredSubLanguage: String? = null
    private var pendingSubtitles: PendingSubtitles? = null
    /** The first load must wait for SurfaceView.surfaceCreated or mpv can initialize its VO with
     * no Android surface and remain black at 0:00 even though demuxed metadata is available. */
    private var pendingSurfaceLoad: LoadArgs? = null
    /** Clips the SurfaceView and moves with the web player shell during direct-manipulation gestures. */
    private var container: FrameLayout? = null
    private var landscapeReleaseListener: OrientationEventListener? = null
    /** The last viewport the web shell asked for, replayed when picture-in-picture ends. */
    private var lastViewport: ViewportArgs? = null
    /** True once Android reports the activity is actually in PiP (see [installPipWatcher]). */
    private var pipActive = false
    /** True from the moment PiP is requested until it ends — covers the transition, during which
     *  `isInPictureInPictureMode` is still false but the portrait geometry must NOT be re-applied. */
    private var pipRequested = false
    private var contentView: ViewGroup? = null
    private var pipLayoutListener: View.OnLayoutChangeListener? = null
    private var pipReceiver: BroadcastReceiver? = null
    private var gifSession: GifSession? = null

    private fun stopLandscapeReleaseListener() {
        landscapeReleaseListener?.disable()
        landscapeReleaseListener = null
    }

    /**
     * Force the initial portrait -> landscape transition, then hand orientation back to Android as
     * soon as the phone is physically landscape. That preserves the fullscreen button while still
     * allowing a normal turn back to portrait without tapping an exit control.
     */
    private fun enterLandscapeWithSensorReturn() {
        stopLandscapeReleaseListener()
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        val listener = object : OrientationEventListener(activity) {
            override fun onOrientationChanged(orientation: Int) {
                if (orientation == ORIENTATION_UNKNOWN) return
                val physicallyLandscape = orientation in 60..120 || orientation in 240..300
                if (!physicallyLandscape) return
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                stopLandscapeReleaseListener()
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

    /** Lazily create the mpv core + surface view on first play. Must run on the UI thread. */
    private fun ensure(): MPVLib {
        mpv?.let { return it }
        val m = MPVLib.create(activity) ?: error("libmpv: MPVLib.create returned null")
        // izumi controls all options — never read the user's ~/.config/mpv.
        m.setOptionString("config", "no")
        prepareFontsDir()?.let { m.setOptionString("sub-fonts-dir", it) }
        m.setOptionString("vo", "gpu")
        m.setOptionString("gpu-context", "android")
        m.setOptionString("hwdec", "mediacodec-copy")
        m.setOptionString("force-window", "no")
        // MUST be "yes", not "once": the core is cached across episodes (see `ensure`), and with
        // "once" mpv shuts itself down the moment the first file reaches EOF. Auto-advance and
        // "Change source" then issued `loadfile` against a dead core — the command silently
        // succeeded, no properties ever updated, and the UI sat on `buffering: true` over a black
        // screen forever. `force-window=no` already keeps an idle core from showing a window.
        m.setOptionString("idle", "yes")
        m.setOptionString("cache", "yes")
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

        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        // Make WRY's WebView transparent so the SurfaceView (added behind it) shows through.
        val web = findWebView(content)
        if (web != null) {
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
        mpv = m
        view = v
        container = playerContainer
        contentView = content
        installPipWatcher(content)
        return m
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

    /** Fill the (now tiny) PiP window with the video rectangle: no inset margin, no fixed height,
     *  no leftover gesture transform. */
    private fun applyPipLayout() {
        container?.let { playerContainer ->
            val params = (playerContainer.layoutParams as? FrameLayout.LayoutParams)
                ?: FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            params.width = ViewGroup.LayoutParams.MATCH_PARENT
            params.height = ViewGroup.LayoutParams.MATCH_PARENT
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
        val paused = mpv?.getPropertyString("pause") == "yes"
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
        return builder.build()
    }

    /** Re-publish the params so the action button matches the CURRENT play/pause state. */
    private fun updatePipActions() {
        if (!pipActive || Build.VERSION.SDK_INT < 26) return
        try {
            activity.setPictureInPictureParams(pipParams())
        } catch (e: Exception) {
            Log.w("MpvPlugin", "pip params update failed: ${e.message}")
        }
    }

    private fun registerPipReceiver() {
        if (pipReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.getIntExtra(PIP_EXTRA_CODE, 0) != PIP_CODE_PLAY_PAUSE) return
                mpv?.command(arrayOf("cycle", "pause"))
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
                applyViewport(lastViewport ?: ViewportArgs())
                invoke.reject(failure)
            }
        }
    }

    private fun normalizedLanguage(raw: String?): String = when (raw?.trim()?.lowercase()) {
        "en", "eng", "english" -> "eng"
        "ja", "jpn", "japanese" -> "jpn"
        "zh", "chi", "zho", "chinese" -> "chi"
        "ko", "kor", "korean" -> "kor"
        "es", "spa", "spanish" -> "spa"
        "fr", "fre", "fra", "french" -> "fre"
        "de", "ger", "deu", "german" -> "ger"
        "it", "ita", "italian" -> "ita"
        "pt", "por", "portuguese" -> "por"
        "ru", "rus", "russian" -> "rus"
        "ar", "ara", "arabic" -> "ara"
        "pl", "pol", "polish" -> "pol"
        "tr", "tur", "turkish" -> "tur"
        else -> raw?.trim()?.lowercase().orEmpty()
    }

    /** mpv treats `slang` as a preference, not a restriction: if English is absent it may still
     * select a source-default Chinese track. Enforce the user's language once the file's embedded
     * track list exists; an explicitly-selected external English track added just after load can
     * still override this through `sub-add ... select`. */
    private fun enforcePreferredSubtitle(m: MPVLib) {
        val preferred = normalizedLanguage(preferredSubLanguage)
        if (preferred.isEmpty()) return
        if (preferred == "none") {
            m.setPropertyString("sid", "no")
            return
        }
        val count = m.getPropertyString("track-list/count")?.toIntOrNull() ?: 0
        var match: String? = null
        for (index in 0 until count) {
            if (m.getPropertyString("track-list/$index/type") != "sub") continue
            if (normalizedLanguage(m.getPropertyString("track-list/$index/lang")) != preferred) continue
            match = m.getPropertyString("track-list/$index/id")
            if (!match.isNullOrBlank()) break
        }
        m.setPropertyString("sid", match?.takeIf { it.isNotBlank() } ?: "no")
    }

    private fun loadIntoCore(m: MPVLib, args: LoadArgs) {
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
        m.command(arrayOf("loadfile", args.url))
        if (args.startPos > 0) m.command(arrayOf("seek", args.startPos.toString(), "absolute"))
        if (slang.equals("none", ignoreCase = true)) {
            m.setPropertyString("sid", "no")
        }
    }

    @Command
    fun load(invoke: Invoke) {
        val args = invoke.parseArgs(LoadArgs::class.java)
        activity.runOnUiThread {
            val m = ensure()
            // BaseMPVView from mpv-android follows the same rule: the first loadfile is retained
            // until surfaceCreated has attached the Android Surface. Later loads can reuse it.
            if (view?.surfaceReady == true) {
                pendingSurfaceLoad = null
                loadIntoCore(m, args)
            } else {
                // Keep only the newest request if the user changes source before the surface is
                // ready. Invokes resolve immediately because the request has been accepted.
                pendingSurfaceLoad = args
            }
            invoke.resolve()
        }
    }

    @Command
    fun command(invoke: Invoke) {
        val a = invoke.parseArgs(CommandArgs::class.java)
        mpv?.command(a.args) // libmpv command queue is thread-safe
        invoke.resolve()
    }

    @Command
    fun get(invoke: Invoke) {
        val a = invoke.parseArgs(GetArgs::class.java)
        val ret = JSObject()
        ret.put("value", mpv?.getPropertyString(a.property))
        invoke.resolve(ret)
    }

    @Command
    fun set(invoke: Invoke) {
        val a = invoke.parseArgs(SetArgs::class.java)
        mpv?.setPropertyString(a.property, a.value)
        invoke.resolve()
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
            val params = (playerContainer.layoutParams as? FrameLayout.LayoutParams)
                ?: FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height)
            params.width = ViewGroup.LayoutParams.MATCH_PARENT
            params.height = height
            params.topMargin = a.top.coerceAtLeast(0) + if (a.immersive) 0 else safeTop
            playerContainer.layoutParams = params
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
                applyViewport(a)
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
            container?.let { playerContainer ->
                playerContainer.pivotX = playerContainer.width / 2f
                playerContainer.pivotY = playerContainer.height / 2f
                val s = a.scale.toFloat().coerceIn(1f, 4f)
                playerContainer.scaleX = s
                playerContainer.scaleY = s
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

    // --- GIF recording ------------------------------------------------------------------------
    //
    // Same shape as the desktop recorder: bounded JPEG frames are pulled straight out of the LIVE
    // core with `screenshot-to-file`, so signed/DRM-free-but-header-gated streams are captured
    // exactly as mpv renders them and nothing has to reopen the source. Android has no ffmpeg, so
    // the palette + LZW encode happens in Rust (`android_gif_encode`) and the finished file is
    // published to the gallery by [gifSave].

    @Command
    fun gifStart(invoke: Invoke) {
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
            while (!session.stop &&
                session.frames < GIF_MAX_FRAMES &&
                System.currentTimeMillis() - started < GIF_MAX_MS
            ) {
                val frameStart = System.currentTimeMillis()
                val file = File(session.dir, String.format(Locale.US, "f%05d.jpg", session.frames))
                // MPVLib.command has no return value, so the written file is the success signal.
                m.command(arrayOf("screenshot-to-file", file.absolutePath, mode))
                if (file.isFile && file.length() > 0) {
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
        recording?.let { session ->
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
        activity.runOnUiThread {
            stopLandscapeReleaseListener()
            unregisterPipReceiver()
            removePipWatcher()
            pipActive = false
            pipRequested = false
            pipSourceHint = null
            lastViewport = null
            setImmersive(false)
            container?.let { (it.parent as? ViewGroup)?.removeView(it) }
            mpv?.let {
                it.command(arrayOf("stop"))
                it.removeObserver(this)
                it.destroy()
            }
            mpv = null
            view = null
            container = null
            pendingSurfaceLoad = null
            invoke.resolve()
        }
    }

    // --- MPVLib.EventObserver → forward to JS (addPluginListener('mpv','progress'|'event', cb)) ---
    override fun eventProperty(property: String) {}
    override fun eventProperty(property: String, value: Long) {
        trigger("progress", JSObject().put("property", property).put("value", value))
    }
    override fun eventProperty(property: String, value: Boolean) {
        // Keep the miniplayer's play/pause button honest. Posted to the UI thread: this callback runs
        // on libmpv's event thread holding its observer monitor, and pipParams() reads back from the
        // core (see the note in `event` below).
        if (property == "pause" && pipActive) {
            activity.window.decorView.post { updatePipActions() }
        }
        trigger("progress", JSObject().put("property", property).put("value", value))
    }
    override fun eventProperty(property: String, value: String) {
        trigger("progress", JSObject().put("property", property).put("value", value))
    }
    override fun eventProperty(property: String, value: Double) {
        trigger("progress", JSObject().put("property", property).put("value", value))
    }
    override fun event(eventId: Int) {
        // MPVLib dispatches observers while holding its observer monitor on the native event
        // thread. Never call back into synchronous libmpv APIs from that callback: FILE_LOADED can
        // otherwise leave metadata (including duration) visible while the event loop and decoder
        // remain stuck at 0:00. Posting also preserves the original reason for waiting until
        // FILE_LOADED: adding sidecars immediately after `loadfile` races the async replacement.
        if (eventId == 8) {
            val loadedCore = mpv
            activity.window.decorView.post {
                if (loadedCore == null || mpv !== loadedCore) return@post
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
