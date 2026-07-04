<p align="center">
  <img src="static/brand/izumi-mark-color.svg" width="112" alt="izumi" />
</p>

<h1 align="center">izumi</h1>

<p align="center">
  A controller-first anime client — native mpv playback,
  Stremio-addon support, and AniList/MAL tracking.
</p>

---

izumi is a **personal media library manager** for organizing, tracking, and playing anime allowing you to add your own sources, and stream.

> [!IMPORTANT]
> This application **does not host, distribute, or provide media content**.
>
> izumi is intended solely as a **personal media library manager** for organizing, tracking, and playing content that you **legally own**. Users are responsible for ensuring that all media content used with this application has been **legally** obtained and that its use complies with all applicable **copyright laws**.

<p align="center">
  <!-- <img src="screenshots/home.png" width="880" alt="izumi home screen" /> -->
</p>

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

Early development (`0.1.0`). The Windows desktop build is the working baseline; Linux / Steam
Deck (Gaming Mode) is the primary target.

## License

[AGPL-3.0-or-later](LICENSE) © izumi contributors.

izumi embeds **libmpv** (mpv, **LGPL-2.1-or-later**) as a replaceable dynamic library —
compatible with the AGPL. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
