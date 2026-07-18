<h1 align="center">
  <img src="brand/svg/izumi-mark-color.svg" alt="izumi brand mark" width="96" />
  <br>
  <b>izumi</b>
</h1>

<!-- <h1 align="center"><b>izumi</b></h1> -->

<p align="center">
  <img width="100%" height="940" alt="README artwork" src="https://github.com/user-attachments/assets/665d0f1a-8360-4386-9d22-f9159fc1f1ac" />

  <!-- Add the cover photo here:
  <img src="path/to/izumi-cover.png" alt="izumi preview" width="100%" />
  -->
</p>

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
- **Settings** — interface (UI scale, episode layout), sources, extensions, network, accounts,
  downloads.

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

Release builds are available for Windows, Linux, Steam Deck, and
Android. Expect ongoing changes and the occasional rough edges. If you encounter any issues, please report them through GitHub Issues.

### Steam Deck

Install from the auto-updating Flatpak repo so the app can update itself in the background:

```sh
flatpak install --user https://flatpak.izumi.watch/com.nicho.izumi.flatpakref
```

Updates then download silently and apply the next time you launch izumi from Steam. The standalone `.flatpak` bundle attached to each release works too — it bakes in the same update origin, so a direct bundle install auto-updates the same way (the `.flatpakref` is just the simplest one-click install).

## License

[AGPL-3.0-or-later](LICENSE) © izumi contributors.

izumi embeds **libmpv** (mpv, **LGPL-2.1-or-later**) as a replaceable dynamic library. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
