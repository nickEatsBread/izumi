#!/usr/bin/env bash
# Fail a build if an APK cannot load on a 16 KiB Android kernel.
# Checks both layers Android requires: ZIP entry alignment and every ELF LOAD segment.
set -euo pipefail

APK="${1:?usage: verify-android-native.sh <apk> <zipalign> <llvm-readelf>}"
ZIPALIGN="${2:?usage: verify-android-native.sh <apk> <zipalign> <llvm-readelf>}"
READELF="${3:?usage: verify-android-native.sh <apk> <zipalign> <llvm-readelf>}"

test -s "$APK" || { echo "APK not found: $APK"; exit 1; }
test -x "$ZIPALIGN" || { echo "zipalign not executable: $ZIPALIGN"; exit 1; }
test -x "$READELF" || { echo "llvm-readelf not executable: $READELF"; exit 1; }

# Uncompressed .so entries must begin on 16 KiB ZIP offsets. `-p` only checks 4 KiB and is
# deprecated; it let otherwise-correct ELF files ship in an APK Android 15 cannot mmap directly.
"$ZIPALIGN" -c -P 16 -v 4 "$APK"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -q "$APK" 'lib/*/*.so' -d "$TMP"

mapfile -d '' SO_FILES < <(find "$TMP/lib" -type f -name '*.so' -print0)
((${#SO_FILES[@]} > 0)) || { echo "APK contains no native libraries"; exit 1; }

bad=0
for so in "${SO_FILES[@]}"; do
  if ! headers="$("$READELF" -lW "$so")"; then
    echo "Could not read ELF headers: ${so#"$TMP/"}"
    bad=1
    continue
  fi
  mapfile -t alignments < <(awk '$1 == "LOAD" { print $NF }' <<<"$headers")
  if ((${#alignments[@]} == 0)); then
    echo "No ELF LOAD segments found: ${so#"$TMP/"}"
    bad=1
    continue
  fi
  for alignment in "${alignments[@]}"; do
    # Bash arithmetic accepts readelf's 0x-prefixed alignment value.
    if ((alignment < 0x4000)); then
      echo "16 KiB ELF alignment failed: ${so#"$TMP/"} has LOAD alignment $alignment"
      bad=1
    fi
  done
done

((bad == 0)) || exit 1
echo "16 KiB native-library check passed (${#SO_FILES[@]} shared libraries)"
