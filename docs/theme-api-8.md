# Theme API 8: plan

Status: plan for the owner's review, built on `feat/theme-api-8` in the phases at the end. Theme API 7
shipped in v0.1.75, so everything a package can declare here is Theme API 8. The branch is stacked on
PR #218 (`fix/player-loader-size`), which makes the playback ring's size a stylesheet setting
(`--theme-player-spinner-size` and `--theme-player-spinner-stroke`), because the loading screens below
lean on it.

The four requests, in the owner's words:

1. "custom screen loading support … like the cover image and the loading etc etc when your loading up a
   series/film etc"
2. "being able to customize the look of the schedule page"
3. "being able to make your own screens (like in the sidebar etc) with a maximum limit in the client …
   packs help if they want to add custom functionality through plugins"
4. "inherit one theme for client navigation and another theme for the player … (so the loading and
   player itself could be seperate if the user so wanted)"

## Versioning

- `LATEST_THEME_API` becomes 8 and `SUPPORTED_THEME_APIS` gains 8.
- Every new package key is accepted only when the package declares `themeApi: 8` (the `api8()` gate
  in `presentation.ts`, as for API 2–7). A package declaring 7 or lower that uses one is refused, so it
  renders the same on every client that accepts it.
- An older client refuses a `themeApi: 8` package whole with its existing "requires a different theme
  API, check for a client update" message, and keeps showing the listing. Nothing half-parses.
- The player theme (request 4) is a client setting, not a package key, so it needs no API.
- The theme catalog (izumi-themes) vendors `presentation.ts` and `block-schema.ts`; it takes the new
  copies once this ships, and holds API 8 themes until a release has API 8, as it did for 6 and 7.

## 1. Loading screens: `loading`

What Navigator does (read from its source at a3d1e3c, GPL-3.0 like izumi; all plain CSS):

- Opening a title page: an empty hero box and grey placeholder blocks, hidden for the first 180 ms so a
  fast load never flashes them. When the page arrives the backdrop and the logo each fade in over
  300 ms (`cubic-bezier(.23,1,.32,1)`), under a bottom blur-and-colour scrim.
- Starting playback: a black screen with the backdrop at `brightness(.75)`, a gradient from the bottom
  (black 80 % → 20 % at the middle → clear), the title logo centred (it appears over 240 ms from
  scale .97, then "breathes" between opacity .72/scale .985 and .95/1.015 every 2880 ms, with a light
  sheen sweeping across it), and bottom left the title, the series name, a runtime/year line and a
  16 px spinner beside a status line. It cuts to the video at the first frame.

izumi already has the pieces: a series page drawn from the tapped card while its record loads
(`detail` with `data-pending`), a catalog title page skeleton (`detail.skeleton`), and the opening
screen (`play.connecting`) that hands over to the player's own black cover until the first frame. What
a theme cannot do today is put the title's artwork and words on those screens. API 8 adds one template
for each moment:

```json
"loading": {
  "title":   { "template": { "type": "stack", "children": [ … ] }, "exit": 300 },
  "episode": { "template": { "type": "overlay", "children": [ … ] }, "exit": 0 }
}
```

- `loading.title`: while a series page or a catalog title page (film or series) loads its record, a
  screen (`loading.title` slot) covers the page area, under the navigation, drawing the template
  bound to the title the user picked: `title`, `poster`, `posterHd`, `backdrop`, `logo` (when the card
  had one), `format`, `year`, `startYear`, `genres`, `kind`, `score` and the other title fields the card
  already knows. `data-variant` is `series` or `catalog`.
- `loading.episode`: from the press to the first frame, the opening screen and the player's black cover
  draw the template (`loading.episode` slot, `data-variant` `opening` then `player`) bound to the title
  and episode: the title fields plus `episodeNumber`, `episodeNo`, `episodeCode`, `episodeName`,
  `episodeTitle` and `still`. The ring (`play.loader`), Back (`play.connecting.back`) and the slow-source
  line (`play.loader.detail`) stay on top, where a stylesheet can move and size them (a Navigator look
  puts a 16 px ring bottom left with `--theme-player-spinner-size`).
- Templates here are display-only (no actions), like card templates, and use the existing node types,
  fields and artwork. Nothing new to learn.
- `exit` (0–1000 ms, default 0): once the page or the first frame arrives, the screen stays that long
  with `data-state="done"` (and no pointer events), so a stylesheet can fade it out with a plain
  transition. 0 removes it at once, as today.
- `--loading-elapsed` on the slot is minus the time since this load began (`-1840ms`). The episode
  screen moves from the opening screen to the player's cover mid-load; a stylesheet that writes
  `animation-delay: var(--loading-elapsed)` keeps a looping animation in step and an entrance from
  replaying at that hand-over. It is plain CSS: the client never animates the screen.
- A delayed appearance (Navigator's 180 ms) is plain CSS too; THEMES.md shows the keyframes.
- Without a template every screen stays exactly as it is now.
- Phone and TV: `loading` may sit in the `mobile` and `tv` blocks (one level merge, each moment
  replaced whole). The Android phone app keeps its own watch page while an episode opens, so
  `loading.episode` does not draw there. In Game mode the template shows until mpv's window is up;
  mpv then draws its own ring (themed colour and size, PR #218) until the picture.
- Docs: THEMES.md "Theme API 8", the hooks table, and a worked Navigator-style example.

## 2. Schedule page: `schedule`

Today the page has four hooks (`schedule`, `schedule.day`, `schedule.item`, `schedule.error`) and no
template. API 8:

```json
"schedule": { "item": { "type": "row", "children": [ … ] } }
```

- `schedule.item`: a display-only template for one airing entry, used by the agenda, the day view, the
  Game mode day view and the Release calendar (the same entry everywhere). It is bound to the title
  fields plus four new API 8 fields: `airTime` (the local time, "9:30 PM"), `airingLabel` (the entry's own
  line: "Episode 5", "S2 E5", "Movie premiere"), `listStatus` ("Watching", "Planning", "Watched": your
  tracking, on your shows only) and `delay` (the delay notice when the schedule reports one). `airingIn`
  is the time left to this airing and is absent once it has aired, so `when` tells aired from coming.
  The entry stays a link to the title, and the remove button on your own shows stays beside it.
- New hooks (parts unless marked), so a stylesheet reaches every piece:
  - `schedule` slot gains `data-tab` (`schedule`, `personal`, `watchlist`) and `data-layout` (`agenda`,
    `days`).
  - Header: `schedule.header` (`data-pinned` while it sticks), `schedule.tabs`, `schedule.tab`
    (`data-tab`, `data-active`), `schedule.filter`, `schedule.filter.option` (`data-value` `mine`/`all`,
    `data-active`), `schedule.week`, `schedule.week.step` (`data-dir`), `schedule.week.label`,
    `schedule.today`.
  - Day strip (day view, phones, Game mode): `schedule.daytabs`, `schedule.daytab` (`data-active`,
    `data-today`, `data-unaired`), `schedule.hint` (the pad hint line).
  - Days: `schedule.day.title` (`data-today`).
  - Built-in entry pieces (when no template): `schedule.item.poster`, `schedule.item.title`,
    `schedule.item.meta`, `schedule.item.badge` (`data-variant` `status` or `source`),
    `schedule.item.countdown`, `schedule.item.delay`; `schedule.item` gains `data-aired`.
  - Next up: `schedule.nextup`, `schedule.nextup.item`.
  - `schedule.empty` (the "nothing this week/day" boxes), `schedule.loading` (the placeholders).
  - Release calendar: `schedule.feeds` and `schedule.feed` (`data-active`).
- `schedule` may sit in the `mobile` and `tv` blocks.
- Coverage: the Schedule store screenshot already exists; a theme using `schedule` counts as Shell.

## 3. Theme screens: `layout.screens`

A theme may add up to **4** screens of its own. Each is a navigation entry plus a page built from the
same entries as a theme Home: catalog rows by role (`{ "role": "trending" }`) and Home blocks
(`{ "block": "tabbed-grid", … }`), on whatever catalog is active.

```json
"layout": {
  "screens": [
    { "id": "picks", "title": "Picks", "icon": "star",
      "home": [ { "block": "ranked-list", "title": "Top this season", "tabs": [ … ] }, { "role": "trending" } ] }
  ]
}
```

- `id` is 1–24 lowercase letters, digits or dashes, unique in the theme; `title` 1–24 characters;
  `icon` one of `star`, `heart`, `flame`, `sparkles`, `trophy`, `compass`, `clock`, `calendar`, `tv`,
  `film`, `grid`, `list`; `home` 1–30 entries under the same rules as `layout.home` (a hero at most
  once).
- The limit: a package with more than 4 screens is refused at install with a clear message, and the
  client never renders more than 4 even from a stored design.
- Where they show: after Library on the side rail, the top bar, the drawer and the pinned side panel
  (`nav.item` with `data-dest="screen"` and `data-screen="<id>"`), and as icons in the phone Home header
  (`home.header.action`, same attributes). The page is `/app/screen/<id>`: the `screen` slot
  (`data-screen`) with a `screen.title` heading, then the entries, rendered by the same code as Home.
- They follow the theme's layout switch (Settings → Home), like the rest of `layout`. Turning the
  layout off, or switching theme, removes them; an open one returns to Home.
- No scripting. A theme only arranges what izumi already draws. Behaviour (fetching new data, buttons
  that do new things) belongs to plugins, delivered in a pack alongside the theme (PR #205's sandboxed
  runtime). THEMES.md says so where it documents screens.
- Phones keep the bottom bar's destinations as they are; a screen is reached from the Home header.

## 4. A separate player theme

Settings → Appearance → Theme gets a **Player theme** row: `Same as app` (the default, so nothing
changes for anyone who leaves it), the shipped palettes, and every installed or Theme Studio theme. It
is per device and not synced, like a catalog screen's own theme.

- While an episode opens and plays (the opening screen, the player, and its own loading), the player
  theme's colours, font, stylesheet, `player` keys and `loading.episode` apply. `<html>` carries
  `data-theme-role="player"` then, so a stylesheet can tell it is dressing only the player.
- The app's navigation placement, Home layout, theme screens and every other `layout`/`shell` choice
  stay the app theme's, so the page under the player never re-lays itself out.
- What a viewer sees: with the windowed player beside the side rail, the rail takes the player theme's
  colours while a video plays (the stylesheet swaps whole; two stylesheets at once would need every
  theme rewritten for a scoped root). Full screen, Game mode, phones and `player.window: "full"` show
  only the player.
- Order of precedence, unchanged apart from the new step: safe mode, then a Studio or install preview,
  then the player theme while playing, then the catalog screen's own theme, then the app theme.
- The title page's loading screen is navigation, so it follows the app theme.
- The Android phone mini-player counts as browsing: the app theme applies while it is docked.

## What stays out

- No theme scripting, no new template node types, no per-theme routes beyond `layout.screens`.
- The source picker stays with the app theme (it opens over the title page).
- Theme Studio does not get editors for these keys in this round; packages and hand-edited designs use
  them, and Studio keeps them when it saves a design.

## Tests and proof

- Parser tests per key: accepted at API 8, refused at 7, limits (5 screens, exit 1001, bad icon, bad id,
  duplicate id), phone/TV block merging.
- Hook contract (`hooks.test.ts`) covers every new hook against the markup and THEMES.md.
- Unit tests for the player-theme precedence and the screen nav entries.
- A demo package in `docs/theme-packages/` that uses every API 8 key in a Navigator-style look, shown
  working in the dev client: title loading, episode loading, the schedule, a theme screen, and a player
  theme that differs from the app theme. Screenshots go on the PR.

## Phases

1. API 8 versioning and the player theme setting.
2. Loading screens (`loading.title`, `loading.episode`).
3. Schedule template and hooks.
4. Theme screens.
5. Demo package, client screenshots, PR.

Each phase lands as its own commit with its tests and THEMES.md section.
