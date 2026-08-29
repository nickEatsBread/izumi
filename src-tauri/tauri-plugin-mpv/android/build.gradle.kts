plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.izumi.mpv"
    compileSdk = 36

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
    // A direct Surface/MediaCodec path is required for genuine Dolby Vision signalling. libmpv's
    // mediacodec-copy path reads decoded frames back into OpenGL and cannot preserve that signal.
    val media3Version = "1.11.0"
    implementation("androidx.media3:media3-exoplayer:$media3Version")
    implementation("androidx.media3:media3-exoplayer-dash:$media3Version")
    implementation("androidx.media3:media3-exoplayer-hls:$media3Version")
    implementation("androidx.media3:media3-ui:$media3Version")
    // The Tauri Android runtime (Plugin, Invoke, annotations). Resolved from the app's
    // included tauri-android build when the plugin is assembled by the CLI.
    implementation(project(":tauri-android"))
    testImplementation("junit:junit:4.13.2")
    // Release/preview CI stages an arm64 AAR built from the pinned upstream source commit in
    // scripts/ci/libmpv-android.sh. It includes libass 0.17.5; Maven Central 1.0.0 still embeds
    // vulnerable 0.17.4. Keep the Central fallback only for IDE/debug setup until upstream
    // publishes its next AAR; refusing a release task closes every path around the CI gate.
    val stagedLibmpv = file("libs/libmpv.aar")
    val isReleaseBuild = gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }
    when {
        stagedLibmpv.isFile -> implementation(files(stagedLibmpv))
        !isReleaseBuild -> implementation("dev.jdtech.mpv:libmpv:1.0.0")
        else -> throw GradleException(
            "Release builds require the libass 0.17.5 AAR. Run scripts/ci/libmpv-android.sh first."
        )
    }
}
