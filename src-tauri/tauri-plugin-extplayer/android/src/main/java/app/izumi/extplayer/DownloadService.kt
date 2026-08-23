package app.izumi.extplayer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Foreground dataSync service that keeps episode downloads running while the app is backgrounded.
 *
 * The download engine itself is Rust (reqwest streaming) inside the app process, and the queue
 * pump is JS awaiting each `download_start` invoke. Neither needs Android-side help EXCEPT that a
 * backgrounded app becomes a cached process: the WebView freezes (pump can't advance past the
 * current file) and the process is a kill candidate mid-transfer. Holding a foreground service —
 * plus a partial wake lock for Doze — keeps the process live and unfrozen, which is all the
 * existing pipeline needs to just keep working.
 *
 * The service is started/updated/stopped by the plugin's `downloadForeground` command, driven by
 * the JS queue: started when a download begins (always from the foreground — Android 15 forbids
 * starting a dataSync FGS from the background), notification updated as progress events arrive,
 * stopped when the queue drains. Android 15 also budgets dataSync at ~6h/day; the wake lock
 * carries the same bound so a wedged queue cannot pin the CPU indefinitely.
 */
class DownloadService : Service() {
    companion object {
        const val EXTRA_TITLE = "title"
        const val EXTRA_DETAIL = "detail"
        const val EXTRA_PROGRESS = "progress" // 0-100, or -1 for indeterminate
        const val EXTRA_COUNT = "count"       // total items active+queued, for the line under the title
        private const val CHANNEL_ID = "izumi-downloads"
        private const val NOTIFICATION_ID = 0x1202 // PlaybackService uses 0x1201
        private const val WAKE_LOCK_MAX_MS = 6L * 60 * 60 * 1000
        private const val TAG = "IzumiDownloadService"
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        val manager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "izumi:downloads").also {
            it.setReferenceCounted(false)
            it.acquire(WAKE_LOCK_MAX_MS)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification(
            title = intent?.getStringExtra(EXTRA_TITLE),
            detail = intent?.getStringExtra(EXTRA_DETAIL),
            progress = intent?.getIntExtra(EXTRA_PROGRESS, -1) ?: -1,
            count = intent?.getIntExtra(EXTRA_COUNT, 1) ?: 1,
        )
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            // ForegroundServiceStartNotAllowedException (background start) or a type-permission
            // refusal: the download itself still runs while the app is foregrounded — degrade to
            // that rather than crash.
            Log.w(TAG, "startForeground refused: $e")
            stopSelf()
        }
        // The queue survives a process kill anyway (.part + Range resume + boot requeue), so
        // there is nothing worth resurrecting a dead service for.
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Removing the UI task is not cancelling a user-requested download. The foreground service
        // deliberately remains alive; force-stop is the Android-level action that cancels all work.
        super.onTaskRemoved(rootIntent)
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        // Android 15 caps dataSync foreground work. Stop promptly when the OS exhausts that budget
        // so it does not raise an ANR; the persisted queue resumes the partial file next launch.
        Log.w(TAG, "dataSync foreground-service budget exhausted")
        stopSelf(startId)
    }

    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    private fun buildNotification(title: String?, detail: String?, progress: Int, count: Int): android.app.Notification {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = launch?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title ?: "Downloading")
            .setContentText(detail ?: if (count > 1) "$count episodes" else "Preparing download…")
            .setProgress(100, progress.coerceIn(0, 100), progress < 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(contentIntent)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Episode download progress"
                setShowBadge(false)
            },
        )
    }
}
