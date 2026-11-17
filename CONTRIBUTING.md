# Contributing to izumi

Thanks for your interest. izumi is a Tauri (Rust) + SvelteKit desktop anime client.

## Dev setup

See the [README](README.md#prerequisites) for prerequisites (Node, Rust, libmpv).

```sh
npm install
npm ci --prefix cloudflare-sync-worker  # Worker runtime dependencies used by npm test
cp .env.example .env      # public OAuth client IDs
npm run dev:app           # run the desktop app (isolated from an installed release)
```

## Before you open a PR

```sh
npm run check   # svelte-check (types + a11y)
npm test        # vitest
cd src-tauri && cargo check
```

CI runs the same on every PR.

## Guidelines

- Match the surrounding code style — the codebase favours small, well-commented
  modules; comments explain *why*, not *what*.
- Keep PRs focused; one concern per PR.
- Never commit secrets: no debrid keys, no addon URLs that embed a token, no signing
  keys, no personal info.
- New user-facing strings and settings should be generic (no third-party brand names).

## Themes, plugins, sources and packs

This repository is the client. Themes, plugins, packaged sources and packs are published elsewhere:

- **Themes:** [izumi-themes](https://github.com/nickEatsBread/izumi-themes), following its
  [submission guide](https://github.com/nickEatsBread/izumi-themes#submitting-a-theme).
- **Plugins, sources and packs:** [izumi-plugins](https://github.com/nickEatsBread/izumi-plugins),
  following its README.

Changes to the theme API, the plugin format, the `.izumi-ext` package rules or the pack format start
here (see [docs/THEMES.md](docs/THEMES.md) and [docs/PLUGINS.md](docs/PLUGINS.md)); the two catalog
repositories copy those validators and follow.

## Licence

By contributing you agree your contributions are licensed under the project's
[GPL-3.0-or-later](LICENSE).
