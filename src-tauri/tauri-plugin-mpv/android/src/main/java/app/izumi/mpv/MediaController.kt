package app.izumi.mpv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.abs

/** What the lock screen / notification transport asks the player to do. */
interface MediaTransport {
    fun onPlay()
    fun onPause()
    /** Absolute seek, in milliseconds — this is the notification's scrubber. */
    fun onSeekTo(positionMs: Long)
    fun onSkipNext()
    fun onSkipPrev()
    /** The user dismissed the notification or pressed stop. */
    fun onStop()
}

/**
 * The system-facing half of Android playback: a [MediaSession] plus the ongoing media notification
 * that renders it on the lock screen and in the notification shade's media area.
 *
 * The scrubber in that media control is not something we draw — the platform derives it from the
 * session, which is why [setDuration]/[setPosition] and `ACTION_SEEK_TO` matter: without a duration
 * in the metadata and a seek action in the playback state, the system renders a static row with no
 * timeline at all.
 *
 * A process-wide singleton because [PlaybackService] (the foreground service that keeps playback
 * alive once the activity is no longer visible) has to build the same notification from its own
 * Context. Only the application context is retained.
 */
object MediaController {
    private const val TAG = "IzumiMedia"
    private const val CHANNEL_ID = "izumi-playback"
    const val NOTIFICATION_ID = 0x1201

    /** Broadcast fired by the notification's own action buttons. Package-scoped, never exported. */
    const val ACTION = "app.izumi.mpv.MEDIA_ACTION"
    const val EXTRA_CODE = "code"
    const val CODE_PLAY_PAUSE = 1
    const val CODE_NEXT = 2
    const val CODE_PREV = 3
    const val CODE_STOP = 4

    /** Republish the playback state at most this often while playing — the platform extrapolates
     *  position from the last state using the reported speed, so a constant stream of updates buys
     *  nothing and a periodic correction is enough. */
    private const val POSITION_REFRESH_MS = 5_000L
    /** A time-pos jump this large is a seek, not playback drift: publish immediately. */
    private const val SEEK_EPSILON_MS = 2_000L

    private val main = Handler(Looper.getMainLooper())

    private var appContext: Context? = null
    private var session: MediaSession? = null
    private var transport: MediaTransport? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var focusRequest: AudioFocusRequest? = null
    private var pausedByFocusLoss = false

    private var title = ""
    private var subtitle = ""
    private var artUrl: String? = null
    private var art: Bitmap? = null
    private var artLoadedFor: String? = null
    private var durationMs = 0L
    private var positionMs = 0L
    private var playing = false
    private var hasPrev = false
    private var hasNext = false
    private var lastPublishedPositionMs = -1L
    private var lastPublishedAt = 0L

    /** True between [start] and [stop] — the session exists and the notification is live. */
    @Volatile
    var active = false
        private set

    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
    }

    // --- Lifecycle ----------------------------------------------------------------------------

    /** Create the session + notification and start the foreground service. Idempotent. */
    fun start(context: Context, transport: MediaTransport) = onMain {
        val app = context.applicationContext
        appContext = app
        this.transport = transport
        if (session == null) {
            val created = MediaSession(app, "izumi")
            created.setCallback(callback)
            created.setSessionActivity(launchIntent(app))
            created.isActive = true
            session = created
        }
        active = true
        requestAudioFocus(app)
        publishMetadata()
        publishState(force = true)
        pushNotification(app)
        runCatching {
            ContextCompat.startForegroundService(app, Intent(app, PlaybackService::class.java))
        }.onFailure { Log.w(TAG, "foreground service refused: ${it.message}") }
        updateWakeLock(app)
    }

    /** Tear everything down: session, notification, foreground service, wake lock, audio focus. */
    fun stop() = onMain {
        val app = appContext
        active = false
        playing = false
        releaseWakeLock()
        if (app != null) {
            abandonAudioFocus(app)
            runCatching { app.stopService(Intent(app, PlaybackService::class.java)) }
            runCatching {
                (app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                    .cancel(NOTIFICATION_ID)
            }
        }
        session?.let {
            it.isActive = false
            runCatching { it.release() }
        }
        session = null
        transport = null
        art = null
        artLoadedFor = null
        artUrl = null
        title = ""
        subtitle = ""
        durationMs = 0L
        positionMs = 0L
        hasPrev = false
        hasNext = false
        lastPublishedPositionMs = -1L
    }

    // --- State fed by the player ---------------------------------------------------------------

    /** Now-playing identity. `art` is a poster URL; it is fetched off the main thread and folded
     *  into the metadata when it arrives, so a slow/failed image never delays the controls. */
    fun setMetadata(
        title: String,
        subtitle: String,
        artUrl: String?,
        hasPrev: Boolean,
        hasNext: Boolean,
    ) = onMain {
        this.title = title
        this.subtitle = subtitle
        this.hasPrev = hasPrev
        this.hasNext = hasNext
        if (artUrl != this.artUrl) {
            this.artUrl = artUrl
            this.art = null
            this.artLoadedFor = null
            if (!artUrl.isNullOrBlank()) loadArt(artUrl)
        }
        if (!active) return@onMain
        publishMetadata()
        publishState(force = true)
        appContext?.let { pushNotification(it) }
    }

    fun setPlaying(playing: Boolean) = onMain {
        if (this.playing == playing) return@onMain
        this.playing = playing
        // A deliberate resume means the user wants it back; drop the focus-loss latch so a later
        // transient loss doesn't resume something the user had already paused themselves.
        if (playing) pausedByFocusLoss = false
        if (!active) return@onMain
        publishState(force = true)
        appContext?.let {
            pushNotification(it)
            updateWakeLock(it)
        }
    }

    fun setDuration(seconds: Double) = onMain {
        val ms = if (seconds.isFinite() && seconds > 0) (seconds * 1000.0).toLong() else 0L
        if (ms == durationMs) return@onMain
        durationMs = ms
        if (!active) return@onMain
        publishMetadata()
        publishState(force = true)
    }

    fun setPosition(seconds: Double) = onMain {
        if (!seconds.isFinite() || seconds < 0) return@onMain
        val ms = (seconds * 1000.0).toLong()
        val jumped = abs(ms - positionMs) > SEEK_EPSILON_MS
        positionMs = ms
        if (!active) return@onMain
        val stale = android.os.SystemClock.elapsedRealtime() - lastPublishedAt > POSITION_REFRESH_MS
        if (jumped || stale) publishState(force = true)
    }

    // --- Notification -------------------------------------------------------------------------

    /**
     * Build the ongoing media notification, or null when nothing is playing. Called both by this
     * object (for updates) and by [PlaybackService] (for its own `startForeground`).
     */
    fun buildNotification(context: Context): Notification? {
        val token = session?.sessionToken ?: return null
        ensureChannel(context)
        val builder = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_izumi_playback)
            .setContentTitle(title.ifBlank { "izumi" })
            .setContentText(subtitle)
            .setContentIntent(launchIntent(context))
            .setDeleteIntent(actionIntent(context, CODE_STOP))
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
        art?.let { builder.setLargeIcon(it) }
        if (Build.VERSION.SDK_INT >= 31) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        }

        // Pre-33 platforms draw these buttons from the notification itself; 33+ derives them from
        // the session's playback-state actions instead. Supplying both keeps every version honest.
        val compact = ArrayList<Int>()
        var index = 0
        if (hasPrev) {
            builder.addAction(action(context, android.R.drawable.ic_media_previous, "Previous", CODE_PREV))
            compact.add(index++)
        }
        builder.addAction(
            action(
                context,
                if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (playing) "Pause" else "Play",
                CODE_PLAY_PAUSE,
            ),
        )
        compact.add(index++)
        if (hasNext) {
            builder.addAction(action(context, android.R.drawable.ic_media_next, "Next", CODE_NEXT))
            compact.add(index)
        }

        val style = Notification.MediaStyle().setMediaSession(token)
        style.setShowActionsInCompactView(*compact.toIntArray())
        builder.style = style
        return builder.build()
    }

    private fun pushNotification(context: Context) {
        val notification = buildNotification(context) ?: return
        runCatching {
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .notify(NOTIFICATION_ID, notification)
        }.onFailure { Log.w(TAG, "notify failed: ${it.message}") }
    }

    private fun ensureChannel(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        // LOW: an ongoing transport must never buzz, pop a heads-up or make a sound.
        val channel = NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW)
        channel.description = "Playback controls for the video you are watching"
        channel.setShowBadge(false)
        channel.enableVibration(false)
        channel.setSound(null, null)
        manager.createNotificationChannel(channel)
    }

    private fun action(context: Context, icon: Int, label: String, code: Int): Notification.Action =
        Notification.Action.Builder(
            android.graphics.drawable.Icon.createWithResource(context, icon),
            label,
            actionIntent(context, code),
        ).build()

    private fun actionIntent(context: Context, code: Int): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            code,
            Intent(ACTION).setPackage(context.packageName).putExtra(EXTRA_CODE, code),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun launchIntent(context: Context): PendingIntent {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: Intent(Intent.ACTION_MAIN)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    // --- Session ------------------------------------------------------------------------------

    private val callback = object : MediaSession.Callback() {
        override fun onPlay() { transport?.onPlay() }
        override fun onPause() { transport?.onPause() }
        override fun onStop() { transport?.onStop() }
        override fun onSeekTo(pos: Long) { transport?.onSeekTo(pos) }
        override fun onSkipToNext() { transport?.onSkipNext() }
        override fun onSkipToPrevious() { transport?.onSkipPrev() }
        override fun onFastForward() { transport?.onSeekTo(positionMs + 10_000L) }
        override fun onRewind() { transport?.onSeekTo((positionMs - 10_000L).coerceAtLeast(0L)) }
    }

    /** Route a notification-button broadcast into the transport. */
    fun handleAction(code: Int) {
        val t = transport ?: return
        when (code) {
            CODE_PLAY_PAUSE -> if (playing) t.onPause() else t.onPlay()
            CODE_NEXT -> t.onSkipNext()
            CODE_PREV -> t.onSkipPrev()
            CODE_STOP -> t.onStop()
        }
    }

    private fun publishMetadata() {
        val s = session ?: return
        val builder = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, subtitle)
            .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, subtitle)
            // Without a duration the system media control renders no timeline at all.
            .putLong(MediaMetadata.METADATA_KEY_DURATION, if (durationMs > 0) durationMs else -1L)
        art?.let {
            builder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it)
            builder.putBitmap(MediaMetadata.METADATA_KEY_ART, it)
        }
        runCatching { s.setMetadata(builder.build()) }
    }

    private fun publishState(force: Boolean) {
        val s = session ?: return
        if (!force && positionMs == lastPublishedPositionMs) return
        var actions = PlaybackState.ACTION_PLAY or
            PlaybackState.ACTION_PAUSE or
            PlaybackState.ACTION_PLAY_PAUSE or
            PlaybackState.ACTION_STOP or
            PlaybackState.ACTION_FAST_FORWARD or
            PlaybackState.ACTION_REWIND
        // The scrubber only appears when the session advertises that it can be scrubbed.
        if (durationMs > 0) actions = actions or PlaybackState.ACTION_SEEK_TO
        if (hasNext) actions = actions or PlaybackState.ACTION_SKIP_TO_NEXT
        if (hasPrev) actions = actions or PlaybackState.ACTION_SKIP_TO_PREVIOUS
        val state = PlaybackState.Builder()
            .setActions(actions)
            .setState(
                if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                positionMs,
                if (playing) 1f else 0f,
                android.os.SystemClock.elapsedRealtime(),
            )
            .build()
        runCatching { s.setPlaybackState(state) }
        lastPublishedPositionMs = positionMs
        lastPublishedAt = android.os.SystemClock.elapsedRealtime()
    }

    // --- Artwork ------------------------------------------------------------------------------

    private fun loadArt(url: String) {
        Thread {
            val bitmap = runCatching {
                val connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 8_000
                connection.readTimeout = 8_000
                connection.instanceFollowRedirects = true
                connection.inputStream.use { BitmapFactory.decodeStream(it) }
            }.getOrNull() ?: return@Thread
            // Metadata bitmaps cross a Binder transaction; a full-size poster is wasteful and can
            // trip the parcel limit on some devices.
            val scaled = if (maxOf(bitmap.width, bitmap.height) > 512) {
                val ratio = 512f / maxOf(bitmap.width, bitmap.height)
                Bitmap.createScaledBitmap(
                    bitmap,
                    (bitmap.width * ratio).toInt().coerceAtLeast(1),
                    (bitmap.height * ratio).toInt().coerceAtLeast(1),
                    true,
                )
            } else {
                bitmap
            }
            onMain {
                // The episode may have changed while this was downloading.
                if (artUrl != url || !active) return@onMain
                art = scaled
                artLoadedFor = url
                publishMetadata()
                appContext?.let { pushNotification(it) }
            }
        }.start()
    }

    // --- Audio focus + wake lock ---------------------------------------------------------------

    private fun requestAudioFocus(context: Context) {
        if (focusRequest != null) return
        val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
            .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener({ change -> onFocusChange(change) }, main)
            .build()
        focusRequest = request
        runCatching { manager.requestAudioFocus(request) }
    }

    private fun abandonAudioFocus(context: Context) {
        val request = focusRequest ?: return
        focusRequest = null
        pausedByFocusLoss = false
        val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        runCatching { manager.abandonAudioFocusRequest(request) }
    }

    private fun onFocusChange(change: Int) {
        val t = transport ?: return
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                pausedByFocusLoss = false
                if (playing) t.onPause()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                // Video has no useful ducked state — a quiet episode you can't follow is worse than
                // a paused one, and the position is kept either way.
                if (playing) {
                    pausedByFocusLoss = true
                    t.onPause()
                }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                if (pausedByFocusLoss) {
                    pausedByFocusLoss = false
                    t.onPlay()
                }
            }
        }
    }

    private fun updateWakeLock(context: Context) {
        if (playing && active) acquireWakeLock(context) else releaseWakeLock()
    }

    private fun acquireWakeLock(context: Context) {
        if (wakeLock?.isHeld == true) return
        val manager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        val lock = wakeLock ?: runCatching {
            manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "izumi:playback")
        }.getOrNull() ?: return
        lock.setReferenceCounted(false)
        runCatching { lock.acquire(4 * 60 * 60 * 1000L) }
        wakeLock = lock
    }

    private fun releaseWakeLock() {
        val lock = wakeLock ?: return
        if (lock.isHeld) runCatching { lock.release() }
    }
}
