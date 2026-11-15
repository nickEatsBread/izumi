#!/bin/sh
# Flatpak entry. Chromium cannot use its own sandbox inside Flatpak, so zypak runs CEF's helper
# processes through flatpak-spawn sandboxes instead.
export ZYPAK_CEF_LIBRARY_PATH=/app/lib/izumi/libcef.so
exec zypak-wrapper /app/lib/izumi/izumi "$@"
