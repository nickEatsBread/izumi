#!/bin/sh
# Copies CEF's runtime files next to the izumi binary in $1. cef-dll-sys unpacks CEF into a
# `cef_linux_x86_64` directory (under CEF_PATH, its build OUT_DIR or a tool cache); take them from there rather
# than from its copy in the target directory. Only the en-US locale ships.
set -eu
dest=$1
lib=$(find -L src-tauri/target /run/ccache "${CEF_PATH:-/nonexistent}" "${XDG_CACHE_HOME:-$HOME/.cache}" -type f -name libcef.so -path '*/cef_linux_x86_64/*' 2>/dev/null | head -n 1)
if [ -z "$lib" ]; then
  echo "stage-cef: no unpacked CEF found" >&2
  exit 1
fi
src=$(dirname "$lib")
echo "stage-cef: CEF runtime from $src"
mkdir -p "$dest/locales"
for f in libcef.so libEGL.so libGLESv2.so libvk_swiftshader.so vk_swiftshader_icd.json libvulkan.so.1 \
  chrome_100_percent.pak chrome_200_percent.pak icudtl.dat resources.pak v8_context_snapshot.bin; do
  if [ -e "$src/$f" ]; then cp "$src/$f" "$dest/"; fi
done
cp "$src/locales/en-US.pak" "$dest/locales/"
strip --strip-unneeded "$dest/libcef.so"
