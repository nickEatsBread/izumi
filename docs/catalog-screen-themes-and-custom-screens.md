# Themes per catalog screen, and custom screens

Status: approved design, 2026-10-24. Builds on Theme API 6 (PR #165).

## Terms

- **Catalog screen**: one destination in Home's catalog switcher — Automatic anime, AniList, Kitsu,
  TMDB, Stremio, Aniyomi sources, Merged — and, with this change, any custom screen. The active one is
  `catalogScreen` (`src/lib/settings/catalog.ts`); Home, Search and the shell follow it.
- **App theme**: today's single theme choice (`themePreset` + `activeStudioThemeId`).
- **Screen theme**: a theme chosen for one catalog screen. It replaces the app theme while that
  screen is active.
- **Custom screen**: a user-made catalog screen — a named screen in the switcher, filled with
  sections from any enabled platform, with its own optional screen theme.

## Goals

1. A user can give each catalog screen its own theme, e.g. TMDB → Marquee, Automatic anime → the
   default. Switching screens switches the theme.
2. A user can make their own screens ("Movie night"), name them, fill them with sections from any
   source the client already offers (provider rows, a Stremio addon's catalogs, TMDB rows, tracker
   lists, Nuvio collections, Home blocks), reorder/hide those sections, and theme the screen.
3. Reuse the existing Home row system (`catalogHomeLayouts`, Edit Home, blocks, Merged Home). No
   second customisation system.

## Non-goals

- Theming part of a page (one row, one section). A theme stays document-wide; it only changes *which*
  theme is in force.
- Adding titles to a screen by hand. Sections are populated by their source.
- TV companion / cloud profile support for custom screens (they keep seeing built-in screens).
- Syncing screen themes between devices: theme designs are per device (`installed-<uuid>` ids), so a
  synced screen falls back to the app theme on a device that lacks the design.

## Part 1 — Theme per catalog screen

### Data

`src/lib/themes/screen-theme.ts`

```ts
type ScreenThemeRef = Exclude<ThemePreset, 'custom'> | `design:${string}`
screenThemes = persisted<Record<string, ScreenThemeRef>>('catalog-screen-themes-v1', {})
```

Key = catalog screen id (`tmdb`, `auto`, `merged`, `custom:<id>`). No entry = *Same as app*.
`design:<id>` names a saved/installed design in `studioThemes`; built-in ids name a shipped palette.

### Resolution

Highest first:

1. Safe mode — izumi default, as today.
2. A Theme Studio draft or install preview (`themeStudioPreview`), as today.
3. The active screen's theme, when it resolves (a `design:` ref whose design was deleted does not).
4. The app theme.

Exported as derived stores `effectiveThemePreset` and `effectiveStudioTheme`. The three places that
decide the active theme read them instead of `themePreset` / `activeStudioTheme`:

- `src/lib/theme.ts` `apply()` and its subscriptions (tokens, fonts, stylesheet, root data attributes),
- `src/lib/themes/runtime.ts` `activeLayout` (presentation, shell nav, TV block),
- `src/lib/themes/layout-state.ts` `activeThemeKey` / `activeThemeName` (the theme's Home layout and
  its per-design on/off switch).

Writers stay unchanged: the Themes page, Interface presets, Theme Studio and `applyInstalledTheme`
still set the app theme.

While a screen theme is in force it covers the whole app (Home, hero, the theme's Home layout and
navigation, Search, details, player, settings). The theme's Home layout resolves against that screen's
rows exactly as it does today.

### UI

- **Settings → Catalog → Screens** (new group): one row per catalog screen with a theme picker —
  *Same as app*, *Izumi default*, the shipped palettes, then every saved/installed design by name.
- **Custom screen settings** use the same picker.
- **Themes page and Interface → Theme**: when the active screen has its own theme, a notice reads
  "<Screen> uses <Theme> · Use app theme here" (the action clears that screen's entry). Without it,
  Apply / a preset would appear to do nothing.

## Part 2 — Custom screens

### Data

In `src/lib/settings/catalog.ts`:

```ts
interface CustomScreen { id: string; name: string }   // id: /^[a-z0-9]{1,24}$/, name ≤ 32 chars
customScreens = persisted<CustomScreen[]>('catalog-custom-screens-v1', [])   // at most 12
type CatalogScreen = CatalogSelection | 'merged' | `custom:${string}`
```

- Layout: `catalogHomeLayouts['custom:<id>']` (`CatalogHomeLayoutKey` widens to include it).
- Theme: `screenThemes['custom:<id>']`.
- Blocks: the existing `homeBlocks`, referenced from that layout.
- `catalog-custom-screens-v1` joins the synced setting keys and the Home transfer keys.

### Behaviour: a custom screen is a named Merged screen

`MergedCatalogHome` gains a `target` prop (`'merged' | 'custom:<id>'`) and renders both. A custom
screen therefore has exactly Merged Home's row library and rendering, over every enabled platform:

- AniList rows (season, trending, genres, Your List, recommendations, recently released),
- Kitsu rows, TMDB presets and the user's TMDB rows, each Stremio addon catalog, Aniyomi sources,
- Home blocks, and Nuvio collections (Part 3).

Differences from Merged:

- **Everything starts off.** A new screen shows only the Featured banner and Continue Watching; the
  user adds sections with Edit Home's *Add section*, which already lists the whole library.
- **Hero** comes from the providers of the rows on the screen (AniList's hero only when the screen has
  an AniList row). Merged keeps its current rule.
- **Search**, Continue Watching (all platforms), Categories, the AniList degraded banner and block tab
  resolution treat a custom screen as Merged. One helper, `isMergedScreen(screen)`, replaces the
  `=== 'merged'` checks that should cover both.

### Screen list

- `catalogScreens(providers, custom)` returns built-in screens, then Merged (as today), then custom
  screens. `enabledCatalogScreens`, next/previous catalog (controller bumpers) and startup resolution
  include them. Companion snapshot / cloud profile call it without `custom`, so they never see one; a
  custom active screen maps to Merged (or the concrete provider) there.
- `catalogLabel` returns a custom screen's name. Logos: a generic tile and the izumi mark in a neutral
  gradient (`CatalogPlatformLogo`, `CatalogBrandLogo`).
- Default Home (Settings → Catalog → Browsing) lists custom screens too.

### Create, rename, delete

- **Create**: *New screen…* at the end of the catalog switcher list, and in Settings → Catalog →
  Screens. Asks for a name (and optionally a theme), creates the screen with layout
  `{ order: ['hero', 'continue'], disabled: [] }`, switches to it and opens Edit Home.
- **Rename / theme / delete**: Settings → Catalog → Screens. Delete removes the screen, its layout, its
  screen theme and (via `pruneHomeBlocks`) its blocks. If it was active, the first screen opens; if it
  was the Default Home, Default Home becomes Adaptive.

## Part 3 — Nuvio collections become placeable sections

Today every collection renders at the top of every Home (`CollectionsHome`), outside the row layout.

- Each collection with folders is offered as a Home row `collection:<collectionId>` on every screen.
- **Built-in screens**: default on, and a collection new to a saved layout joins right after the hero
  (a new `lead` flag on `CatalogHomeRowOption`, handled next to the existing "new hero goes first" rule
  in `resolveCatalogHomeRows`). Existing Homes look the same as before.
- **Custom screens**: default off, like every other section there.
- They move, hide and re-add like any row. `isContentRow` excludes them, so a theme layout never
  assigns one to a theme slot; while a theme layout is in force, the enabled collection rows still
  render after the hero, as they do today.
- `CollectionsHome` takes the ids to render; its carousel and "View more" link are unchanged.

## Edge cases

- Deleted design → the screen theme no longer resolves → app theme. The picker shows *Same as app*.
- Platform disabled → its rows drop out of custom screens, as they do from Merged today.
- A custom screen remains available with only one enabled platform (unlike Merged, which needs two
  distinct ones).
- Theme Studio seeds its draft from the app theme, not the screen theme (it edits the app theme).
- Switching to a screen with a different theme changes navigation placement if the themes differ in
  `shell.nav`; this is expected.

## Testing

Unit (vitest, `--pool=threads`):

- screen theme resolution: none / preset / design / deleted design / safe mode / preview precedence;
- `catalogScreens` with custom screens; next/previous wrap; startup with a removed custom screen;
- create/rename/delete custom screen (layout, theme entry, default screen, active screen);
- `resolveCatalogHomeRows` lead rows: a new collection lands after the hero; custom screens start off;
- `isMergedScreen`, `resolveRowId` on a custom target, `isContentRow('collection:…')`;
- markup tests for the Screens settings group and the switcher's New screen entry.

Live: the desktop dev client with Marquee on TMDB and the default on Automatic anime, plus a custom
screen built from TMDB and Stremio rows with its own theme.
