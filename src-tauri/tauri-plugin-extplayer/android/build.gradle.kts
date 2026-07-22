plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.izumi.extplayer"
    compileSdk = 34

    defaultConfig {
        minSdk = 26
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
    implementation("androidx.browser:browser:1.10.0")
    implementation("androidx.webkit:webkit:1.16.0")
    // The Tauri Android runtime (Plugin, Invoke, annotations). Resolved from the
    // app's included tauri-android build when the plugin is assembled by the CLI.
    implementation(project(":tauri-android"))
}
