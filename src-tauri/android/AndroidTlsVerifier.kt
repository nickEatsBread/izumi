package com.nicho.izumi

import android.content.Context

/** Initializes rustls against Android's system certificate verifier before Tauri starts. */
object AndroidTlsVerifier {
  init {
    System.loadLibrary("izumi_lib")
  }

  external fun initialize(context: Context)
}
