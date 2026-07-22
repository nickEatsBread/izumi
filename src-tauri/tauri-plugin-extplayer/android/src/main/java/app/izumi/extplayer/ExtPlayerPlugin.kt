package app.izumi.extplayer

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.net.Uri
import android.os.BatteryManager
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.FileProvider
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
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

    private fun openDisqusLogin(rawUrl: String) {
        val uri = runCatching { Uri.parse(rawUrl) }.getOrNull() ?: return
        val host = uri.host.orEmpty().lowercase()
        val pathAndQuery = "${uri.path.orEmpty()}?${uri.query.orEmpty()}".lowercase()
        val isDisqus = uri.scheme == "https" && (host == "disqus.com" || host.endsWith(".disqus.com"))
        val isLogin = pathAndQuery.contains("login") || pathAndQuery.contains("signin") ||
            pathAndQuery.contains("auth")
        if (!isDisqus || !isLogin) return

        activity.runOnUiThread {
            try {
                CustomTabsIntent.Builder()
                    .setShowTitle(true)
                    .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
                    .setColorScheme(CustomTabsIntent.COLOR_SCHEME_SYSTEM)
                    .build()
                    .launchUrl(activity, uri)
            } catch (_: ActivityNotFoundException) {
                val browser = Intent(Intent.ACTION_VIEW, uri)
                if (browser.resolveActivity(activity.packageManager) != null) {
                    activity.startActivity(browser)
                }
            }
        }
    }

    // WRY's Android WebView keeps zoom enabled and ignores the viewport `user-scalable=no`, so the
    // page pinch- / double-tap-zooms on mobile (content zooms while the fixed nav stays put). Kill
    // it at the WebView-settings level the moment the webview is created.
    override fun load(webView: WebView) {
        webView.settings.setSupportZoom(false)
        webView.settings.builtInZoomControls = false
        webView.settings.displayZoomControls = false
        webView.settings.textZoom = 100 // ignore the system font-scale
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }
        // Disqus renders its login control inside a cross-origin child frame. Install a narrowly
        // scoped document-start hook in those frames so choosing Login opens Android's browser
        // Custom Tab (saved passwords/cookies and proper browser chrome) instead of a raw WebView.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        ) {
            val origins = setOf("https://disqus.com", "https://*.disqus.com")
            WebViewCompat.addWebMessageListener(
                webView,
                "IzumiDisqusBrowser",
                origins,
            ) { _, message, sourceOrigin, _, _ ->
                val sourceHost = sourceOrigin.host.orEmpty().lowercase()
                if (sourceHost == "disqus.com" || sourceHost.endsWith(".disqus.com")) {
                    message.data?.let(::openDisqusLogin)
                }
            }
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                """
                (() => {
                  if (window.__izumiDisqusLoginHook) return;
                  window.__izumiDisqusLoginHook = true;
                  const send = (raw) => {
                    try {
                      const url = new URL(String(raw || ''), location.href);
                      const host = url.hostname.toLowerCase();
                      const target = (url.pathname + '?' + url.search).toLowerCase();
                      if (url.protocol !== 'https:' || !(host === 'disqus.com' || host.endsWith('.disqus.com'))) return false;
                      if (!target.includes('login') && !target.includes('signin') && !target.includes('auth')) return false;
                      IzumiDisqusBrowser.postMessage(url.href);
                      return true;
                    } catch (_) { return false; }
                  };
                  const originalOpen = window.open;
                  window.open = function(url, target, features) {
                    if (send(url)) return null;
                    return originalOpen.call(window, url, target, features);
                  };
                  window.addEventListener('click', (event) => {
                    const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
                    if (link && send(link.href)) {
                      event.preventDefault();
                      event.stopImmediatePropagation();
                    }
                  }, true);
                })();
                """.trimIndent(),
                origins,
            )
        }
    }

    @Command
    fun deviceStatus(invoke: Invoke) {
        val connectivity = activity.applicationContext
            .getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val capabilities = connectivity.activeNetwork?.let(connectivity::getNetworkCapabilities)
        val unmetered = capabilities?.hasCapability(
            NetworkCapabilities.NET_CAPABILITY_NOT_METERED
        ) == true
        val battery = activity.applicationContext
            .getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        invoke.resolve(
            JSObject()
                .put("unmetered", unmetered)
                .put("charging", battery.isCharging)
        )
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
            val overlay = FrameLayout(activity).apply { setBackgroundColor(Color.rgb(10, 10, 11)) }
            val web = WebView(activity)
            web.settings.javaScriptEnabled = true
            web.settings.domStorageEnabled = true
            CookieManager.getInstance().apply {
                setAcceptCookie(true)
                setAcceptThirdPartyCookies(web, true)
            }
            var done = false
            fun cleanUp() {
                (overlay.parent as? ViewGroup)?.removeView(overlay)
                web.stopLoading()
                web.destroy()
            }
            fun finish(url: String) {
                if (done) return
                done = true
                CookieManager.getInstance().flush()
                cleanUp()
                invoke.resolve(JSObject().put("url", url))
            }
            fun cancel() {
                if (done) return
                done = true
                cleanUp()
                invoke.reject("Sign-in cancelled")
            }
            fun isSuccess(url: String): Boolean {
                if (url.startsWith(args.redirectPrefix)) return true
                val authHost = Uri.parse(args.authUrl).host.orEmpty()
                if (authHost != "disqus.com" && !authHost.endsWith(".disqus.com")) return false
                val parsed = Uri.parse(url)
                val host = parsed.host.orEmpty()
                return (host == "disqus.com" || host.endsWith(".disqus.com")) &&
                    parsed.path.orEmpty().startsWith("/embed/comments")
            }
            web.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val u = request.url.toString()
                    if (isSuccess(u)) { finish(u); return true }
                    return false
                }
                override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                    if (isSuccess(url)) {
                        // location.href carries the fragment (AniList implicit token); evaluateJavascript
                        // returns it JSON-quoted, so strip the surrounding quotes.
                        view.evaluateJavascript("location.href") { href -> finish(href.trim('"')) }
                    }
                }
            }
            overlay.addView(web, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ))
            val close = Button(activity).apply {
                text = "Close"
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.argb(220, 24, 24, 27))
                setOnClickListener { cancel() }
                elevation = 12f
            }
            val density = activity.resources.displayMetrics.density
            overlay.addView(close, FrameLayout.LayoutParams(
                (92 * density).toInt(),
                (48 * density).toInt(),
                Gravity.TOP or Gravity.END,
            ).apply {
                topMargin = (16 * density).toInt()
                marginEnd = (16 * density).toInt()
            })
            content.addView(overlay, ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ))
            web.loadUrl(args.authUrl)
        }
    }
}
