# Contributing to izumi

Thanks for your interest. izumi is a Tauri (Rust) + SvelteKit desktop anime client.

## Dev setup

See the [README](README.md#prerequisites) for prerequisites (Node, Rust, libmpv).

```sh
npm install
cp .env.example .env      # public OAuth client IDs
npm run tauri dev         # run the desktop app
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

## Licence

By contributing you agree your contributions are licensed under the project's
[AGPL-3.0-or-later](LICENSE).
