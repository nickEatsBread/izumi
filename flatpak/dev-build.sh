#!/usr/bin/env bash
# Build a DEBUG Flatpak of izumi with the WebKit inspector (devtools) ENABLED, so the
# webview console + network can be inspected on-device (right-click -> Inspect Element).
#
# Prod builds (com.nicho.izumi.yml) NEVER ship devtools. This script injects the feature
# into a throwaway copy of the manifest so the committed one stays clean — that's how we
# keep the inspector out of release builds.
#
# Run on a Linux box (or WSL) with flatpak-builder + the GNOME runtime/SDK installed:
#   flatpak/dev-build.sh
#   flatpak install --user -y --reinstall izumi-devel.flatpak
set -euo pipefail
cd "$(dirname "$0")"

tmp="$(mktemp --suffix=.yml)"
trap 'rm -f "$tmp"' EXIT

# Add --features devtools to the tauri build line ONLY.
sed 's/tauri build -- --no-bundle$/tauri build -- --no-bundle --features devtools/' \
  com.nicho.izumi.yml > "$tmp"

repo="${IZUMI_REPO:-$HOME/izrepo}"
flatpak-builder --user --force-clean --repo="$repo" "$HOME/izbuild" "$tmp"
flatpak build-bundle "$repo" izumi-devel.flatpak com.nicho.izumi \
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo

echo "built: izumi-devel.flatpak (devtools ENABLED — DEV ONLY, do not distribute)"
