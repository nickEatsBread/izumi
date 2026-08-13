#!/usr/bin/env bash
# Build the arm64 libmpv AAR from a reviewed upstream commit. Maven Central 1.0.0 embeds
# libass 0.17.4; upstream has not published the 0.17.5 security update as a new AAR yet.
set -euo pipefail

readonly REPO="https://github.com/jarnedemeulemeester/libmpv-android.git"
readonly COMMIT="f77f62c316c6b222e75ece48e1fbf1e798fd83e7"
readonly CACHE_ROOT="${HOME}/.cache/izumi-libmpv-android/${COMMIT}"
readonly CACHED_AAR="${CACHE_ROOT}/libmpv-release.aar"
readonly DEST="src-tauri/tauri-plugin-mpv/android/libs/libmpv.aar"

if [ ! -s "$CACHED_AAR" ]; then
  sudo apt-get update
  sudo apt-get install -y autoconf pkgconf libtool ninja-build python3-pip python3-jinja2 gperf nasm
  sudo pip3 install --break-system-packages meson

  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  git clone --filter=blob:none "$REPO" "$WORK/source"
  git -C "$WORK/source" checkout --detach "$COMMIT"

  # Pin proof before spending time compiling the native dependency graph.
  grep -q '^v_ndk=29\.' "$WORK/source/buildscripts/include/depinfo.sh"
  grep -q '^v_libass=0\.17\.5$' "$WORK/source/buildscripts/include/depinfo.sh"

  # The libmpv AAR module declares no abiFilters, so its Gradle assembly compiles the CMake
  # wrapper (libplayer.so) for every default ABI — but `--arch arm64` below stages native deps
  # for arm64 only, and ninja then fails on the missing armeabi-v7a libmpv.so. The shipped APK is
  # aarch64-only; constrain the AAR to match.
  sed -i 's/minSdk = 26/minSdk = 26\n        ndk { abiFilters.add("arm64-v8a") }/' \
    "$WORK/source/libmpv/build.gradle.kts"
  grep -q 'abiFilters.add("arm64-v8a")' "$WORK/source/libmpv/build.gradle.kts" \
    || { echo "abiFilters patch missed — libmpv build.gradle.kts shape changed"; exit 1; }

  (
    cd "$WORK/source/buildscripts"
    ./download.sh
    ./build.sh --arch arm64
  )
  test -s "$WORK/source/libmpv/build/outputs/aar/libmpv-release.aar"
  mkdir -p "$CACHE_ROOT"
  cp "$WORK/source/libmpv/build/outputs/aar/libmpv-release.aar" "$CACHED_AAR"
fi

mkdir -p "$(dirname "$DEST")"
cp "$CACHED_AAR" "$DEST"

# The mpv binary includes libass's source version string, giving the release job an assertion on
# the actual payload rather than merely trusting the dependency script used to build it.
unzip -p "$DEST" jni/arm64-v8a/libmpv.so | strings | grep 'commit: 0\.17\.5-' >/dev/null
echo "Staged arm64 libmpv with libass 0.17.5: $DEST"
