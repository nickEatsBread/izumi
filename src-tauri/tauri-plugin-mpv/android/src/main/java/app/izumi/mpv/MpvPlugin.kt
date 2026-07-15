package app.izumi.mpv

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.media.MediaMetadataRetriever
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
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

@InvokeArg
class LoadArgs {
    var url: String = ""
    var title: String? = null
    var startPos: Double = 0.0
    var subtitles: Array<String> = arrayOf()
}

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

/**
 * Embedded libmpv player. Renders into a [IzumiMpvView] (SurfaceView) inserted behind the
 * (made-transparent) Tauri WebView, and forwards observed properties to JS as plugin events.
 * libmpv itself is thread-safe, so only view-hierarchy work (create/destroy) runs on the UI thread.
 */
@TauriPlugin
class MpvPlugin(private val activity: Activity) : Plugin(activity), MPVLib.EventObserver {
    private var mpv: MPVLib? = null
    private var view: IzumiMpvView? = null

    /** Edge-to-edge immersive: hide the status + navigation bars during playback (swipe reveals
     *  them transiently), restore on stop. Fixes the nav bar overlapping the controls in portrait. */
    private fun setImmersive(on: Boolean) {
        val win = activity.window
        WindowCompat.setDecorFitsSystemWindows(win, !on)
        val ctrl = WindowInsetsControllerCompat(win, win.decorView)
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

    /** Lazily create the mpv core + surface view on first play. Must run on the UI thread. */
    private fun ensure(): MPVLib {
        mpv?.let { return it }
        val m = MPVLib.create(activity) ?: error("libmpv: MPVLib.create returned null")
        // izumi controls all options — never read the user's ~/.config/mpv.
        m.setOptionString("config", "no")
        m.setOptionString("vo", "gpu")
        m.setOptionString("gpu-context", "android")
        m.setOptionString("hwdec", "mediacodec-copy")
        m.setOptionString("force-window", "no")
        m.setOptionString("idle", "once")
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
        val v = IzumiMpvView(activity, m)
        // Fill the screen — a SurfaceView with no layout params can size to 0x0 (invisible).
        val lp = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        content.addView(v, 0, lp) // index 0 → behind the WebView, match-parent size
        setImmersive(true)
        Log.i("MpvPlugin", "surface added; content children=${content.childCount}")
        mpv = m
        view = v
        return m
    }

    @Command
    fun load(invoke: Invoke) {
        val args = invoke.parseArgs(LoadArgs::class.java)
        activity.runOnUiThread {
            val m = ensure()
            m.command(arrayOf("loadfile", args.url))
            if (args.startPos > 0) m.command(arrayOf("seek", args.startPos.toString(), "absolute"))
            for (s in args.subtitles) m.command(arrayOf("sub-add", s, "auto"))
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

    @Command
    fun pip(invoke: Invoke) {
        activity.runOnUiThread {
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                val params = android.app.PictureInPictureParams.Builder()
                    .setAspectRatio(android.util.Rational(16, 9))
                    .build()
                @Suppress("DEPRECATION")
                activity.enterPictureInPictureMode(params)
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
                val mmr = MediaMetadataRetriever()
                if (a.headers.isEmpty()) mmr.setDataSource(a.url, HashMap())
                else mmr.setDataSource(a.url, HashMap(a.headers))
                val us = (a.timeSec * 1_000_000L).toLong()
                val bmp = if (Build.VERSION.SDK_INT >= 27) {
                    mmr.getScaledFrameAtTime(
                        us,
                        MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
                        a.width,
                        a.width * 9 / 16,
                    )
                } else {
                    mmr.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                }
                mmr.release()
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

    @Command
    fun stop(invoke: Invoke) {
        activity.runOnUiThread {
            setImmersive(false)
            view?.let { (it.parent as? ViewGroup)?.removeView(it) }
            mpv?.let {
                it.command(arrayOf("stop"))
                it.removeObserver(this)
                it.destroy()
            }
            mpv = null
            view = null
            invoke.resolve()
        }
    }

    // --- MPVLib.EventObserver → forward to JS (addPluginListener('mpv','progress'|'event', cb)) ---
    override fun eventProperty(property: String) {}
    override fun eventProperty(property: String, value: Long) {
        trigger("progress", JSObject().put("property", property).put("value", value))
    }
    override fun eventProperty(property: String, value: Boolean) {
        trigger("progress", JSObject().put("property", property).put("value", value))
    }
    override fun eventProperty(property: String, value: String) {
        trigger("progress", JSObject().put("property", property).put("value", value))
    }
    override fun eventProperty(property: String, value: Double) {
        trigger("progress", JSObject().put("property", property).put("value", value))
    }
    override fun event(eventId: Int) {
        trigger("event", JSObject().put("id", eventId))
    }
}
