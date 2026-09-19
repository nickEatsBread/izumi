# Repository boundaries

- This repository contains the desktop/mobile izumi client and its Cloudflare Worker.
- The Samsung Tizen TV application is maintained in the separate sibling repository
  (`izumiCompanion`, checked out next to this one as `../izumiCompanion`).
- Do not recreate or edit a `tizen-companion/` directory in this repository. When a protocol change
  affects both clients, make the TV-side change in the standalone repository and commit each
  repository independently.
- Build and physical-TV deployment instructions live in the standalone repository's `AGENTS.md`.

# Documentation

- Put research, audit, and implementation notes in `docs/`, not the repository root.
- Keep repository entry points and policies (README, CONTRIBUTING, RELEASING, AGENTS, and third-party notices) in the root.

# Source wording

- Use generic source wording in new repository text, user-facing errors, release notes,
  and commit messages. Do not name upstream stream sources or include their endpoints.
