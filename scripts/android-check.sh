#!/usr/bin/env bash
# Local Android compile-check (no APK): cargo check for the aarch64 target with the NDK toolchain.
# Mirrors the recipe CI uses; catches #[cfg(target_os = "android")] Rust errors in ~1 min warm.
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"
NDK="$LOCALAPPDATA/Android/Sdk/ndk/30.0.15729638"
BIN="$NDK/toolchains/llvm/prebuilt/windows-x86_64/bin"
export ANDROID_NDK_ROOT="$NDK" NDK_HOME="$NDK" PATH="$BIN:$PATH"
export CC_aarch64_linux_android="$BIN/aarch64-linux-android26-clang.cmd"
export AR_aarch64_linux_android="$BIN/llvm-ar.exe"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$BIN/aarch64-linux-android26-clang.cmd"
cargo check --target aarch64-linux-android --features android-mpv "$@"
