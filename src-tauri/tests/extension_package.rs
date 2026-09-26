// Compile the package validator as an isolated integration target. This keeps
// its archive/integrity tests independent of Izumi's native libmpv test binary,
// which requires the distributable mpv DLL at runtime on Windows.
#![allow(dead_code)]

// The production module routes desktop Aniyomi APKs through this crate-level service. These
// integration tests exercise only the isolated package validator, so provide the dependency's
// compile-time shape without starting the JVM conversion runtime.
mod jvm_extensions {
    pub(crate) async fn convert_aniyomi_apk(
        _app: &tauri::AppHandle,
        _id: &str,
        _apk: &[u8],
    ) -> Result<Vec<u8>, String> {
        unreachable!("the package-validator tests do not install Aniyomi APKs")
    }
}

// Package signers are reported as key fingerprints in the same form as store keys, so the validator
// needs the store-trust module too.
#[path = "../src/store_trust.rs"]
mod store_trust;

#[path = "../src/extension_package.rs"]
mod extension_package;
