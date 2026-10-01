package com.nicho.izumi

import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

/** App-owned activity installed over Tauri's generated shell by android-scaffold.sh. */
class MainActivity : TauriActivity() {
  private var television = false
  private var televisionWebView: WebView? = null

  private fun isTelevisionDevice(): Boolean {
    val type = resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK
    return type == Configuration.UI_MODE_TYPE_TELEVISION ||
      packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
      packageManager.hasSystemFeature(PackageManager.FEATURE_TELEVISION)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    AndroidTlsVerifier.initialize(applicationContext)
    television = isTelevisionDevice()
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (television) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    televisionWebView = webView
    if (!television) {
      installSystemBackBridge(webView)
      return
    }
    if (!webView.settings.userAgentString.contains("IzumiTV/")) {
      webView.settings.userAgentString = webView.settings.userAgentString + " IzumiTV/1"
    }
    webView.isFocusable = true
    webView.isFocusableInTouchMode = true
    webView.requestFocus()
  }

  /**
   * Phone and tablet system Back (the 3-button Back and the back gesture, which never sends
   * KEYCODE_BACK) asks the web layer first. window.__izumiBack() runs the layered Back pipeline
   * (src/lib/nav/back.ts) and answers true when it closed a layer, dialog, sheet, the keyboard or a
   * settings level. On any other answer, including a page that has not booted yet or a script
   * error, this callback re-dispatches with itself disabled. The stock callback Tauri registered
   * earlier then runs: WebView history back, or leaving the app from the first page. This callback
   * is registered after Tauri's, so the dispatcher asks it first.
   */
  private fun installSystemBackBridge(webView: WebView) {
    val callback = object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val bridge = this
        webView.evaluateJavascript("window.__izumiBack?.()===true") { handled ->
          if (handled == "true" || isFinishing || isDestroyed) return@evaluateJavascript
          bridge.isEnabled = false
          onBackPressedDispatcher.onBackPressed()
          bridge.isEnabled = true
        }
      }
    }
    onBackPressedDispatcher.addCallback(this, callback)
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (television && event.keyCode == KeyEvent.KEYCODE_BACK) {
      if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        televisionWebView?.evaluateJavascript(
          "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}))",
          null,
        )
      }
      return true
    }
    return super.dispatchKeyEvent(event)
  }

  override fun onDestroy() {
    televisionWebView = null
    super.onDestroy()
  }
}
