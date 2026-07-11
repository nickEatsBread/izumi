package app.izumi.extplayer

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class PlayArgs {
    var url: String = ""
    var title: String? = null
    var isLocal: Boolean = false
}

@TauriPlugin
class ExtPlayerPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun play(invoke: Invoke) {
        val args = invoke.parseArgs(PlayArgs::class.java)

        val uri: Uri = if (args.isLocal) {
            // A local downloaded file → share it to the external player through a
            // FileProvider (file:// is blocked cross-app since Android 7).
            FileProvider.getUriForFile(
                activity,
                activity.packageName + ".fileprovider",
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
        }
        activity.startActivity(chooser)
        invoke.resolve()
    }
}
