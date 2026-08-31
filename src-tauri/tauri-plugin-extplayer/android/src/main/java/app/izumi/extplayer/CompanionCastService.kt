package app.izumi.extplayer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

/** Session-scoped keepalive used only when a source is available through this phone. */
class CompanionCastService : Service() {
    companion object {
        const val EXTRA_TITLE = "title"
        private const val CHANNEL_ID = "izumi-tv-relay"
        private const val NOTIFICATION_ID = 0x1203
        private const val MAX_SESSION_MS = 6L * 60 * 60 * 1000
        private const val TAG = "IzumiCompanionCast"
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private val stopHandler = Handler(Looper.getMainLooper())
    private val hardStop = Runnable {
        Log.i(TAG, "Stopping the local TV source bridge after the maximum session length")
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        val manager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "izumi:tv-relay").also {
            it.setReferenceCounted(false)
            it.acquire(MAX_SESSION_MS)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        stopHandler.removeCallbacks(hardStop)
        stopHandler.postDelayed(hardStop, MAX_SESSION_MS)
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = launch?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(intent?.getStringExtra(EXTRA_TITLE) ?: "Playing on your TV")
            .setContentText("Keeping a local-only source available to your TV")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setContentIntent(contentIntent)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (error: Exception) {
            Log.w(TAG, "Local TV source bridge foreground service refused", error)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopHandler.removeCallbacks(hardStop)
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "TV playback", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown only when a TV source depends on this phone"
                setShowBadge(false)
            },
        )
    }
}
