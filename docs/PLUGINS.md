# Plugins, sources, packs and stores

izumi installs nothing by default. Plugins, sources, themes and packs reach a device only when the
user picks them: from a store, from a link, from files, or from a pack link.

- **Plugins** add features. Each is a `plugin.json` and one JavaScript module that runs in izumi's
  plugin sandbox (beta, off by default), with only the permissions the user approved. Jump to a
  moment is one.
- **Sources** find titles, episodes and streams: Stremio addons, remote extensions, and packages
  (signed `.izumi-ext` files).
- **Packs** set izumi up with sources, a theme and a startup video in one link.

## Stores

Every store uses one format: a native index (`app: "izumi"`, `kind: "store"`, `schemaVersion: 1`)
whose entries say their `kind`. The same index may list sources, themes, plugins and packs. Theme
catalogs and the package catalog formats are read as stores too.

Three stores are built in. The user can hide them but not remove them, and none of them installs
anything by itself:

| Store | Lists | Published from |
| --- | --- | --- |
| izumi packages | Packaged sources from the generated package catalog | `OFFICIAL_ANIME_CATALOG` |
| izumi themes | The theme catalog | [izumi-themes](https://github.com/nickEatsBread/izumi-themes) |
| izumi plugins | Reviewed plugins, packaged sources and packs | [izumi-plugins](https://github.com/nickEatsBread/izumi-plugins) |

Users add their own stores with **Stores** on the Plugins or Themes page, **Add store** in the Store,
or an `izumi://store/add?url=…` link. One list of stores serves all three pages: a store added on the
Plugins page shows its themes on the Themes page, and the other way round. Stores are trusted on first
use, or by the Ed25519 key a store declares and signs its index with (`store.json.sig`).

## Plugins in a store

A plugin entry pins its `plugin.json`, which pins its code:

```json
{
  "kind": "plugin",
  "id": "watch.izumi.jump-to-moment",
  "name": "Jump to a moment",
  "version": "1.0.0",
  "author": "Izumi",
  "description": "Describe a scene and the player jumps to it.",
  "pluginApi": 1,
  "url": "https://raw.githubusercontent.com/<owner>/<repo>/<commit>/<folder>/plugin.json",
  "sha256": "<SHA-256 of plugin.json>",
  "bytes": 1234
}
```

`url` is https and `bytes` at most 64 KB. izumi runs plugin APIs 1 and 2; an entry for a newer one
stays listed, and its page says it needs a newer izumi.

**Settings → Sources and store → Plugins (beta)** lists them like the Themes page lists themes:
Installed first, then one section per store, with chips and search. A card opens the plugin's page
(`?store=<store id>&plugin=<id>`). Opening it downloads `plugin.json`, refuses it unless its size and
SHA-256 match the listing and its id and version match the entry, then downloads the main file and
refuses it unless it matches the hash in `plugin.json`. The page lists what the plugin will be able
to do; **Install** is the consent. An install records the store's URL as its origin, so it only
updates from that store, and a plugin installed from one place can't be replaced from another until
it is removed. When the store lists a newer version, the card says **Update**, and the page says so
when the new version asks for different permissions.

**Add plugin** still takes an https `plugin.json` link, or (for authors) `plugin.json` and its main
file from disk. The Store page lists plugins too and sends **View** to the plugin's page.

## The marketplace

Every listing in izumi-plugins pins one commit of its author's repository. Its CI reads what the
listing names at that commit and checks it:

- **Plugins:** `plugin.json` against the rules of `src/lib/plugins/manifest.ts`, and the main file
  against the hash it pins.
- **Sources:** every package against `src-tauri/src/extension_package.rs` (exact files, integrity,
  an Ed25519 signature, the right platform) and the signing key recorded before.
- **Packs:** rewritten to install only from the marketplace itself (or the theme catalog).

Everything is scanned with ClamAV. An hourly job moves a pin once a newer commit passes the same
checks; a commit that fails keeps the old pin and opens an issue there. A plugin's pin follows the
newest commit that changed its own folder, and an update asking for different permissions is held
for a maintainer. izumi's own plugins live in that repository's `official/` folder and are listed the
same way.

## Packs in the Store

A store entry of kind `pack` carries the pack's `url`, `sha256` and `bytes`. **Set up** opens the
pack review screen (`/app/pack?url=…`, the same screen pack links and the Deck installer open), which
lists everything the pack will do before anything is applied. Packs set up on the device show as
installed, and are managed under **Settings → Sources**.

## Publishing

- Themes: the [izumi-themes submission guide](https://github.com/nickEatsBread/izumi-themes#submitting-a-theme).
- Plugins, sources and packs: the [izumi-plugins README](https://github.com/nickEatsBread/izumi-plugins),
  which covers building each, getting listed, and running another marketplace.

Both repositories copy rules from this one: the theme validator (`src/lib/themes/`), the plugin
format (`src/lib/plugins/manifest.ts`), the package installer (`src-tauri/src/extension_package.rs`)
and the pack format (`src/lib/packs/format.ts`). Change the rule here first, then the copy there.

## Implementation map

| Area | Location |
| --- | --- |
| Built-in and user stores | `src/lib/store/feeds.ts` (`BUILTIN_STORES`, `PLUGIN_STORE_URL`) |
| Store index (sources, themes, plugins, packs, per-platform builds) | `src/lib/store/native-format.ts` |
| One kind of entry from every store | `src/lib/store/listings.ts`, `src/lib/store/plugins.ts`, `src/lib/store/themes.ts` |
| Store loading, signatures and trust | `src/lib/store/load.ts`, `src/lib/store/trust.ts`, `src-tauri/src/store_trust.rs` |
| Store manager (add, hide, remove stores) | `src/lib/components/store/StoresDialog.svelte` |
| Installing an entry (themes, plugins and packs hand off to their own pages) | `src/lib/store/install.ts` |
| Plugin format, install and sandbox | `src/lib/plugins/` |
| Plugins page | `src/routes/app/settings/plugins/+page.svelte`, `src/lib/components/plugins/` |
| Package origins | `src/lib/store/origins.ts` |
| Pack format, review and setup | `src/lib/packs/`, `src/lib/components/packs/PackFlow.svelte`, `src/routes/app/pack/` |
| Package installer and local services | `src-tauri/src/extension_package.rs`, `src-tauri/src/extension_service.rs` |
| A source account's playback languages (service settings `languages` and `section`) | `src/lib/settings/catalog-languages.ts`, `src/lib/extensions/source-languages.ts`, [catalog-languages.md](catalog-languages.md) |
| Store page | `src/routes/app/settings/store/+page.svelte` |
