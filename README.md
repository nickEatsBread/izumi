<div align="center">
  <a name="readme-top"></a>

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/svg/izumi-lockup-color-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="brand/svg/izumi-lockup-color-light.svg">
    <img src="brand/svg/izumi-lockup-color-light.svg" alt="izumi" width="320">
  </picture>

### Your anime, your library, your sources.

A native anime library manager for browsing, tracking, and playing from the sources you choose.

<!-- MANPAGE: BEGIN EXCLUDED SECTION -->
[![Windows](https://img.shields.io/badge/Windows-.exe-0078D6?style=for-the-badge)][exe]
[![Steam Deck](https://img.shields.io/badge/Steam%20Deck-.flatpak-1b2838?style=for-the-badge&logo=steamdeck&logoColor=white)][deck]
[![MacOS](https://img.shields.io/badge/macOS-.dmg-000000?style=for-the-badge&logo=apple&logoColor=white)][dmg]
[![Android](https://img.shields.io/badge/Android-.apk-3DDC84?style=for-the-badge&logo=android&logoColor=white)][apkf]
[![Source Tarball](https://img.shields.io/badge/-Source_tar-green.svg?style=for-the-badge)](https://github.com/nickEatsBread/izumi/releases/latest/download/izumi.tar.gz)
[![All versions](https://img.shields.io/badge/-All_Versions-lightgrey.svg?style=for-the-badge)](https://github.com/nickEatsBread/izumi/releases)
<!-- MANPAGE: END EXCLUDED SECTION -->

[Supported sources](#supported-sources) · [Features](#features) · [Get started](#get-started)
</div>

<br>

<p align="center">
  <img width="100%" alt="izumi app preview" src="https://github.com/user-attachments/assets/665d0f1a-8360-4386-9d22-f9159fc1f1ac" />
</p>

> [!IMPORTANT]
> This application **does not host, distribute, or provide media content**.
>
> izumi is intended solely as a **personal media library manager** for organizing, tracking, and playing content that you **legally own**. Users are responsible for ensuring that all media content used with this application has been **legally** obtained and that its use complies with all applicable **copyright laws**.

## Supported sources

- **Stremio add-ons** — add stream and subtitle add-ons by manifest URL and browse their results together in one source picker.
- **Aniyomi / Mihon-compatible extensions** — use supported anime-source extensions from the Tachiyomi ecosystem when distributed as verified `.izumi-ext` packages (desktop only).
- **Community extension formats** — load native izumi JavaScript providers, Miru video extensions, Seanime online-stream providers, and anime torrent providers from a GitHub repository, manifest, or package catalog.
- **Flexible playback** — play direct HTTP streams, resolve torrents through a supported debrid service, stream torrents with the built-in P2P engine, or watch files from your local library.
- **Tracking services** — connect AniList or MyAnimeList, with playback progress synced back to your account.

## Features

- **Browse** — weekly schedule, search with filters, rich detail pages (banner, description, trailer, relations, per-episode cards).
- **Tracking** — connect **AniList** or **MyAnimeList**, or set a
  read-only AniList username. Progress syncs back on playback.
- **Streaming** — add any Stremio stream addon or source extension. Results resolve
  through debrid services or direct HTTP streams and appear live in the source picker.
- **Native player** — libmpv embedded in the main window (single window, transparent overlay
  controls): custom seekbar with **on-demand scrub thumbnails**, chapter popouts, AniSkip
  OP/ED/recap skipping, AnimeThemes-aware first-play, audio/subtitle menus, video-fit toggle,
  screenshot, next/prev episode, full controller/d-pad navigation.
- **Offline** — download a resolved stream to disk and play it back locally.
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
