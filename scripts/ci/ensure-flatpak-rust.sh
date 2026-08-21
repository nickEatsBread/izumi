#!/usr/bin/env bash
# Install a rustc/cargo toolchain for the Flatpak izumi module.
#
# We used to take this from Flathub's org.freedesktop.Sdk.Extension.rust-stable. That
# extension 404s for hours whenever Flathubbot republishes it (seen 2026-08-21: pulling
# runtime/org.freedesktop.Sdk.Extension.rust-stable/x86_64/25.08 returned HTTP 404 and
# aborted both the v0.1.43 and v0.1.44-1 Deck bundles). rustup talks to static.rust-lang.org
# instead, so a Flathub extension outage cannot block the Steam Deck build.
set -euo pipefail

export CARGO_HOME="${CARGO_HOME:-${HOME:-/root}/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-${HOME:-/root}/.rustup}"
export PATH="$CARGO_HOME/bin:$PATH"

if command -v rustc >/dev/null 2>&1; then
  rustc -vV
  exit 0
fi

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
  sh -s -- -y --profile minimal --default-toolchain stable --no-modify-path
rustc -vV
