#!/usr/bin/env bash
# Build the reviewed stable libmpv used by Linux release/CI. Ubuntu 24.04 ships mpv 0.37, which
# predates the gpu-next/Dolby Vision behavior Izumi's output policy requires.
set -euo pipefail

readonly MPV_VERSION="0.41.0"
readonly MPV_REPO="https://github.com/mpv-player/mpv.git"

sudo apt-get update
sudo apt-get install -y \
  meson ninja-build pkg-config python3-docutils \
  libavcodec-dev libavdevice-dev libavfilter-dev libavformat-dev libavutil-dev \
  libswresample-dev libswscale-dev libass-dev libplacebo-dev libepoxy-dev \
  libx11-dev libxext-dev libxinerama-dev libxrandr-dev libxss-dev \
  libwayland-dev wayland-protocols libpulse-dev libvulkan-dev

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone --depth 1 --branch "v${MPV_VERSION}" "$MPV_REPO" "$work/mpv"
meson setup "$work/mpv/build" "$work/mpv" \
  --buildtype=release --prefix=/usr/local \
  -Dlibmpv=true -Dcplayer=false -Dtests=false -Dlua=disabled -Djavascript=disabled
meson compile -C "$work/mpv/build"
sudo meson install -C "$work/mpv/build"
sudo ldconfig

actual="$(pkg-config --modversion mpv)"
test "$actual" = "$MPV_VERSION" || {
  echo "Expected libmpv $MPV_VERSION, got $actual" >&2
  exit 1
}
