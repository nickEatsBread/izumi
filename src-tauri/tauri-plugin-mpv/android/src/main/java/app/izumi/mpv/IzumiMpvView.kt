package app.izumi.mpv

import android.content.Context
import android.view.SurfaceHolder
import android.view.SurfaceView
import dev.jdtech.mpv.MPVLib

/**
 * A SurfaceView that hosts a libmpv instance rendering via `gpu-context=android`. The Android
 * hardware compositor already places a SurfaceView behind the app window, so with a transparent
 * WebView on top the video shows through (the desktop "opaque window + transparent webview" model).
 */
class IzumiMpvView(context: Context, private val mpv: MPVLib) :
    SurfaceView(context), SurfaceHolder.Callback {

    init {
        holder.addCallback(this)
    }

    override fun surfaceCreated(h: SurfaceHolder) {
        mpv.attachSurface(h.surface)
        mpv.setOptionString("force-window", "yes")
        // Restore video output: surfaceDestroyed sets vo=null when backgrounded, so without this
        // a resume re-attaches the surface but renders nothing (audio plays, screen stays black).
        mpv.setPropertyString("vo", "gpu")
        mpv.setPropertyString("android-surface-size", "${width}x$height")
    }

    override fun surfaceChanged(h: SurfaceHolder, format: Int, w: Int, ht: Int) {
        mpv.setPropertyString("android-surface-size", "${w}x$ht")
    }

    override fun surfaceDestroyed(h: SurfaceHolder) {
        // Stop drawing to a surface that's going away, then release it.
        mpv.setPropertyString("vo", "null")
        mpv.detachSurface()
    }
}
