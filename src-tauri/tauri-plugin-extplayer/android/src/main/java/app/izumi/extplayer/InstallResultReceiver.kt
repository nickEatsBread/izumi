package app.izumi.extplayer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import app.tauri.plugin.Invoke
import java.util.concurrent.ConcurrentHashMap

// Answers for the self-update sessions ExtPlayerPlugin.installApk commits. The system reports
// PENDING_USER_ACTION when it still wants the user's confirmation (always before Android 12, and
// whenever it declines to update without one), then SUCCESS or a failure. On a silent update the
// process is replaced before SUCCESS can arrive, so the waiting invoke simply never settles.
class InstallResultReceiver : BroadcastReceiver() {
    companion object {
        /** installApk invokes waiting on their session's first answer, by session id. */
        val pending = ConcurrentHashMap<Int, Invoke>()
    }

    override fun onReceive(context: Context, intent: Intent) {
        val invoke = pending.remove(intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1))
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = if (android.os.Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                if (confirm == null) {
                    invoke?.reject("Android did not open its installer")
                    return
                }
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try {
                    context.startActivity(confirm)
                    invoke?.resolve()
                } catch (ex: Exception) {
                    invoke?.reject(ex.message ?: "Android did not open its installer")
                }
            }
            // The user backed out of the confirmation: not an error, the app offers to reopen it.
            PackageInstaller.STATUS_SUCCESS, PackageInstaller.STATUS_FAILURE_ABORTED -> invoke?.resolve()
            else -> invoke?.reject(
                intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Update failed (status $status)"
            )
        }
    }
}
