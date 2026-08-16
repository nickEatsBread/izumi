//! Android/JVM bridge for rustls' platform certificate verifier.
//!
//! Tauri's process lifecycle observer starts the Rust application from
//! `WryActivity.onCreate`. The app-owned activity calls this JNI entry point before
//! `super.onCreate`, so no Reqwest or plugin HTTP worker can race initialization.

use jni::objects::JObject;
use jni::EnvUnowned;

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_nicho_izumi_AndroidTlsVerifier_initialize<'local>(
    mut env: EnvUnowned<'local>,
    _this: JObject<'local>,
    context: JObject<'local>,
) {
    env.with_env(move |env| rustls_platform_verifier::android::init_with_env(env, context))
        .resolve::<jni::errors::ThrowRuntimeExAndDefault>();
}
