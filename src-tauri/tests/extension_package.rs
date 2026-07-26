// Compile the package validator as an isolated integration target. This keeps
// its archive/integrity tests independent of Izumi's native libmpv test binary,
// which requires the distributable mpv DLL at runtime on Windows.
#![allow(dead_code)]

#[path = "../src/extension_package.rs"]
mod extension_package;
