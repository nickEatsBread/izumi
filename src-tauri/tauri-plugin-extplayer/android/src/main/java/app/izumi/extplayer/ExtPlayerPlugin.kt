package app.izumi.extplayer

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.FileProvider
import androidx.core.content.ContextCompat
import androidx.mediarouter.app.MediaRouteChooserDialog
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaTrack
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import dalvik.system.DexClassLoader
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.URL
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.ZipFile
import org.json.JSONArray
import org.json.JSONObject

private const val IZUMI_TIZEN_APPLICATION_ID = "IzumiTV001.IzumiTV"

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
class AniyomiRuntimeArgs {
    var runtimePath: String = ""
    var extensionsPath: String = ""
}

@InvokeArg
class AniyomiCallArgs {
    var runtimePath: String = ""
    var extensionsPath: String = ""
    var method: String = ""
    var argsJson: String = "{}"
}

@InvokeArg
class BrowserArgs {
    var url: String = ""
}

@InvokeArg
class CastMediaArgs {
    var url: String = ""
    var title: String? = null
    var contentType: String = ""
    var positionMs: Long = 0
    var subtitlesJson: String = "[]"
}

@InvokeArg
class ShareTextArgs {
    var title: String = ""
    var text: String = ""
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

@InvokeArg
class DaReactionArgs {
    var base: String = ""
    var identifier: String = ""
}

@InvokeArg
class DaReactArgs {
    var base: String = ""
    var identifier: String = ""
    var key: String? = null
}

@InvokeArg
class DaLoginArgs {
    var base: String = ""
}

@InvokeArg
class DownloadForegroundArgs {
    var active: Boolean = false
    var title: String? = null
    var detail: String? = null
    /** 0-100, or null/absent for indeterminate. */
    var progress: Int? = null
    var count: Int? = null
}

@InvokeArg
class CompanionCastForegroundArgs {
    var active: Boolean = false
    var title: String? = null
}

@InvokeArg
class SaveTextFileArgs {
    var fileName: String = ""
    var mime: String? = null
    var contents: String = ""
}

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "downloadNotifications"),
    ],
)
class ExtPlayerPlugin(private val activity: Activity) : Plugin(activity) {
    private val aniyomiLock = Any()
    @Volatile private var aniyomiRuntime: Any? = null
    @Volatile private var aniyomiRuntimeClass: Class<*>? = null
    @Volatile private var aniyomiRuntimePath: String? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    // The app's main WebView, captured in load(); used to reload the in-app Disqus embed iframe after
    // an in-overlay login so it re-boots with the freshly-set session cookie.
    private var appWebView: WebView? = null
    private var castContext: CastContext? = null
    private var castChooser: MediaRouteChooserDialog? = null
    private var pendingCast: CastMediaArgs? = null

    private val castSessionListener = object : SessionManagerListener<CastSession> {
        override fun onSessionStarting(session: CastSession) = Unit

        override fun onSessionStarted(session: CastSession, sessionId: String) {
            pendingCast?.let { loadCastMedia(session, it) }
        }

        override fun onSessionStartFailed(session: CastSession, error: Int) {
            pendingCast = null
            emitCast("error", "Could not connect to the Cast device ($error).")
        }

        override fun onSessionEnding(session: CastSession) = Unit

        override fun onSessionEnded(session: CastSession, error: Int) {
            emitCast("ended")
        }

        override fun onSessionResuming(session: CastSession, sessionId: String) = Unit

        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {
            pendingCast?.let { loadCastMedia(session, it) }
        }

        override fun onSessionResumeFailed(session: CastSession, error: Int) {
            pendingCast = null
            emitCast("error", "Could not resume the Cast session ($error).")
        }

        override fun onSessionSuspended(session: CastSession, reason: Int) {
            emitCast("suspended")
        }
    }

    private fun emitCast(action: String, error: String? = null, device: String? = null) {
        val payload = JSObject().put("action", action)
        error?.let { payload.put("error", it) }
        device?.let { payload.put("device", it) }
        trigger("cast", payload)
    }

    private fun initCast(): CastContext {
        castContext?.let { return it }
        return CastContext.getSharedInstance(activity).also { context ->
            context.sessionManager.addSessionManagerListener(
                castSessionListener,
                CastSession::class.java,
            )
            castContext = context
        }
    }

    private fun loadCastMedia(session: CastSession, args: CastMediaArgs) {
        val remote = session.remoteMediaClient
        if (remote == null) {
            pendingCast = null
            emitCast("error", "The selected Cast receiver cannot play media.")
            return
        }
        try {
            val tracks = mutableListOf<MediaTrack>()
            val subtitleArray = JSONArray(args.subtitlesJson)
            for (index in 0 until subtitleArray.length()) {
                val subtitle = subtitleArray.optJSONObject(index) ?: continue
                val subtitleUrl = subtitle.optString("url").takeIf { it.isNotBlank() } ?: continue
                tracks += MediaTrack.Builder((index + 1).toLong(), MediaTrack.TYPE_TEXT)
                    .setName(subtitle.optString("title", "Subtitles"))
                    .setLanguage(subtitle.optString("lang", "und"))
                    .setSubtype(MediaTrack.SUBTYPE_SUBTITLES)
                    .setContentId(subtitleUrl)
                    .setContentType(subtitle.optString("contentType", "text/vtt"))
                    .build()
            }

            val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE).apply {
                putString(MediaMetadata.KEY_TITLE, args.title ?: "Izumi")
            }
            val mediaInfo = MediaInfo.Builder(args.url)
                .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
                .setContentType(args.contentType)
                .setMetadata(metadata)
                .setMediaTracks(tracks)
                .build()
            val request = MediaLoadRequestData.Builder()
                .setMediaInfo(mediaInfo)
                .setAutoplay(true)
                .setCurrentTime(args.positionMs.coerceAtLeast(0))
                .apply {
                    if (tracks.isNotEmpty()) setActiveTrackIds(longArrayOf(tracks.first().id))
                }
                .build()

            remote.load(request).setResultCallback { result ->
                if (result.status.isSuccess) {
                    pendingCast = null
                    emitCast("playing", device = session.castDevice?.friendlyName)
                } else {
                    pendingCast = null
                    emitCast("error", "The Cast receiver rejected this stream (${result.status.statusCode}).")
                }
            }
        } catch (error: Exception) {
            pendingCast = null
            Log.e("IzumiCast", "Could not load Cast media", error)
            emitCast("error", error.message ?: "Could not load media on the Cast device.")
        }
    }

    @Command
    fun castMedia(invoke: Invoke) {
        val args = invoke.parseArgs(CastMediaArgs::class.java)
        if (!args.url.startsWith("http://") && !args.url.startsWith("https://")) {
            invoke.reject("Cast needs an HTTP or HTTPS media URL")
            return
        }
        activity.runOnUiThread {
            try {
                val context = initCast()
                pendingCast = args
                val current = context.sessionManager.currentCastSession
                if (current?.isConnected == true) {
                    loadCastMedia(current, args)
                } else {
                    castChooser?.dismiss()
                    castChooser = MediaRouteChooserDialog(activity).apply {
                        routeSelector = context.mergedSelector
                            ?: error("No Cast routes are available")
                        setOnDismissListener { castChooser = null }
                        show()
                    }
                }
                invoke.resolve()
            } catch (error: Exception) {
                pendingCast = null
                Log.e("IzumiCast", "Could not open Cast device chooser", error)
                invoke.reject(error.message ?: "Google Cast is unavailable on this device", error)
            }
        }
    }

    /** Find Samsung's local Smart View service without relying on WebView multicast support.
     * Samsung's browser sender performs the same subnet scan; the TV receiver connection itself
     * remains in the shared TypeScript channel client so Android and desktop use one protocol. */
    @Command
    fun discoverTizenReceivers(invoke: Invoke) {
        Thread {
            try {
                val connectivity = activity.applicationContext
                    .getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                val network = connectivity.activeNetwork
                    ?: error("Connect this device and the TV to the same Wi-Fi network")
                val local = connectivity.getLinkProperties(network)?.linkAddresses
                    ?.asSequence()
                    ?.map { it.address }
                    ?.filterIsInstance<Inet4Address>()
                    ?.firstOrNull { !it.isLoopbackAddress && !it.isLinkLocalAddress }
                    ?: error("Could not determine the local Wi-Fi address")
                val octets = local.hostAddress?.split('.')
                    ?: error("Could not determine the local Wi-Fi subnet")
                require(octets.size == 4) { "Only IPv4 home networks are supported for TV discovery" }
                val prefix = octets.take(3).joinToString(".")
                val devices = Collections.synchronizedList(mutableListOf<JSONObject>())
                val pool = Executors.newFixedThreadPool(48)
                val done = CountDownLatch(254)

                for (host in 1..254) {
                    pool.execute {
                        try {
                            val address = "$prefix.$host"
                            val connection = URL("http://$address:8001/api/v2/")
                                .openConnection() as HttpURLConnection
                            connection.connectTimeout = 450
                            connection.readTimeout = 450
                            connection.requestMethod = "GET"
                            connection.setRequestProperty("Accept", "application/json")
                            if (connection.responseCode in 200..299) {
                                val body = connection.inputStream.bufferedReader().use { it.readText() }
                                val response = JSONObject(body)
                                val device = response.optJSONObject("device") ?: response
                                val type = device.optString("type", response.optString("type"))
                                val name = device.optString("name",
                                    device.optString("Name", response.optString("name", "Samsung TV")))
                                if (type.contains("Samsung", true) || name.contains("Samsung", true) ||
                                    name.startsWith("[TV]", true)) {
                                    // The application endpoint exists while Companion is closed,
                                    // so discovery remains passive without advertising TVs where
                                    // the receiver has not been installed.
                                    val application = URL(
                                        "http://$address:8001/api/v2/applications/$IZUMI_TIZEN_APPLICATION_ID",
                                    ).openConnection() as HttpURLConnection
                                    application.connectTimeout = 450
                                    application.readTimeout = 450
                                    application.requestMethod = "GET"
                                    application.setRequestProperty("Accept", "application/json")
                                    if (application.responseCode in 200..299) {
                                        val appBody = application.inputStream.bufferedReader().use { it.readText() }
                                        if (JSONObject(appBody).optString("id") == IZUMI_TIZEN_APPLICATION_ID) {
                                            devices.add(JSONObject()
                                                .put("id", device.optString("id", response.optString("id", address)))
                                                .put("name", name)
                                                .put("address", address)
                                                .put("model", device.optString("modelName", device.optString("Model"))))
                                        }
                                    }
                                    application.disconnect()
                                }
                            }
                            connection.disconnect()
                        } catch (_: Exception) {
                            // Most addresses have no TV; discovery failures are expected.
                        } finally {
                            done.countDown()
                        }
                    }
                }
                done.await(8, TimeUnit.SECONDS)
                pool.shutdownNow()
                val sorted = devices.distinctBy { it.optString("address") }
                    .sortedBy { it.optString("name").lowercase() }
                invoke.resolve(JSObject().put("devices", JSONArray(sorted)))
            } catch (error: Exception) {
                invoke.reject(error.message ?: "Could not scan for Samsung TVs", error)
            }
        }.start()
    }

    private fun loadAniyomiRuntime(runtimePath: String) {
        synchronized(aniyomiLock) {
            if (aniyomiRuntime != null && aniyomiRuntimePath == runtimePath) return
            val context = activity.applicationContext
            val originalApk = File(runtimePath)
            require(originalApk.isFile) { "Aniyomi runtime host is missing" }

            // Android 14 requires dynamically loaded code to be read-only. Copy the verified host
            // into the app's private files directory before creating the class loader.
            val cachedApk = File(
                context.filesDir,
                "izumi_anymex_runtime_${originalApk.length()}_${originalApk.lastModified()}.apk",
            )
            if (!cachedApk.exists()) {
                context.filesDir.listFiles()?.forEach { file ->
                    if (file.name.startsWith("izumi_anymex_runtime_") &&
                        file.name.endsWith(".apk") &&
                        file != cachedApk
                    ) file.delete()
                }
                originalApk.inputStream().use { input ->
                    FileOutputStream(cachedApk).use(input::copyTo)
                }
                cachedApk.setReadOnly()
            }

            context.cacheDir.listFiles()?.forEach { file ->
                if (file.isDirectory &&
                    (file.name.startsWith("izumi_anymex_dex_") ||
                        file.name.startsWith("izumi_anymex_libs_"))
                ) file.deleteRecursively()
            }
            val optimizedDir = File(
                context.cacheDir,
                "izumi_anymex_dex_${System.currentTimeMillis()}",
            ).apply { mkdirs() }
            val librariesDir = File(
                context.cacheDir,
                "izumi_anymex_libs_${System.currentTimeMillis()}",
            ).apply { mkdirs() }

            // The runtime host currently ships native helpers. DexClassLoader does not extract an
            // APK's lib/<abi> directory, so mirror the upstream bridge and provide it explicitly.
            ZipFile(cachedApk).use { zip ->
                val abi = android.os.Build.SUPPORTED_ABIS.firstOrNull { candidate ->
                    val prefix = "lib/$candidate/"
                    zip.entries().asSequence().any {
                        it.name.startsWith(prefix) && it.name.endsWith(".so")
                    }
                }
                if (abi != null) {
                    val prefix = "lib/$abi/"
                    zip.entries().asSequence()
                        .filter { it.name.startsWith(prefix) && it.name.endsWith(".so") }
                        .forEach { entry ->
                            zip.getInputStream(entry).use { input ->
                                FileOutputStream(File(librariesDir, entry.name.substringAfterLast('/')))
                                    .use(input::copyTo)
                            }
                        }
                }
            }

            val loader = ChildFirstClassLoader(
                cachedApk.absolutePath,
                optimizedDir.absolutePath,
                librariesDir.absolutePath,
                context.classLoader,
            )
            val bridgeClass = loader.loadClass("com.anymex.runtimehost.RuntimeBridge")
            aniyomiRuntimeClass = bridgeClass
            aniyomiRuntime = bridgeClass.getField("INSTANCE").get(null)
            aniyomiRuntimePath = runtimePath
            invokeAniyomi("initialize", context, null)
            Log.i("IzumiAniyomi", "AnymeX Android runtime host loaded")
        }
    }

    private fun invokeAniyomi(methodName: String, vararg args: Any?): Any? {
        val bridge = aniyomiRuntime ?: error("Aniyomi runtime host is not loaded")
        val bridgeClass = aniyomiRuntimeClass ?: error("Aniyomi runtime class is not loaded")
        val method = bridgeClass.methods
            .firstOrNull { it.name == methodName && it.parameterTypes.size == args.size }
            ?: throw NoSuchMethodException("RuntimeBridge.$methodName/${args.size}")
        return try {
            method.invoke(bridge, *args)
        } catch (error: java.lang.reflect.InvocationTargetException) {
            throw error.targetException ?: error
        }
    }

    private fun jsonValue(value: Any?): Any? = when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { jsonValue(value.get(it)) }
        is JSONArray -> (0 until value.length()).map { jsonValue(value.get(it)) }
        else -> value
    }

    private fun jsonText(value: Any?): String = when (value) {
        null -> "null"
        is Map<*, *> -> JSONObject(value).toString()
        is Collection<*> -> JSONArray(value).toString()
        is Array<*> -> JSONArray(value.toList()).toString()
        else -> JSONObject.wrap(value)?.toString() ?: "null"
    }

    private fun resolveJson(invoke: Invoke, value: Any?) {
        invoke.resolve(JSObject().put("json", jsonText(value)))
    }

    @Command
    fun aniyomiSources(invoke: Invoke) {
        val args = invoke.parseArgs(AniyomiRuntimeArgs::class.java)
        // Same deadline discipline as aniyomiCall: a pending invoke blocks a Rust bridge thread,
        // so it must always settle. First-one-wins via `settled`; daemon threads throughout.
        val settled = java.util.concurrent.atomic.AtomicBoolean(false)
        val worker = Thread {
            try {
                loadAniyomiRuntime(args.runtimePath)
                val context = activity.applicationContext
                val raw = invokeAniyomi(
                    "getInstalledAnimeExtensions",
                    context,
                    args.extensionsPath,
                ) as? List<*> ?: emptyList<Any?>()
                // Match the desktop bridge shape consumed by manager.ts.
                val sources = raw.mapNotNull { source ->
                    @Suppress("UNCHECKED_CAST")
                    val map = source as? Map<String, Any?> ?: return@mapNotNull null
                    map.toMutableMap().apply { put("type", "anime") }
                }
                if (settled.compareAndSet(false, true)) resolveJson(invoke, sources)
            } catch (error: Throwable) {
                Log.e("IzumiAniyomi", "Could not enumerate sources", error)
                if (settled.compareAndSet(false, true)) {
                    invoke.reject(error.message ?: "Could not load Aniyomi sources")
                }
            }
        }
        worker.isDaemon = true
        worker.start()
        Thread {
            try {
                worker.join(60_000)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            if (settled.compareAndSet(false, true)) {
                Log.e("IzumiAniyomi", "Source enumeration timed out after 60s")
                invoke.reject("The extension runtime did not answer in time.")
            }
        }.apply { isDaemon = true }.start()
    }

    @Command
    fun aniyomiCall(invoke: Invoke) {
        val args = invoke.parseArgs(AniyomiCallArgs::class.java)
        // The extension's network code runs with whatever (lack of) timeouts the source APK chose,
        // and the Rust bridge blocks a thread until this invoke settles. A worker wedged inside a
        // dead TLS read therefore used to leave the invoke pending FOREVER — the caller's resolve
        // never finished and the picker spun for good. The deadline thread answers on the worker's
        // behalf; `settled` makes resolve/reject first-one-wins. Both threads are daemons so a
        // wedged extension can never pin the process at exit.
        val settled = java.util.concurrent.atomic.AtomicBoolean(false)
        val worker = Thread {
            try {
                loadAniyomiRuntime(args.runtimePath)
                @Suppress("UNCHECKED_CAST")
                val values = jsonValue(JSONObject(args.argsJson)) as Map<String, Any?>
                val context = activity.applicationContext
                val requestId = values["requestId"]?.toString()
                val parameters = requestId?.let { mapOf<String, Any?>("token" to it) }
                if (args.method == "cancel") {
                    val cancelled = requestId?.let { invokeAniyomi("cancelRequest", it) } ?: false
                    if (settled.compareAndSet(false, true)) resolveJson(invoke, cancelled)
                    return@Thread
                }
                val sourceId = values["sourceId"]?.toString()
                    ?: error("Aniyomi call has no sourceId")
                val isAnime = values["isAnime"] as? Boolean ?: true
                val result = when (args.method) {
                    "getPopular" -> invokeAniyomi(
                        "aniyomiGetPopular",
                        context,
                        sourceId,
                        isAnime,
                        (values["page"] as? Number)?.toInt() ?: 1,
                        parameters,
                    )
                    "getLatestUpdates" -> invokeAniyomi(
                        "aniyomiGetLatestUpdates",
                        context,
                        sourceId,
                        isAnime,
                        (values["page"] as? Number)?.toInt() ?: 1,
                        parameters,
                    )
                    "search" -> invokeAniyomi(
                        "aniyomiSearch",
                        context,
                        sourceId,
                        isAnime,
                        values["query"]?.toString() ?: "",
                        (values["page"] as? Number)?.toInt() ?: 1,
                        values["filters"] as? List<*>,
                        parameters,
                    )
                    "getDetail" -> invokeAniyomi(
                        "aniyomiGetDetail",
                        context,
                        sourceId,
                        isAnime,
                        values["media"] as? Map<*, *> ?: emptyMap<String, Any?>(),
                        parameters,
                    )
                    "getVideoList" -> invokeAniyomi(
                        "aniyomiGetVideoList",
                        context,
                        sourceId,
                        isAnime,
                        values["episode"] as? Map<*, *> ?: emptyMap<String, Any?>(),
                        parameters,
                    )
                    "getFilterList" -> invokeAniyomi(
                        "aniyomiGetFilterList",
                        context,
                        sourceId,
                        isAnime,
                    )
                    "aniyomiGetPreferences" -> invokeAniyomi(
                        "aniyomiGetPreference",
                        context,
                        sourceId,
                        isAnime,
                    )
                    "aniyomiSavePreference" -> invokeAniyomi(
                        "aniyomiSavePreference",
                        context,
                        sourceId,
                        values["key"]?.toString() ?: "",
                        values["action"]?.toString() ?: "change",
                        values["value"],
                    )
                    else -> error("Unsupported Aniyomi method: ${args.method}")
                }
                if (settled.compareAndSet(false, true)) resolveJson(invoke, result)
            } catch (error: Throwable) {
                Log.e("IzumiAniyomi", "Runtime call ${args.method} failed", error)
                if (settled.compareAndSet(false, true)) {
                    invoke.reject(error.message ?: "Aniyomi extension call failed")
                }
            }
        }
        worker.isDaemon = true
        worker.start()
        Thread {
            try {
                worker.join(75_000)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            if (settled.compareAndSet(false, true)) {
                Log.e("IzumiAniyomi", "Runtime call ${args.method} timed out after 75s")
                invoke.reject("The extension did not answer in time — try another source.")
            }
        }.apply { isDaemon = true }.start()
    }

    @Command
    fun aniyomiReload(invoke: Invoke) {
        synchronized(aniyomiLock) {
            runCatching {
                if (aniyomiRuntime != null) invokeAniyomi("shutdown")
            }
            aniyomiRuntime = null
            aniyomiRuntimeClass = null
            aniyomiRuntimePath = null
        }
        invoke.resolve()
    }

    private fun openDisqusLogin(rawUrl: String) {
        val uri = runCatching { Uri.parse(rawUrl) }.getOrNull() ?: return
        val host = uri.host.orEmpty().lowercase()
        val pathAndQuery = "${uri.path.orEmpty()}?${uri.query.orEmpty()}".lowercase()
        val isDisqus = uri.scheme == "https" && (host == "disqus.com" || host.endsWith(".disqus.com"))
        val isLogin = pathAndQuery.contains("login") || pathAndQuery.contains("signin") ||
            pathAndQuery.contains("auth")
        if (!isDisqus || !isLogin) return

        // Run Disqus' own login inside the app (shared cookie jar) instead of an external Custom Tab —
        // a Custom Tab can't complete Disqus' popup+postMessage handshake and strands the session cookie.
        showDisqusLogin(uri)
    }

    private fun launchBrowser(uri: Uri) {
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

    @Command
    fun openBrowser(invoke: Invoke) {
        val args = invoke.parseArgs(BrowserArgs::class.java)
        val uri = runCatching { Uri.parse(args.url) }.getOrNull()
        if (uri == null || uri.scheme != "https" || uri.host.isNullOrBlank()) {
            invoke.reject("Only HTTPS browser URLs are allowed")
            return
        }
        launchBrowser(uri)
        invoke.resolve()
    }

    /** Android's real system share sheet, rather than silently copying a URL to the clipboard. */
    @Command
    fun shareText(invoke: Invoke) {
        val args = invoke.parseArgs(ShareTextArgs::class.java)
        activity.runOnUiThread {
            try {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_SUBJECT, args.title)
                    putExtra(Intent.EXTRA_TEXT, args.text)
                }
                activity.startActivity(Intent.createChooser(send, args.title))
                invoke.resolve()
            } catch (error: Exception) {
                invoke.reject("Could not open the Android share sheet", error)
            }
        }
    }

    // WRY's Android WebView keeps zoom enabled and ignores the viewport `user-scalable=no`, so the
    // page pinch- / double-tap-zooms on mobile (content zooms while the fixed nav stays put). Kill
    // it at the WebView-settings level the moment the webview is created.
    override fun load(webView: WebView) {
        appWebView = webView
        activity.runOnUiThread {
            runCatching { initCast() }
                .onFailure { Log.w("IzumiCast", "Cast SDK initialization deferred: ${it.message}") }
        }
        webView.settings.setSupportZoom(false)
        webView.settings.builtInZoomControls = false
        webView.settings.displayZoomControls = false
        webView.settings.textZoom = 100 // ignore the system font-scale
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }
        // Disqus renders inside a cross-origin child frame. Install narrowly scoped document-start
        // hooks there for browser login and touch-scroll handoff. The Android watch page expands
        // that frame to its content height, so a drag starting inside it otherwise has no scroll
        // owner and never reaches the surrounding episode-details page.
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
                (() => {
                  if (location.hostname !== 'disqus.com' || !location.pathname.startsWith('/embed/comments')) return;
                  if (new URLSearchParams(location.search).get('f') !== 'discussanime') return;
                  if (window.__izumiDisqusTouchBridge) return;
                  window.__izumiDisqusTouchBridge = true;
                  let active = false;
                  let moved = false;
                  let startY = 0;
                  let lastY = 0;
                  let lastAt = 0;
                  const yOf = (touch) => Number.isFinite(touch.screenY) ? touch.screenY : touch.clientY;
                  const relay = (phase, dy, dt) => {
                    try {
                      window.parent.postMessage({
                        type: 'izumi-disqus-touch-scroll',
                        phase,
                        dy: dy || 0,
                        dt: dt || 0,
                      }, '*');
                    } catch (_) {}
                  };
                  document.addEventListener('touchstart', (event) => {
                    if (event.touches.length !== 1) return;
                    const now = performance.now();
                    const y = yOf(event.touches[0]);
                    active = true;
                    moved = false;
                    startY = lastY = y;
                    lastAt = now;
                    relay('start', 0, 0);
                  }, { capture: true, passive: true });
                  document.addEventListener('touchmove', (event) => {
                    if (!active || event.touches.length !== 1) return;
                    const now = performance.now();
                    const y = yOf(event.touches[0]);
                    const total = startY - y;
                    const dy = lastY - y;
                    const dt = Math.max(1, now - lastAt);
                    lastY = y;
                    lastAt = now;
                    if (!moved && Math.abs(total) < 10) return;
                    moved = true;
                    if (event.cancelable) event.preventDefault();
                    event.stopPropagation();
                    relay('move', dy, dt);
                  }, { capture: true, passive: false });
                  const finish = () => {
                    if (!active) return;
                    active = false;
                    if (moved) relay('end', 0, 0);
                    moved = false;
                  };
                  document.addEventListener('touchend', finish, { capture: true, passive: true });
                  document.addEventListener('touchcancel', finish, { capture: true, passive: true });
                })();
                """.trimIndent(),
                origins,
            )
        }
    }

    @Command
    fun downloadForeground(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadForegroundArgs::class.java)
        val context = activity.applicationContext
        val intent = Intent(context, DownloadService::class.java)
        if (args.active) {
            intent.putExtra(DownloadService.EXTRA_TITLE, args.title)
            intent.putExtra(DownloadService.EXTRA_DETAIL, args.detail)
            intent.putExtra(DownloadService.EXTRA_PROGRESS, args.progress ?: -1)
            intent.putExtra(DownloadService.EXTRA_COUNT, args.count ?: 1)
            try {
                // startForegroundService both starts the service and refreshes the notification
                // on subsequent calls (onStartCommand re-posts it). Foreground-start restrictions
                // are handled inside the service; a refusal degrades to foreground-only downloads.
                androidx.core.content.ContextCompat.startForegroundService(context, intent)
            } catch (e: Exception) {
                Log.w("ExtPlayerPlugin", "download service start failed: $e")
            }
        } else {
            context.stopService(intent)
        }
        invoke.resolve()
    }

    @Command
    fun companionCastForeground(invoke: Invoke) {
        val args = invoke.parseArgs(CompanionCastForegroundArgs::class.java)
        val context = activity.applicationContext
        val intent = Intent(context, CompanionCastService::class.java)
        if (args.active) {
            intent.putExtra(CompanionCastService.EXTRA_TITLE, args.title)
            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (error: Exception) {
                Log.w("ExtPlayerPlugin", "TV relay service start failed", error)
            }
        } else {
            context.stopService(intent)
        }
        invoke.resolve()
    }

    /** Ask only when a user starts/resumes a download. Without this runtime grant Android 13+
     *  keeps the required foreground-service notice out of the notification drawer. */
    @Command
    fun requestDownloadNotifications(invoke: Invoke) {
        if (android.os.Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        ) {
            invoke.resolve(JSObject().put("granted", true))
            return
        }
        requestPermissionForAliases(
            arrayOf("downloadNotifications"),
            invoke,
            "downloadNotificationsResult",
        )
    }

    @PermissionCallback
    fun downloadNotificationsResult(invoke: Invoke) {
        val granted = android.os.Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        invoke.resolve(JSObject().put("granted", granted))
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

    // Combined SAF create + write. Do not split this into dialog.save() + std::fs::write:
    // Android returns a content:// URI, JNI against the Activity from a worker thread kills
    // the process, and the picker can recreate the Activity. Write the bytes to cache first
    // so the document copy in onActivityResult does not depend on the IPC payload still
    // sitting in memory.
    @Command
    fun saveTextFile(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SaveTextFileArgs::class.java)
            val pending = File(activity.cacheDir, "izumi-pending-save.bin")
            pending.writeText(args.contents)
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = args.mime?.takeIf { it.isNotBlank() } ?: "*/*"
                putExtra(Intent.EXTRA_TITLE, args.fileName.ifBlank { "izumi-backup.json" })
            }
            startActivityForResult(invoke, intent, "saveTextFileResult")
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to open the save picker")
        }
    }

    @ActivityCallback
    fun saveTextFileResult(invoke: Invoke, result: ActivityResult) {
        val pending = File(activity.cacheDir, "izumi-pending-save.bin")
        fun done(saved: Boolean, error: String? = null) {
            pending.delete()
            if (error != null) invoke.reject(error)
            else invoke.resolve(JSObject().put("saved", saved))
        }
        try {
            if (result.resultCode != Activity.RESULT_OK) {
                done(false)
                return
            }
            val uri = result.data?.data
            if (uri == null) {
                done(false)
                return
            }
            if (!pending.isFile) {
                done(false, "The backup data was lost before it could be written")
                return
            }
            activity.contentResolver.openOutputStream(uri, "wt").use { out ->
                if (out == null) {
                    done(false, "Could not open the chosen location")
                    return
                }
                pending.inputStream().use { input -> input.copyTo(out) }
                out.flush()
            }
            done(true)
        } catch (ex: Exception) {
            done(false, ex.message ?: "Failed to write the file")
        }
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

    private fun hasAuthCookie(cookie: String): Boolean =
        cookie.contains("session_token=") && !cookie.contains("session_token=;")

    // Full-screen overlay WebView that shares the process-global CookieManager with the app WebView, so
    // a login completed here is visible to the embed/native commands afterward. Returns the overlay +
    // its WebView; the caller adds the overlay to the content view and drives navigation.
    private fun makeOverlay(onClose: () -> Unit): Pair<FrameLayout, WebView> {
        val overlay = FrameLayout(activity).apply { setBackgroundColor(Color.rgb(10, 10, 11)) }
        val web = WebView(activity)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }
        overlay.addView(web, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))
        val close = Button(activity).apply {
            text = "Close"
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.argb(220, 24, 24, 27))
            setOnClickListener { onClose() }
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
        return overlay to web
    }

    // Disqus' logged-in marker in the shared jar: the Django `sessionid` cookie on disqus.com. Returned
    // as a value (not a boolean) because an anonymous visit can already carry one — Django rotates the
    // session key on login, so a CHANGED value is the signal, not mere presence.
    private fun disqusSessionId(): String? {
        val jar = CookieManager.getInstance().getCookie("https://disqus.com/") ?: return null
        for (part in jar.split(';')) {
            val entry = part.trim()
            if (!entry.startsWith("sessionid=")) continue
            return entry.removePrefix("sessionid=").ifEmpty { null }
        }
        return null
    }

    // Disqus' own comment login (opened via the window.open hook in load()). A Custom Tab can't complete
    // Disqus' popup+postMessage handshake and lands the session cookie in the wrong jar, so run it in an
    // in-app overlay sharing the WebView cookie jar. On finish, reload the embed iframe so it re-boots
    // with the new session cookie.
    //
    // Closing it must NOT rely on Disqus calling window.close(): this overlay is a plain WebView, not a
    // script-opened popup, so it has no `opener` and Chromium ignores close() on it — Disqus' post-login
    // page then spins forever on a handshake that can't complete and onCloseWindow never fires, leaving
    // the overlay stuck over the app. So drive the teardown from our side: poll the disqus.com jar for a
    // new `sessionid`, and treat a navigation back to the comments embed as done too (same signal the
    // OAuth capture path uses). onCloseWindow stays wired as a bonus for the cases where it does fire.
    private fun showDisqusLogin(uri: Uri) {
        activity.runOnUiThread {
            val content = activity.findViewById<ViewGroup>(android.R.id.content)
            val handler = Handler(Looper.getMainLooper())
            var done = false
            var overlayRef: FrameLayout? = null
            var webRef: WebView? = null
            val sessionBefore = disqusSessionId()
            fun finish() {
                if (done) return
                done = true
                handler.removeCallbacksAndMessages(null)
                CookieManager.getInstance().flush()
                (overlayRef?.parent as? ViewGroup)?.removeView(overlayRef)
                webRef?.stopLoading()
                webRef?.destroy()
                appWebView?.evaluateJavascript(
                    "document.querySelectorAll('iframe').forEach(function(f){try{if(f.src&&f.src.indexOf('disqus-embed')>-1){f.src=f.src;}}catch(e){}});",
                    null,
                )
            }
            val (overlay, web) = makeOverlay { finish() }
            overlayRef = overlay
            webRef = web
            web.webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                    val parsed = Uri.parse(url)
                    val host = parsed.host.orEmpty()
                    if (host != "disqus.com" && !host.endsWith(".disqus.com")) return
                    val path = parsed.path.orEmpty()
                    // End of the round trip: the OAuth provider handing back (`/_ax/<provider>/complete/`,
                    // `/profile/login/complete/`) or the popup bouncing to the comments embed.
                    if (path.startsWith("/embed/comments") || path.contains("/complete")) finish()
                }
            }
            web.webChromeClient = object : WebChromeClient() {
                override fun onCloseWindow(window: WebView) { finish() }
            }
            content.addView(overlay, ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ))
            web.loadUrl(uri.toString())
            var waited = 0
            var baseline = sessionBefore
            val poll = object : Runnable {
                override fun run() {
                    if (done) return
                    val now = disqusSessionId()
                    // For the first seconds the login page's own cookies are still landing, so keep
                    // re-baselining instead of reading them as a sign-in — nobody completes a login
                    // that fast, so no real one is missed and the overlay can't self-close on load.
                    if (waited < 3_000) baseline = now
                    else if (now != null && now != baseline) { finish(); return }
                    waited += 700
                    if (waited > 300_000) { finish(); return } // never leave the overlay up forever
                    handler.postDelayed(this, 700)
                }
            }
            handler.postDelayed(poll, 700)
        }
    }

    // Sign in to discussanime (the reactions backend) in the in-app overlay; resolve once its session
    // cookie appears in the shared jar (mirrors the desktop da_login cookie-poll). The overlay stays in
    // the Activity, so the pending react held by the frontend survives and can be replayed.
    @Command
    fun daLogin(invoke: Invoke) {
        val a = invoke.parseArgs(DaLoginArgs::class.java)
        val base = a.base.trimEnd('/')
        if (hasAuthCookie(CookieManager.getInstance().getCookie("$base/") ?: "")) {
            invoke.resolve(JSObject().put("ok", true))
            return
        }
        activity.runOnUiThread {
            val content = activity.findViewById<ViewGroup>(android.R.id.content)
            val handler = Handler(Looper.getMainLooper())
            var done = false
            var overlayRef: FrameLayout? = null
            var webRef: WebView? = null
            fun finish(ok: Boolean) {
                if (done) return
                done = true
                handler.removeCallbacksAndMessages(null)
                CookieManager.getInstance().flush()
                (overlayRef?.parent as? ViewGroup)?.removeView(overlayRef)
                webRef?.stopLoading()
                webRef?.destroy()
                invoke.resolve(JSObject().put("ok", ok))
            }
            val (overlay, web) = makeOverlay { finish(false) }
            overlayRef = overlay
            webRef = web
            web.webViewClient = WebViewClient()
            content.addView(overlay, ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ))
            web.loadUrl("$base/auth/disqus/login")
            var waited = 0
            val poll = object : Runnable {
                override fun run() {
                    if (done) return
                    if (hasAuthCookie(CookieManager.getInstance().getCookie("$base/") ?: "")) { finish(true); return }
                    waited += 800
                    if (waited > 300_000) { finish(false); return }
                    handler.postDelayed(this, 800)
                }
            }
            handler.postDelayed(poll, 800)
        }
    }

    // Read reaction counts + the signed-in user's selected key, carrying the da_session cookie that the
    // in-frame browser fetch cannot. Returns the raw JSON body for the frontend to parse. Runs off the
    // UI thread (HttpURLConnection must not touch the main thread).
    @Command
    fun daReactionState(invoke: Invoke) {
        val a = invoke.parseArgs(DaReactionArgs::class.java)
        Thread {
            try {
                val base = a.base.trimEnd('/')
                val cookie = CookieManager.getInstance().getCookie("$base/") ?: ""
                val conn = URL("$base/api/threads/by-identifier/${Uri.encode(a.identifier)}/reaction")
                    .openConnection() as HttpURLConnection
                conn.requestMethod = "GET"
                if (cookie.isNotEmpty()) conn.setRequestProperty("Cookie", cookie)
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                val code = conn.responseCode
                val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                    ?.bufferedReader()?.use { it.readText() } ?: ""
                conn.disconnect()
                if (code !in 200..299) { invoke.reject("reaction state HTTP $code"); return@Thread }
                invoke.resolve(JSObject().put("body", body))
            } catch (e: Exception) {
                invoke.reject(e.message ?: "reaction state failed")
            }
        }.start()
    }

    // Post (or clear, key=null) a discussanime reaction authenticated by the da_session cookie. Returns
    // needsLogin when there is no live session, so the frontend can run daLogin then retry.
    @Command
    fun daReact(invoke: Invoke) {
        val a = invoke.parseArgs(DaReactArgs::class.java)
        Thread {
            try {
                val base = a.base.trimEnd('/')
                val cookie = CookieManager.getInstance().getCookie("$base/") ?: ""
                if (!hasAuthCookie(cookie)) {
                    invoke.resolve(JSObject().put("ok", false).put("needsLogin", true))
                    return@Thread
                }
                val conn = URL("$base/api/threads/by-identifier/${Uri.encode(a.identifier)}/reaction")
                    .openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Cookie", cookie)
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Origin", base)
                conn.doOutput = true
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                val key = a.key
                val payload = if (key == null) "{\"reaction\":null}" else "{\"reaction\":\"$key\"}"
                conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                    ?.bufferedReader()?.use { it.readText() } ?: ""
                conn.disconnect()
                when {
                    code == 401 -> invoke.resolve(JSObject().put("ok", false).put("needsLogin", true))
                    code !in 200..299 -> invoke.resolve(JSObject().put("ok", false).put("needsLogin", false))
                    else -> invoke.resolve(JSObject().put("ok", true).put("needsLogin", false).put("body", body))
                }
            } catch (e: Exception) {
                invoke.reject(e.message ?: "react failed")
            }
        }.start()
    }

    // Runtime-host dependencies must win over similarly named app dependencies (Kotlin/OkHttp),
    // except AndroidX classes which have to keep the Activity's process-wide identity.
    private class ChildFirstClassLoader(
        dexPath: String,
        optimizedDirectory: String?,
        librarySearchPath: String?,
        parent: ClassLoader,
    ) : DexClassLoader(dexPath, optimizedDirectory, librarySearchPath, parent) {
        private val system = getSystemClassLoader()

        override fun loadClass(name: String?, resolve: Boolean): Class<*> {
            var loaded = findLoadedClass(name)
            if (loaded == null) {
                loaded = runCatching { system?.loadClass(name) }.getOrNull()
            }
            if (loaded == null && name?.startsWith("androidx.") == true) {
                loaded = runCatching { parent.loadClass(name) }.getOrNull()
            }
            if (loaded == null) {
                loaded = try {
                    findClass(name)
                } catch (_: ClassNotFoundException) {
                    super.loadClass(name, false)
                }
            }
            if (resolve) resolveClass(loaded)
            return loaded
        }
    }
}
