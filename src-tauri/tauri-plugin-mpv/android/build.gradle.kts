plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.izumi.mpv"
    compileSdk = 34

    defaultConfig {
        minSdk = 26
        // Match izumi's --target aarch64 CI: ship only the arm64 libmpv .so (keeps the
        // full-flavor APK to one ABI's ~24 MB native payload instead of all four).
        ndk { abiFilters += "arm64-v8a" }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    // The Tauri Android runtime (Plugin, Invoke, annotations). Resolved from the app's
    // included tauri-android build when the plugin is assembled by the CLI.
    implementation(project(":tauri-android"))
    // Prebuilt libmpv (Findroid's build): dev.jdtech.mpv.MPVLib JNI + arm64 .so bundling
    // libmpv + ffmpeg + libass (styled subtitles) + mediacodec (hw decode). Verified 1.0.0.
    implementation("dev.jdtech.mpv:libmpv:1.0.0")
}
