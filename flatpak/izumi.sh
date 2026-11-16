#!/bin/sh
# Flatpak entry. Chromium cannot use its own sandbox inside Flatpak, so zypak runs CEF's helper
# processes through flatpak-spawn sandboxes instead. libcef.so sits beside the binary.
export ZYPAK_CEF_LIBRARY_PATH=/app/lib/izumi/libcef.so
export LD_LIBRARY_PATH="/app/lib/izumi${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec zypak-wrapper /app/lib/izumi/izumi "$@"
