package app.izumi.mpv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * Foreground service that keeps playback (and its media notification) alive once the activity is
 * no longer visible.
 *
 * Without this the process is an ordinary backgrounded app: Android is free to freeze or kill it
 * the moment the user leaves, so a lock-screen transport would control something that had already
 * stopped. The service owns no player state — [MediaController] does — it exists purely to hold the
 * `mediaPlayback` foreground type for as long as there is something to control.
 */
class PlaybackService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Android kills the process if startForeground doesn't happen within a few seconds of the
        // start request, so a notification is posted unconditionally — even in the race where
        // playback stopped between the start call and this callback.
        val notification = MediaController.buildNotification(this) ?: placeholder()
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(
                    MediaController.NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            } else {
                startForeground(MediaController.NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.w("IzumiMedia", "startForeground refused: ${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }
        if (!MediaController.active) stopSelf()
        // Never restart on our own: playback state lives in the activity's libmpv core, so a
        // service resurrected without it would be an empty transport.
        return START_NOT_STICKY
    }

    /** Swiping the app out of recents ends the session rather than leaving orphaned audio. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        MediaController.handleAction(MediaController.CODE_STOP)
        MediaController.stop()
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE)
        else @Suppress("DEPRECATION") stopForeground(true)
        super.onDestroy()
    }

    /** Minimal stand-in used only to satisfy the startForeground deadline before stopping. */
    private fun placeholder(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(PLACEHOLDER_CHANNEL) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    PLACEHOLDER_CHANNEL,
                    "Playback",
                    NotificationManager.IMPORTANCE_MIN,
                ),
            )
        }
        return Notification.Builder(this, PLACEHOLDER_CHANNEL)
            .setSmallIcon(R.drawable.ic_izumi_playback)
            .setContentTitle("izumi")
            .build()
    }

    private companion object {
        const val PLACEHOLDER_CHANNEL = "izumi-playback-idle"
    }
}
