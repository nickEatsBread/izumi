#!/usr/bin/env bash
# Pre-install the GNOME 49 SDK/runtime and the node SDK extension with retries.
#
# flatpak-builder --install-deps-from=flathub is a single shot: a 404 while Flathub is
# republishing an ostree ref aborts the whole Deck job. Installing first, with backoff,
# lets a transient CDN hole recover without restarting a 20-minute compile.
set -euo pipefail

MAX_ATTEMPTS="${FLATPAK_SDK_INSTALL_ATTEMPTS:-8}"

install_ref() {
  local ref="$1"
  local attempt=1
  local delay=20
  while true; do
    if flatpak --user install -y --noninteractive flathub "$ref"; then
      return 0
    fi
    if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
      echo "failed to install $ref after $attempt attempts" >&2
      return 1
    fi
    echo "flathub install $ref failed (attempt $attempt/${MAX_ATTEMPTS}); retrying in ${delay}s"
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay + 20))
  done
}

# GNOME 49 is the runtime pinned in flatpak/com.nicho.izumi.yml. Its Freedesktop base is 25.08,
# which is the branch node22 must match. Rust is bootstrapped inside the izumi module instead
# of org.freedesktop.Sdk.Extension.rust-stable (that ref 404'd on 2026-08-21).
install_ref org.gnome.Sdk//49
install_ref org.gnome.Platform//49
install_ref org.freedesktop.Sdk.Extension.node22//25.08
