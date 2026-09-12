#!/usr/bin/env bash
# izumi installer for Steam Deck / SteamOS, and for any Linux desktop with Flatpak.
#
# Published at https://flatpak.izumi.watch/install.sh and launched by izumi-installer.desktop.
# Equivalent manual invocations:
#
#   curl -fsSL https://flatpak.izumi.watch/install.sh | bash
#   curl -fsSL https://flatpak.izumi.watch/install.sh | bash -s -- --beta
#
# Why this exists: SteamOS routes .flatpakref through Discover, and Discover cannot follow an ostree
# repository redirect or add a remote that carries its own GPG key. It opens, fails with no visible
# error and closes again, which reads as "the file does nothing". Everything below is what Discover
# would have done, driven through the flatpak CLI, which handles both cases correctly.
set -euo pipefail

CHANNEL=stable
ASSUME_YES=0
SKIP_STEAM=0
for argument in "$@"; do
  case "$argument" in
    --beta) CHANNEL=beta ;;
    --stable) CHANNEL=stable ;;
    # Unattended installs (CI, a kiosk image): take the app, never touch the Steam library.
    --yes|-y) ASSUME_YES=1 ;;
    --no-steam) SKIP_STEAM=1 ;;
    --help|-h) printf 'usage: install.sh [--beta] [--yes] [--no-steam]\n'; exit 0 ;;
    *) printf 'izumi: unknown option %s\n' "$argument" >&2; exit 2 ;;
  esac
done

SITE=https://flatpak.izumi.watch
REF_URL="$SITE/$CHANNEL/com.nicho.izumi.flatpakref"
ART_URL="$SITE/steamgrid"
APP_ID=com.nicho.izumi
VARIANTS='flat bold bright solid mark-only light'

say() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\n\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ prerequisites

if ! command -v flatpak >/dev/null 2>&1; then
  die "Flatpak is not installed.
On SteamOS it ships with the system, so this usually means the script is running somewhere else.
Install it through your package manager (apt/dnf/pacman install flatpak) and run this again."
fi
command -v curl >/dev/null 2>&1 || die 'curl is required to download the installer payloads.'

# ------------------------------------------------------------------ install the app

# User scope, always. SteamOS keeps / read-only and replaces it wholesale on every OS update, so a
# --system install needs a sudo password the Deck may not even have set, and then disappears on the
# next update. A --user install lives under ~/.local/share/flatpak and survives both.
say 'Making sure Flathub is available (the GNOME runtime comes from there)'
# Every flatpak call reads from /dev/null. Under `curl … | bash` THIS SCRIPT is bash's stdin, and a
# child that reads stdin consumes the script text bash has not parsed yet: bash then reaches an
# unexpected end of input and exits quietly, mid-run. That is precisely how the Steam question
# disappeared after a first install while a second run — which takes the update path instead —
# still asked it.
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo </dev/null \
  || warn 'could not add Flathub — continuing, since the .flatpakref names its own runtime repo'

if flatpak info --user "$APP_ID" >/dev/null 2>&1 </dev/null; then
  say "izumi is already installed — updating to the latest $CHANNEL build"
  flatpak update --user --assumeyes "$APP_ID" </dev/null
else
  say "Installing izumi ($CHANNEL)"
  flatpak install --user --assumeyes --from "$REF_URL" </dev/null
fi

flatpak info --user "$APP_ID" >/dev/null 2>&1 </dev/null \
  || die 'the install command finished but izumi is not present.'
say "izumi is installed. Launch it from the applications menu, or with: flatpak run $APP_ID"

# ------------------------------------------------------------------ Steam integration

steam_user_dirs() {
  local base
  for base in "$HOME/.local/share/Steam" "$HOME/.steam/steam" "$HOME/.steam/root" \
              "$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam"; do
    [ -d "$base/userdata" ] || continue
    # A real account directory is its numeric Steam id. `anonymous` and `0` are not accounts.
    find "$base/userdata" -mindepth 1 -maxdepth 1 -type d -regex '.*/[1-9][0-9]*' 2>/dev/null || true
  done | sort -u
}

USER_DIRS="$(steam_user_dirs)"

if [ "$SKIP_STEAM" = 1 ] || [ "$ASSUME_YES" = 1 ]; then
  exit 0
fi
if [ -z "$USER_DIRS" ]; then
  say 'No Steam installation found — skipping the Steam library step.'
  exit 0
fi
if ! command -v python3 >/dev/null 2>&1; then
  warn 'python3 is missing, so the Steam library entry was skipped. izumi itself is installed.'
  exit 0
fi

# kdialog on the Deck (Plasma), zenity on GNOME, plain prompts over SSH or on a bare TTY.
# Written as `if` blocks rather than `cmd && VAR=x`: under `set -e` a false one-line AND list is
# itself a failing command, so the missing-tool case would abort the whole installer.
DIALOG=none
if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  if command -v zenity >/dev/null 2>&1; then DIALOG=zenity; fi
  if command -v kdialog >/dev/null 2>&1; then DIALOG=kdialog; fi
fi

prompt_line() {
  # Reading the answer from the controlling terminal, because stdin is the piped script itself.
  local answer=''
  if [ -r /dev/tty ]; then
    read -r -p "$1" answer </dev/tty || true
  fi
  printf '%s\n' "$answer"
}

STEAM_QUESTION='Add izumi to your Steam library?

It is added as a non-Steam game with izumi artwork, so it can be launched from Game Mode.'

# Prints one of: default / choose / no.
ask_steam() {
  local status=0 answer=''
  case "$DIALOG" in
    kdialog)
      # One dialog, three buttons. Cancel is the third answer rather than an abort: dismissing it
      # must still leave a working installation behind.
      kdialog --title izumi --yesnocancel "$STEAM_QUESTION" \
        --yes-label 'Add to Steam' \
        --no-label 'Add — let me pick the artwork' \
        --cancel-label 'Skip' >/dev/null 2>&1 || status=$?
      case "$status" in 0) printf 'default\n' ;; 1) printf 'choose\n' ;; *) printf 'no\n' ;; esac ;;
    zenity)
      # zenity has no three-button question, so the same three answers become a one-choice list.
      answer="$(zenity --list --radiolist --title izumi --width 480 --height 280 \
        --text "$STEAM_QUESTION" --print-column 3 --hide-column 3 \
        --column '' --column 'Choice' --column 'id' \
        TRUE 'Add to Steam with izumi artwork' default \
        FALSE 'Add to Steam, and let me pick the artwork' choose \
        FALSE 'Do not add it to Steam' no 2>/dev/null)" || answer=no
      printf '%s\n' "${answer:-no}" ;;
    *)
      printf '\nAdd izumi to your Steam library?\n  1) yes, with izumi artwork\n  2) yes, and let me pick the artwork\n  3) no\n' >&2
      case "$(prompt_line 'Choice [1]: ')" in
        2) printf 'choose\n' ;;
        3) printf 'no\n' ;;
        *) printf 'default\n' ;;
      esac ;;
  esac
}

VARIANT_ROWS=(
  flat 'Whirlpool + wordmark on dark water (default)'
  bold 'Oversized whirlpool, punchy in a grid'
  bright 'Full brand gradient, high visibility'
  solid 'Flat indigo, ultra-minimal'
  mark-only 'Whirlpool only, no wordmark'
  light 'White background, bright outlier'
)

ask_variant() {
  local answer=''
  case "$DIALOG" in
    kdialog) answer="$(kdialog --title 'izumi artwork' --menu 'Which cover set?' "${VARIANT_ROWS[@]}" 2>/dev/null)" || answer='' ;;
    zenity) answer="$(zenity --list --title 'izumi artwork' --width 480 --height 320 \
      --text 'Which cover set?' --column 'Variant' --column 'Look' "${VARIANT_ROWS[@]}" 2>/dev/null)" || answer='' ;;
    *)
      printf '\nArtwork variants: %s\n' "$VARIANTS" >&2
      answer="$(prompt_line 'Variant [flat]: ')" ;;
  esac
  printf '%s\n' "${answer:-flat}"
}

notify() {
  case "$DIALOG" in
    kdialog) kdialog --title izumi --msgbox "$1" >/dev/null 2>&1 || true ;;
    zenity) zenity --info --title izumi --text "$1" >/dev/null 2>&1 || true ;;
    *) printf '\n%s\n' "$1" ;;
  esac
}

confirm() {
  case "$DIALOG" in
    kdialog) kdialog --title izumi --yesno "$1" >/dev/null 2>&1 ;;
    zenity) zenity --question --title izumi --text "$1" >/dev/null 2>&1 ;;
    *) case "$(prompt_line "$1 [y/N]: ")" in [yY]*) return 0 ;; *) return 1 ;; esac ;;
  esac
}

ANSWER="$(ask_steam)"
if [ "$ANSWER" != default ] && [ "$ANSWER" != choose ]; then
  say 'Skipping the Steam library entry.'
  exit 0
fi

VARIANT=flat
if [ "$ANSWER" = choose ]; then
  VARIANT="$(ask_variant)"
  case " $VARIANTS " in
    *" $VARIANT "*) ;;
    *) VARIANT=flat ;;
  esac
fi

# Steam keeps the shortcut list in memory and rewrites shortcuts.vdf when it exits, so an entry
# written underneath a running client is silently discarded the next time the user quits.
if pgrep -x steam >/dev/null 2>&1; then
  if confirm 'Steam has to be closed before izumi can be added to your library.

Close Steam now?'; then
    steam -shutdown >/dev/null 2>&1 || pkill -TERM -x steam || true
    for _ in $(seq 1 40); do
      pgrep -x steam >/dev/null 2>&1 || break
      sleep 1
    done
    if pgrep -x steam >/dev/null 2>&1; then
      notify 'Steam is still running, so the library entry was skipped. izumi itself is installed — run the installer again once Steam is closed.'
      exit 0
    fi
  else
    notify 'Skipped the Steam library entry. izumi is installed; run the installer again with Steam closed to add it.'
    exit 0
  fi
fi

ART_DIR="$(mktemp -d)"
trap 'rm -rf "$ART_DIR"' EXIT

say "Fetching the $VARIANT artwork"
fetch_art() {
  curl -fsSL --retry 2 -o "$ART_DIR/$2" "$1" || warn "could not download $(basename "$1")"
}
# Portrait capsule, landscape capsule, hero and logo: the four slots Steam and Game Mode render for
# a non-Steam shortcut. A failed download is not fatal — the entry is worth more than its cover.
#
# The capsules carry the chosen variant, because a capsule IS the cover. The hero does not: Steam
# paints the logo slot on top of it, so a hero containing the wordmark — which every SteamGridDB
# variant does — ends up as a logo sitting on a logo. The hero is a plain backdrop for all six, and
# the white wordmark is what goes over it.
fetch_art "$ART_URL/$VARIANT/izumi-capsule-600x900.png" portrait.png
fetch_art "$ART_URL/$VARIANT/izumi-capsule-920x430.png" landscape.png
fetch_art "$ART_URL/hero/izumi-hero-plain-1920x620.png" hero.png
fetch_art "$ART_URL/logo/izumi-logo-horizontal-white@2x.png" logo.png

ICON=''
for size in 256x256 128x128 512x512 64x64; do
  candidate="$HOME/.local/share/flatpak/exports/share/icons/hicolor/$size/apps/$APP_ID.png"
  if [ -f "$candidate" ]; then
    ICON="$candidate"
    break
  fi
done

say 'Adding izumi to your Steam library'
IZUMI_ART_DIR="$ART_DIR" IZUMI_ICON="$ICON" IZUMI_USER_DIRS="$USER_DIRS" \
  python3 - <<'PYTHON'
import os
import shutil
import struct
import sys
import time
import zlib

APP_NAME = "izumi"
# Steam stores Exe quoted, and derives a shortcut's id from that quoted form, so the quotes are part
# of the hashed string. Keeping them means the id written here matches the one Steam would choose.
EXE = '"/usr/bin/flatpak"'
START_DIR = '"/usr/bin/"'
LAUNCH_OPTIONS = "run com.nicho.izumi"
APP_ID = "com.nicho.izumi"

art_dir = os.environ.get("IZUMI_ART_DIR", "")
icon = os.environ.get("IZUMI_ICON", "")
user_dirs = [line.strip() for line in os.environ.get("IZUMI_USER_DIRS", "").splitlines() if line.strip()]


def shortcut_appid():
    """A non-Steam shortcut id: CRC32 of Exe+AppName with the top bit set.

    Steam honours the id stored in shortcuts.vdf rather than recomputing it, which is what lets the
    artwork be named correctly before Steam has ever seen the entry.
    """
    return zlib.crc32((EXE + APP_NAME).encode("utf-8")) | 0x80000000


def parse(buf, index=0):
    """Binary VDF -> dict. 0x00 map, 0x01 string, 0x02 int32, 0x08 end of map."""
    out = {}
    while index < len(buf):
        marker = buf[index]
        index += 1
        if marker == 0x08:
            return out, index
        end = buf.index(b"\x00", index)
        key = buf[index:end].decode("utf-8", "replace")
        index = end + 1
        if marker == 0x00:
            value, index = parse(buf, index)
        elif marker == 0x01:
            end = buf.index(b"\x00", index)
            value = buf[index:end].decode("utf-8", "replace")
            index = end + 1
        elif marker == 0x02:
            value = struct.unpack_from("<I", buf, index)[0]
            index += 4
        else:
            raise ValueError("unsupported VDF marker 0x%02x" % marker)
        out[key] = value
    return out, index


def serialize(mapping):
    out = bytearray()
    for key, value in mapping.items():
        name = key.encode("utf-8") + b"\x00"
        if isinstance(value, dict):
            out += b"\x00" + name + serialize(value) + b"\x08"
        elif isinstance(value, int):
            out += b"\x02" + name + struct.pack("<I", value & 0xFFFFFFFF)
        else:
            out += b"\x01" + name + str(value).encode("utf-8") + b"\x00"
    return bytes(out)


def entry(appid, last_play_time=0):
    return {
        "appid": appid,
        "AppName": APP_NAME,
        "Exe": EXE,
        "StartDir": START_DIR,
        "icon": icon,
        "ShortcutPath": "",
        "LaunchOptions": LAUNCH_OPTIONS,
        "IsHidden": 0,
        "AllowDesktopConfig": 1,
        "AllowOverlay": 1,
        "OpenVR": 0,
        "Devkit": 0,
        "DevkitGameID": "",
        "DevkitOverrideAppID": 0,
        "LastPlayTime": last_play_time,
        "FlatpakAppID": APP_ID,
        "tags": {},
    }


def is_izumi(existing):
    """An entry this installer — or the user — already made for izumi."""
    return existing.get("AppName") == APP_NAME or APP_ID in str(existing.get("LaunchOptions", ""))


def install_art(config_dir, appid):
    if not art_dir:
        return
    grid = os.path.join(config_dir, "grid")
    os.makedirs(grid, exist_ok=True)
    for source, target in (
        ("portrait.png", "%dp.png" % appid),
        ("landscape.png", "%d.png" % appid),
        ("hero.png", "%d_hero.png" % appid),
        ("logo.png", "%d_logo.png" % appid),
    ):
        path = os.path.join(art_dir, source)
        if os.path.isfile(path):
            shutil.copyfile(path, os.path.join(grid, target))


def write_shortcut(config_dir):
    path = os.path.join(config_dir, "shortcuts.vdf")
    root = {}
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        with open(path, "rb") as handle:
            raw = handle.read()
        try:
            root, _ = parse(raw)
        except (ValueError, IndexError) as error:
            # A file that will not parse is never rewritten: Steam deletes a malformed
            # shortcuts.vdf outright, which would take every other non-Steam game with it.
            print("izumi: leaving %s untouched (%s)" % (path, error), file=sys.stderr)
            return None
        shutil.copyfile(path, "%s.izumi-backup-%d" % (path, int(time.time())))

    shortcuts = root.get("shortcuts")
    if not isinstance(shortcuts, dict):
        shortcuts = {}

    appid = shortcut_appid()
    existing = next((key for key, value in shortcuts.items()
                     if isinstance(value, dict) and is_izumi(value)), None)
    if existing is not None:
        # Reuse the id already on disk so playtime, the controller layout bound to it and any
        # artwork the user picked themselves all survive a re-run of this installer.
        previous = shortcuts[existing]
        appid = previous.get("appid") or appid
        shortcuts[existing] = entry(appid, previous.get("LastPlayTime", 0))
    else:
        index = str(max((int(key) for key in shortcuts if key.isdigit()), default=-1) + 1)
        shortcuts[index] = entry(appid)

    payload = b"\x00shortcuts\x00" + serialize(shortcuts) + b"\x08" + b"\x08"
    temporary = path + ".izumi-tmp"
    with open(temporary, "wb") as handle:
        handle.write(payload)
    os.replace(temporary, path)
    return appid


written = 0
for directory in user_dirs:
    config_dir = os.path.join(directory, "config")
    os.makedirs(config_dir, exist_ok=True)
    identifier = write_shortcut(config_dir)
    if identifier is None:
        continue
    install_art(config_dir, identifier)
    written += 1

if not written:
    sys.exit("izumi: no Steam account directory could be updated.")
print("izumi: added to %d Steam account(s)." % written)
PYTHON

notify 'izumi has been added to your Steam library.

Open Steam and look under Library, or switch to Game Mode. If it is not listed yet, fully close Steam once and reopen it.'
say 'Done.'
