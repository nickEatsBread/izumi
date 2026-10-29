# Plugins, packs and stores

izumi installs nothing by default. Sources, themes and packs reach a device only when the user picks
them: from a store in **Settings → Store**, from a link pasted into **Sources** or **Add theme**, or
from a pack link.

## Stores

The Store browses every enabled store at once. Three are built in; the user can hide them but not
delete them, and none of them installs anything by itself:

| Store | Lists | Published from |
| --- | --- | --- |
| izumi packages | Packaged sources from the generated package catalog | `OFFICIAL_ANIME_CATALOG` |
| izumi themes | The theme catalog | [izumi-themes](https://github.com/nickEatsBread/izumi-themes) |
| izumi plugins | Reviewed plugins (packaged sources) and packs | [izumi-plugins](https://github.com/nickEatsBread/izumi-plugins) |

Users add their own stores with **Add store** or an `izumi://store/add?url=…` link. A store is a
native index (`app: "izumi"`, `kind: "store"`), a theme catalog, or one of the package catalog
formats; a native index may list sources, themes and packs. Stores are trusted on first use, or by
the Ed25519 key a store declares and signs its index with (`store.json.sig`).

## The plugin marketplace

Every listing in izumi-plugins pins one commit of its author's repository. The marketplace's CI
reads the author's store index or pack at that commit and checks every file it names: size and
SHA-256, the package rules of `src-tauri/src/extension_package.rs` (exact files, integrity, an
Ed25519 signature, the right platform), the same signing key as before, and a ClamAV scan. An hourly
job moves a pin to the newest commit of the listing's branch once that commit passes; a commit that
fails keeps the old pin and opens an issue there. Packs listed there are rewritten to install from
the marketplace itself, so a listed pack only installs listed, scanned entries.

izumi reads the result as an ordinary native store. Installed packages keep their origin store
(`src/lib/store/origins.ts`), so a package installed from the marketplace only ever updates from it.

## Packs in the Store

A store entry of kind `pack` carries the pack's `url`, `sha256` and `bytes`. Choosing **Set up**
opens the pack review screen (`/app/pack?url=…`, the same screen pack links and the Deck installer
open), which lists everything the pack will do before anything is applied. Packs set up on the
device show as installed, and are managed under **Settings → Sources**.

## Links

The existing paths stay as they are:

- **Sources → Add**: a manifest, repository or package catalog link.
- **Themes → Add theme**: a package, release descriptor, file or folder.
- **Pack links**: `izumi://pack?url=…`, the pack link field in **Settings → Sources**, and the Deck installer.
- **Store links**: `izumi://store/add?url=…` previews a store before adding it.

## Publishing

- Themes: the [izumi-themes submission guide](https://github.com/nickEatsBread/izumi-themes#submitting-a-theme).
- Plugins and packs: the [izumi-plugins submission guide](https://github.com/nickEatsBread/izumi-plugins#submitting-a-plugin-or-a-pack),
  which also covers building a plugin, building a pack, and running another marketplace.

Both repositories mirror rules from this one: the theme validator (`src/lib/themes/`), the package
installer (`src-tauri/src/extension_package.rs`) and the pack format (`src/lib/packs/format.ts`).
Change the rule here first, then the copy there.

## Implementation map

| Area | Location |
| --- | --- |
| Built-in and user stores | `src/lib/store/feeds.ts` (`BUILTIN_STORES`, `PLUGIN_STORE_URL`) |
| Native store index (sources, themes, packs, per-platform builds) | `src/lib/store/native-format.ts` |
| Store loading, signatures and trust | `src/lib/store/load.ts`, `src/lib/store/trust.ts`, `src-tauri/src/store_trust.rs` |
| Installing an entry (packs hand off to their review screen) | `src/lib/store/install.ts` |
| Package origins | `src/lib/store/origins.ts` |
| Pack format, review and setup | `src/lib/packs/`, `src/lib/components/packs/PackFlow.svelte`, `src/routes/app/pack/` |
| Package installer and local services | `src-tauri/src/extension_package.rs`, `src-tauri/src/extension_service.rs` |
| Store page | `src/routes/app/settings/store/+page.svelte` |
