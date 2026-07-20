<h1 align="center">
  <img src="brand/svg/izumi-mark-color.svg" alt="izumi brand mark" width="96" />
  <br>
  <b>izumi</b>
</h1>

<!-- <h1 align="center"><b>izumi</b></h1> -->

<p align="center">
  <img width="100%" height="940" alt="README artwork" src="https://github.com/user-attachments/assets/665d0f1a-8360-4386-9d22-f9159fc1f1ac" />
</p>

<!-- MANPAGE: BEGIN EXCLUDED SECTION -->
[![Windows](https://img.shields.io/badge/Windows-.exe-0078D6?style=for-the-badge)][exe]
[![Steam Deck](https://img.shields.io/badge/Steam%20Deck-.flatpak-1b2838?style=for-the-badge&logo=steamdeck&logoColor=white)][deck]
[![MacOS](https://img.shields.io/badge/macOS-.dmg-000000?style=for-the-badge&logo=apple&logoColor=white)][dmg]
[![Source Tarball](https://img.shields.io/badge/-Source_tar-green.svg?style=for-the-badge)](https://github.com/nickEatsBread/izumi/releases/latest/download/izumi.tar.gz)
[![All versions](https://img.shields.io/badge/-All_Versions-lightgrey.svg?style=for-the-badge)](https://github.com/nickEatsBread/izumi/releases)
<!-- MANPAGE: END EXCLUDED SECTION -->

izumi is a **personal media library manager** for organizing, tracking, and playing anime allowing you to add your own sources, and stream.

> [!IMPORTANT]
> This application **does not host, distribute, or provide media content**.
>
> izumi is intended solely as a **personal media library manager** for organizing, tracking, and playing content that you **legally own**. Users are responsible for ensuring that all media content used with this application has been **legally** obtained and that its use complies with all applicable **copyright laws**.

## Features

- **Browse** — weekly schedule, search with filters, rich detail pages (banner, description, trailer, relations, per-episode cards).
- **Tracking** — connect **AniList** or **MyAnimeList**, or set a
  read-only AniList username. Progress syncs back on playback.
- **Streaming** — add any Stremio stream addon and/or source extensions.
  Results resolve through debrid services and appear live in a source picker as each
  provider responds.
- **Native player** — libmpv embedded in the main window (single window, transparent overlay
  controls): custom seekbar with **on-demand scrub thumbnails**, chapter popouts, AniSkip
  OP/ED/recap skipping, AnimeThemes-aware first-play, audio/subtitle menus, video-fit toggle,
  screenshot, next/prev episode, full controller/d-pad navigation.
- **Offline** — download a resolved stream to disk and play it back locally.
- **Local library** — recursively scan existing video folders, infer season/episode numbers,
  match titles through AniList, and manually correct uncertain matches.
- **Automatic downloads** — follow a show and collect aired episodes using per-series quality,
  audio, codec, cache, delay, and starting-episode rules.
- **Watch Together** — host or join synchronized playback rooms across paired Izumi devices;
  every participant resolves their own source while the host controls play, pause, and seeking.
- **Settings** — interface (UI scale, episode layout), sources, extensions, network, accounts,
  downloads.

## Get started
izumi will notify you of updates to keep izumi up-to-date. Grab your platform below, or browse all files on the [**Releases**](https://github.com/nickEatsBread/izumi/releases/latest) page.

| Windows | macOS | Linux | Android | Steam Deck |
|---|---|---|---|---|
| [`.exe`][exe] | [`.dmg`][dmg] | [`.AppImage`][app] | [`.apk` full][apkf] | [`.flatpakref`][deck] |
| [`.msi`][msi] | | [`.deb`][deb] [`.rpm`][rpm] | [`.apk` lite][apkl] | |

Android **full** includes an embedded player; **lite** hands off this to an external app. The non-AppImage/Flatpak Linux builds need your distro's `libmpv` (`mpv` / `libmpv-dev`).

> [!WARNING]
> On Windows, you may need to do the following to run the install after open: SmartScreen → **More info → Run anyway**.

[exe]: https://github.com/nickEatsBread/izumi/releases/latest/download/izumi-x64-setup.exe
[msi]: https://github.com/nickEatsBread/izumi/releases/latest/download/izumi-x64.msi
[dmg]: https://github.com/nickEatsBread/izumi/releases/latest/download/izumi-aarch64.dmg
[app]: https://github.com/nickEatsBread/izumi/releases/latest/download/izumi-x86_64.AppImage
[deb]: https://github.com/nickEatsBread/izumi/releases/latest/download/izumi-amd64.deb
[rpm]: https://github.com/nickEatsBread/izumi/releases/latest/download/izumi-x86_64.rpm
[apkf]: https://github.com/nickEatsBread/izumi/releases/latest/download/izumi-android-full.apk
[apkl]: https://github.com/nickEatsBread/izumi/releases/latest/download/izumi-android-lite.apk
[deck]: https://flatpak.izumi.watch/com.nicho.izumi.flatpakref

## Prerequisites

- **Node.js** 18+ and **npm**
- **Rust** (stable) + the [Tauri v2 system prerequisites](https://tauri.app/start/prerequisites/)
- **libmpv** available to the Rust linker
  - **Windows:** provide `mpv.lib` (generate it from a `libmpv-2.dll` import) and ensure
    `libmpv-2.dll` is on `PATH` / next to the binary at runtime.
  - **Linux / Steam Deck:** install the distro `mpv` / `libmpv-dev` package.

## Setup

```sh
npm install
npm run tauri dev
npm run dev
```

## Build

```sh
npm run tauri build 
```

## Status

Release builds for Windows, macOS, Linux, Steam Deck, and Android are on the [Releases](https://github.com/nickEatsBread/izumi/releases/latest) page (see [Get started](#get-started)). Expect ongoing changes and the occasional rough edges — please report issues through GitHub Issues.

## License

[AGPL-3.0-or-later](LICENSE) © izumi contributors.

izumi embeds **libmpv** (mpv, **LGPL-2.1-or-later**) as a replaceable dynamic library. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
