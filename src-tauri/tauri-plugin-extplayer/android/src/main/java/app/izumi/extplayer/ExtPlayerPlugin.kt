package app.izumi.extplayer

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.net.Uri
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

// Uniquely-named FileProvider subclass so the merged app manifest never clashes with a
// FileProvider another plugin registers (two <provider> nodes sharing android:name collide).
class ExtPlayerFileProvider : FileProvider()

@InvokeArg
class PlayArgs {
    var url: String = ""
    var title: String? = null
    var isLocal: Boolean = false
}

@InvokeArg
class InstallArgs {
    var path: String = ""
}

@InvokeArg
class OAuthArgs {
    var authUrl: String = ""
    var redirectPrefix: String = ""
}

@InvokeArg
class LanDiscoveryArgs {
    var enabled: Boolean = false
}

@TauriPlugin
class ExtPlayerPlugin(private val activity: Activity) : Plugin(activity) {
    private var multicastLock: WifiManager.MulticastLock? = null

    // WRY's Android WebView keeps zoom enabled and ignores the viewport `user-scalable=no`, so the
    // page pinch- / double-tap-zooms on mobile (content zooms while the fixed nav stays put). Kill
    // it at the WebView-settings level the moment the webview is created.
    override fun load(webView: WebView) {
        webView.settings.setSupportZoom(false)
        webView.settings.builtInZoomControls = false
        webView.settings.displayZoomControls = false
        webView.settings.textZoom = 100 // ignore the system font-scale
    }

    @Command
    fun setLanDiscovery(invoke: Invoke) {
        val args = invoke.parseArgs(LanDiscoveryArgs::class.java)
        if (args.enabled && multicastLock == null) {
            val wifiManager = activity.applicationContext
                .getSystemService(Context.WIFI_SERVICE) as WifiManager
            multicastLock = wifiManager.createMulticastLock("izumi-lan-discovery").apply {
                setReferenceCounted(false)
                acquire()
            }
        } else if (!args.enabled) {
            multicastLock?.let {
                if (it.isHeld) it.release()
            }
            multicastLock = null
        }
        invoke.resolve()
    }

    @Command
    fun play(invoke: Invoke) {
        val args = invoke.parseArgs(PlayArgs::class.java)

        val uri: Uri = if (args.isLocal) {
            // A local downloaded file → share it to the external player through a
            // FileProvider (file:// is blocked cross-app since Android 7).
            FileProvider.getUriForFile(
                activity,
                activity.packageName + ".extplayer.fileprovider",
                File(args.url)
            )
        } else {
            Uri.parse(args.url)
        }

        val view = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "video/*")
            args.title?.let {
                putExtra(Intent.EXTRA_TITLE, it)
                putExtra("title", it)
            }
            if (args.isLocal) addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        if (view.resolveActivity(activity.packageManager) == null) {
            invoke.reject("No video player installed")
            return
        }

        val chooser = Intent.createChooser(view, args.title ?: "Play with").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            // Propagate the URI read grant to whichever app the chooser launches.
            if (args.isLocal) addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(chooser)
        invoke.resolve()
    }

    // Self-update: hand a downloaded APK to the system package installer. The OS shows its
    // own confirmation dialog (and asks the user to allow installs from this source the first
    // time). The APK is shared through the same FileProvider as downloaded media.
    @Command
    fun installApk(invoke: Invoke) {
        val args = invoke.parseArgs(InstallArgs::class.java)
        val file = File(args.path)
        if (!file.exists()) {
            invoke.reject("Update file not found")
            return
        }
        val uri: Uri = FileProvider.getUriForFile(
            activity,
            activity.packageName + ".extplayer.fileprovider",
            file
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        if (intent.resolveActivity(activity.packageManager) == null) {
            invoke.reject("No package installer available")
            return
        }
        activity.startActivity(intent)
        invoke.resolve()
    }

    // Mobile OAuth: the desktop opens a second window and polls its URL; Android has no second
    // window, so we overlay a full-screen WebView, load the provider's auth page, and capture the
    // redirect to `redirectPrefix` (query for MAL's code, fragment for AniList's implicit token).
    // Reads location.href via JS so the URL fragment is included. Same REDIRECT_URI as desktop,
    // so no OAuth app reconfiguration is needed.
    @Command
    fun oauthCapture(invoke: Invoke) {
        val args = invoke.parseArgs(OAuthArgs::class.java)
        activity.runOnUiThread {
            val content = activity.findViewById<ViewGroup>(android.R.id.content)
            val web = WebView(activity)
            web.settings.javaScriptEnabled = true
            web.settings.domStorageEnabled = true
            var done = false
            fun finish(url: String) {
                if (done) return
                done = true
                (web.parent as? ViewGroup)?.removeView(web)
                web.destroy()
                invoke.resolve(JSObject().put("url", url))
            }
            web.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val u = request.url.toString()
                    if (u.startsWith(args.redirectPrefix) && u.contains("=")) { finish(u); return true }
                    return false
                }
                override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                    if (url.startsWith(args.redirectPrefix)) {
                        // location.href carries the fragment (AniList implicit token); evaluateJavascript
                        // returns it JSON-quoted, so strip the surrounding quotes.
                        view.evaluateJavascript("location.href") { href -> finish(href.trim('"')) }
                    }
                }
            }
            content.addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            web.loadUrl(args.authUrl)
        }
    }
}
