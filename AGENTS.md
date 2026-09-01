# Repository boundaries

- This repository contains the desktop/mobile izumi client and its Cloudflare Worker.
- The Samsung Tizen TV application is maintained in the separate sibling repository at
  `C:\Users\Student\Documents\Coding projects\Testing\izumiCompanion`.
- Do not recreate or edit a `tizen-companion/` directory in this repository. When a protocol change
  affects both clients, make the TV-side change in the standalone repository and commit each
  repository independently.
- Build and physical-TV deployment instructions live in the standalone repository's `AGENTS.md`.
