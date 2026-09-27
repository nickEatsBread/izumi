# Installable themes

Settings → Themes opens the community catalog at [izumi-themes](https://github.com/nickEatsBread/izumi-themes). Users can browse, search, inspect a theme, preview it on their client, and install it. **Add theme** opens a dialog: a public HTTPS package or release descriptor (including GitHub file links), one or more JSON files, or a folder of packages. Theme Studio exports are accepted. The catalog repository link is in that dialog.

The Theme Studio button inside Themes opens the live design editor. Themes is the single settings-menu entry for browsing and customizing themes; the editor remains directly searchable.

The shipped appearance remains the default. Community packages live in the [izumi-themes](https://github.com/nickEatsBread/izumi-themes) catalog; the client does not ship them. Installing a theme is an explicit choice. No appearance update is applied automatically.

## Theme API coverage

The client renders theme API 1, 2 and 3 (`SUPPORTED_THEME_APIS` in `src/lib/themes/packages.ts`). API 1 is the original key set and stays valid unchanged; a package declares `themeApi: 2` to use the additions below (bottom bar, slide indicator, section headings, series tabs, docked watch layout, phone overrides), and `themeApi: 3` for stylesheets, fonts, template parts, airing and slide fields and the text wordmark (see "Theme API 3"). The validator gates keys by the declared API, so an API 1 package cannot carry API 2 chrome past an older client. A package newer than the client is refused with a clear message and listed in the gallery as "Needs a newer izumi".

Coverage chips in Theme Studio (`Home`, `Shell`, `Details`, `Player`, or `Full`) reflect the slots a draft actually uses.

### Appearance

Semantic colors, font family and scale, corner radius, backdrop and glass effects.

### Chrome

- Information density: `compact`, `comfortable`, or `large`.
- Hide poster titles (`hideCardLabels`).
- True black canvas on dark palettes (`trueBlack`).
- Navigation placement: side rail, top bar, or bottom bar. Phones keep the bottom bar. Destination order stays in Settings → Navigation.
- Compact shell padding.
- Bottom bar styling (API 2, `shell.bottomNav`): flush bar, floating card or centred pill; labels always, on the active tab or never; a tonal pill, top line or dot as the active marker; height, icon size, radius, colours, blur, border and whether the bar hides while scrolling. `BottomNav.svelte` renders it and `src/lib/theme.ts` publishes `--theme-bottom-nav` so the page reserves the right space.
- Top bar (API 3, `shell.top`): destination names as text links or with icons (`labels`), an inline search field in the centre or at the end (`search`), a menu drawer (`menu`) and a centred brand (`brand`). With `presentation.brand: "text"` the bar shows the text wordmark.

### Home

- Hero: visibility, desktop/mobile height, rotation interval, rank badge visibility, an optional badge template and an optional entire hero template.
- Slide indicator (API 2, `hero.indicator`): filled bars, dots, pills, an "n / N" counter or none, at the start, centre or end, in a theme colour. One snippet in `Hero.svelte` serves the built-in desktop and phone layouts and custom templates; without it each layout keeps its own default (timed bars on desktop, dots on a phone).
- Rows: carousel or wrapping grid, card width and spacing, row spacing, artwork shape and corners (these style the default cover; a custom card template owns its own shape), heading size, and optional media-card templates.
- Section headings (API 2, `heading`): weight, uppercase, a bar/dot/underline accent and whether "View more" is text, an arrow or hidden. Home-row cards also receive `rankPosition` and a zero-padded `rank`, so a row template can number trending titles.
- Per-row overrides follow stable row identities, so reordering a row does not move its visual settings to another row. Resolution is global defaults → semantic row role → exact scoped row ID. For example, `continue` can override every Continue Watching row and `anime:continue` can target one catalog.

Home blocks — latest episodes, tabbed grid, genre chips, ranked list and profile header — and the side column are izumi features: anyone adds, configures and removes them from Edit Home (`src/lib/home/blocks.ts`, `src/lib/components/home/`). Themes style them through the block hooks listed under "Styling hooks".

Theme layout (API 3, `layout`): `home` lists the Home in order — catalog rows by role (`continue`, `recent`, `trending`, …; `hero` is the featured banner, and leaving it out hides it) and blocks with their settings (`{ "block": "ranked-list", "area": "aside", "tabs": [{ "label": "Top airing", "role": "trending" }] }`); `asideWidth` sets the side column (240–420 px); `nav` sets the phone bottom bar (`bottom`), the Home header icons (`top`) and Home's position on the bar (`home`). `mobile.layout.home` replaces the Home list on phones. A role the active catalog lacks is skipped. The layout applies while the theme is active; people turn it off, or customize a copy that becomes their own layout, in Edit Home and Settings → Navigation — their own layout is never overwritten. The featured banner is itself a Home row, so anyone can move or hide it.

### Cards

Optional templates for three families: `poster` (ordinary tiles), `continue` (resume cards), and `search` (search grids). A home-row `card` template still wins on that row. Search falls back to the poster family when it has no template of its own.

### Series page

- Page composition: stacked tabs (`stack`), a split info + episode rail (`split`), or a full-bleed overlay (`overlay`) with title, Play and synopsis on the artwork.
- Episode placement: inside the Episodes tab, a right-hand rail, or below the series info. A right-hand rail becomes a list under the info column on narrow windows. Overlay pages keep episodes below the artwork.
- Banner visibility and poster width. Overlay pages always show the banner and hide the overlapping poster.
- Optional episode-card templates (non-interactive, like poster tiles). Arrangement can be a wrapping grid or one full-width tile per row; hover can grow the tile. The cards / compact / grid control in Appearance still chooses cards vs numbers.
- Optional series-facts template (icons + text). Theme Studio can edit facts and episode cards per theme.
- Tab style (API 2, `detail.tabs`): underline, pills, an iOS-style segmented control, or a bar of equal tabs with a tinted pill behind the active one (`Tabs.svelte`).
- API 3: `factsStyle` (`table`, `cards`, `chips` or the `facts` template), `countdown` (`compact` or `long` airing countdown), `listButton` (`inline`, `full` or `hidden`), `tabs: "bottom"` (a phone tab bar that takes the bottom navigation's place), and `header`, a non-interactive template rendered under the series title on every layout (a studio chip, a score, a meta line) whatever `factsStyle` shows.

### Player

Seekbar thickness and color. Skip rules, subtitle files and playback shortcuts stay in Settings.

Watch layout (API 2, `player.layout` and `player.dock`): `docked` keeps the browse chrome while watching and mounts the video in a stage of `dock.width` percent, with the episode rail beside it (`episodes: "right"`, a scrolling list of episode cards) or below it (`episodes: "below"`, a server switcher and an episode number grid, `DockEpisodes.svelte`). `dock.comments` (default `below`) renders the episode discussion inline (`CommentsPanel` with `inline`) under the stage, or after the episode grid. The stage is the transparent hole over the native video, so neither the player root nor any of its ancestors may paint a background: everything around the stage is an opaque sibling (rail, discussion panel, gutters). Picking an episode takes the Next button's route (`playEpisodeInPlayer`), so a cached same-release source continues without the picker. Fullscreen, picture-in-picture, Game mode and phones keep the full container.

How the video follows the layout: the webview is transparent over the native mpv surface, so the player root in `PlayerOverlay.svelte` is the video's frame. While the chrome is up the root measures its edges as fractions of a full-viewport probe (zoom-agnostic) into `playerStage`; the app shell turns them into physical-pixel insets (`src/lib/player/insets.ts`) and calls `player_set_inset` with all four edges. Windows moves the mpv container to that rect, macOS sets the GL view's frame and Linux (Wayland) positions and sizes the `wl_subsurface`; each keeps rendering at the surface's real pixel size, so a smaller stage changes the picture's size, never its scaling. Before the overlay has measured itself the shell uses the chrome's own extent (sidebar rail, top bar or bottom bar), which also fixes the old blank rail beside a top navigation bar: the root is inset from whichever edge `shellNav` (`src/lib/themes/runtime.ts`) says the chrome occupies.

### Phone overrides

`presentation.mobile` (API 2) carries a phone variant of the same layout: `density`, `hideCardLabels`, `trueBlack`, `hero`, `rows`, `detail`, `player` and `cards`, with the same shapes as their top-level counterparts. It applies when `isMobile` is true (the Android app and any window up to 640px) and is dropped everywhere else, so a package can lead with a poster-based featured card, narrower rows and a stacked series page on phones while keeping its desktop composition. `resolvePresentation` in `src/lib/themes/presentation.ts` merges the block one level deep per section (a phone hero keeps the shared interval; a `rows.byId` entry or card family replaces its shared counterpart whole); both the runtime store and the document chrome in `src/lib/theme.ts` read the resolved tree. `shell` is not accepted inside `mobile`: phones always use the bottom bar, and `shell.bottomNav` at the top level is what styles it.

### Theme API 3

A package declares `themeApi: 3` to use these keys. The validator refuses them on API 1/2 packages, and packages may be up to 512 KB.

- **Stylesheet (`design.css`, ≤ 128 KB).** Ordinary CSS aimed at the styling hooks (`data-slot`, `data-part`, state attributes such as `data-active`) and the theme variables. The webview parses it (CSSOM) and izumi rebuilds it from the parsed rules (`src/lib/themes/css.ts`), then scans the result and rejects it whole if anything forbidden remains. The shared policy lives in `src/lib/themes/css-policy.ts` (the catalog CI uses a copy).
  - Removed: `@import`, `@font-face`, `@page`, `@property`, `@counter-style`, `@font-feature-values`; `-webkit-app-region`, `app-region`, `behavior`, `-moz-binding`; every `url()` except `data:image/(png|jpeg|gif|webp|avif|svg+xml)` URIs up to 32 KB (base64 or percent-encoded, without quotes or parentheses inside); `image-set()`, `image()`, `src()`, `element()`, `cross-fade()` and `expression()` with or without a vendor prefix; custom properties containing a backslash; any `--izumi-safe-*` declaration. CSS escapes are decoded before the check, so escaped function names are caught too.
  - Rejected outright: a stylesheet containing `@namespace`, and one whose rebuilt text still loads anything. The install check refuses remote loads and blocked at-rules up front; the Themes page shows why an applied stylesheet was rejected.
  - Limits: 4,000 rules (keyframe frames count), nesting depth 8.
  - The stylesheet is injected last in `<head>` inside `@scope (:root) to ([data-theme-protected])`. Top-level `@keyframes` and `@layer` statements stay outside the scope; declare `@keyframes` at the top level, not inside `@media` or `@supports`.
  - Tailwind class names are not a supported target and change between releases.
- **Fonts (`design.fonts`).** `{ ui, heading, display }`, each a bundled id: `system`, `serif`, `nunito`, `geist-mono`, `inter`, `roboto`, `poppins`, `lato`, `montserrat`, `open-sans`, `rubik`, `dm-sans`, `plus-jakarta-sans`, `outfit`, `manrope`, `figtree`, `source-sans-3`, `noto-sans`, `fira-sans`, `oswald`, `bebas-neue`, `cinzel`, `playfair-display`, `sansita`, `geist` (`src/lib/themes/font-ids.ts`). Stylesheets use `var(--ui-font)`, `var(--font-heading)` and `var(--font-display)`. Only Latin and Latin Extended files ship; other scripts fall back to the system font. Files load on first use (`src/lib/themes/fonts.ts`).
- **Template parts.** Any template node may carry `part` (`^[a-z][a-z0-9.-]{0,39}$`), rendered as `data-part`.
- **Fields.** `nextEpisode`, `slide`, `slides`, `episodesAired` (numbers) and `airingIn` (`2d 21h`), `airingCountdown` (`4 days 19 hrs 43 mins`), `genre` (the first genre alone) (strings). The hero binds `slide`/`slides` and re-derives the countdowns on its clock.
- **Conditions.** `when.field` may also name artwork (`poster`, `backdrop`, `logo`, `still`): the node renders when that artwork exists. `when.absent: true` inverts any condition (not combinable with `atMost`), so `{ "type": "artwork", "artwork": "logo", "when": { "field": "logo" } }` beside `{ "type": "text", "field": "title", "when": { "field": "logo", "absent": true } }` shows a title logo, else the title.
- **Wordmark (`presentation.brand`).** `text` renders "izumi" as `[data-slot="brand"]` → `[data-part="brand.text"]` → one `[data-part="brand.char"]` per letter (`BrandText.svelte`). The expanded side rail always uses the text version. The text is always "izumi".
- **Ambient colour.** While a theme stylesheet is applied, the home hero publishes `--hero-ambient-rgb` (`r g b`) on `<html>` from the current artwork (for AniList titles, the cover's dominant colour, since their images can't be read back). When the image can't be read the variable is cleared, so always give `var(--hero-ambient-rgb, …)` a fallback.
- **Video.** During playback `html` and `body` are forced transparent with inline `!important` and the page content is hidden the same way, so ordinary theme backgrounds never cover the video. Don't paint over the player area yourself (fixed overlays, pseudo-elements on `body`).
- **Protected surfaces and safe mode.** The Themes page, Theme Studio's panel, the install preview bar, the safe-mode banner and the Store's trust and install dialogs carry `data-theme-protected`: theme rules can't match inside them, they read a client-owned palette (`--izumi-safe-*`, written by `src/lib/theme.ts`) and they reset inherited `visibility` and `pointer-events`. Ancestor opacity, transforms and overlays can't be undone from inside; engines without `@scope` remove the stylesheet while the Themes page is open. Safe mode (Ctrl/Cmd + Alt + Shift + T, or `izumi://safe-mode`, which works even while Themes is open) shows izumi's default appearance — colours, fonts, layout and no stylesheet — for the session without changing the saved theme.

### Styling hooks

Theme stylesheets target these attributes, never Tailwind classes: `[data-slot="…"]` for page regions and `[data-part="…"]` for components, with state attributes such as `[data-active]`, `[data-variant="…"]` and `[data-layout="…"]`. The list lives in `src/lib/themes/hooks.ts`; `hooks.test.ts` fails if the markup and the list drift apart, so a documented hook is only removed or renamed deliberately. Template nodes add their own `data-part` names (`part` in a template).

Never give `watch.stage` or its ancestors a background: the video is drawn behind the page, and the app pins that path transparent with inline `!important`.

```css
[data-slot="nav.side"] { background: #101014; }
[data-part="nav.item"][data-active] [data-part="nav.item.label"] { font-weight: 700; }
[data-part="card"][data-family="poster"] [data-part="card.title"] { font-family: var(--font-heading); }
[data-slot="detail"][data-variant="desktop"] [data-part="fact.label"] { text-transform: uppercase; }
```

State values:

| Attribute | On | Values |
|---|---|---|
| `data-active` | `nav.item`, `hero.dot`, `tab`, `chip`, `page-number` | present when selected, absent otherwise |
| `data-variant` | `home` | `offline`, `anilist`, `merged`, `catalog` |
| `data-variant` | `home.hero` | `template`, `phone`, `desktop` (the desktop banner is `detail.banner` on a series page) |
| `data-variant` | `hero.indicator` | `default`, `bars`, `dots`, `pills`, `counter` |
| `data-layout` | `row` | `carousel`, `grid` |
| `data-row`, `data-role` | `row` | the row's stable id; the role is the part after its `:` (the whole id when it has none) |
| `data-family` | `card` | `poster`, `search`, `continue`, `preview` |
| `data-caption` | `block.latest-episodes` | `below`, `overlay` |
| `data-layout` | `detail` | `stack`, `split`, `overlay` |
| `data-variant` | `detail` | `phone`, `desktop` |
| `data-variant` | `detail.facts` | `table`, `cards`, `chips` (none for a template) |
| `data-variant` | `detail.countdown` | `compact`, `long` |
| `data-variant` | `detail.list-button` | `full` (the full-width button) |
| `data-variant` | `episode` | `template`, `thumb`, `compact`, `number`, `row` |
| `data-layout` | `watch` | `full`, `docked` |
| `data-variant` | `watch.episodes` | `right`, `below` |
| `data-variant` | `watch.comments` | `inline`, `sheet` |
| `data-variant` | `search` | `anilist-scope`, `anilist`, `merged`, `catalog` |
| `data-variant` | `button` | `primary`, `secondary`, `ghost`, `icon` |
| `data-variant` | `tabs` | `underline`, `pills`, `segmented`, `bar` |

#### Brand

| Hook | Kind | What | States |
|---|---|---|---|
| `brand` | slot | The izumi wordmark: the rail's home link, the catalog switcher's brand trigger, and the onboarding and profile wordmark. |  |
| `brand.mark` | part | The logo mark. |  |
| `brand.text` | part | The text wordmark (`presentation.brand: "text"`, and the expanded side rail). |  |
| `brand.char` | part | One letter of "izumi"; style runs of letters with `:nth-child()`. |  |

#### Shell

| Hook | Kind | What | States |
|---|---|---|---|
| `page` | slot | The routed page content (the app's `<main>`). |  |
| `nav.side` | slot | The side navigation rail. |  |
| `nav.top` | slot | The top navigation bar (`shell.nav: "top"`). |  |
| `nav.bottom` | slot | The bottom tab bar (phones, or `shell.nav: "bottom"`). |  |
| `nav.item` | part | A navigation destination link. | `data-active` |
| `nav.item.icon` | part | The icon of a navigation destination. |  |
| `nav.item.label` | part | The label of a navigation destination. |  |
| `search.field` | part | A search input: the global search overlay, or the theme top bar's search field. |  |
| `nav.menu` | part | The top bar menu button that opens the drawer. |  |
| `nav.drawer` | slot | The side drawer of destinations (top bar `menu: "drawer"`); items are `nav.item`. |  |

#### Home

| Hook | Kind | What | States |
|---|---|---|---|
| `home` | slot | The Home page. | `data-variant` |
| `home.hero` | slot | The featured banner on Home. | `data-variant` |
| `hero.slide` | part | The current slide (the artwork layer). |  |
| `hero.art` | part | The slide artwork image. |  |
| `hero.scrim` | part | A gradient over the artwork. |  |
| `hero.logo` | part | The title logo, when the show has one. |  |
| `hero.title` | part | The text title, when there is no logo. |  |
| `hero.meta` | part | The facts line (format, episodes, score, status). |  |
| `hero.synopsis` | part | The description (desktop). |  |
| `hero.actions` | part | The Watch, Details and Favorite buttons. |  |
| `hero.indicator` | part | The slide marker row. | `data-variant` |
| `hero.dot` | part | One slide marker. | `data-active` |
| `hero.counter` | part | The `n / N` counter (indicator style `counter`). |  |
| `row` | slot | A titled row or grid of cards, on Home and elsewhere. Home rows carry their stable id and role. | `data-row`, `data-role`, `data-layout` |
| `row.header` | part | The row heading bar. |  |
| `row.title` | part | The row title. |  |
| `row.more` | part | The row's view-more link. |  |
| `row.track` | part | The scrolling track or grid holding the cards. |  |

#### Home blocks

| Hook | Kind | What | States |
|---|---|---|---|
| `home.header` | slot | The phone Home app bar: the wordmark and the top icons. |  |
| `home.main` | slot | The main column of Home. |  |
| `home.aside` | slot | The side column of Home, holding blocks placed in the aside. |  |
| `pagination` | part | Page controls under a block: numbered pages or a Load more button. |  |
| `page-number` | part | One numbered page button. | `data-active` |
| `block.title` | part | A block heading. |  |
| `block.genre-chips` | slot | Genre shortcuts: an All chip and one chip per genre (each a `chip`). |  |
| `block.latest-episodes` | slot | Newly aired episodes as a grid of stills. Items reuse `episode.still`, `episode.number`, `card.title` and `card.meta`. `data-caption` is `below` or `overlay`. | `data-caption` |
| `block.item` | part | One entry in a block (an episode, a poster or a ranked title). |  |
| `block.tabbed-grid` | slot | A tab strip (`tabs`) over a poster grid; each poster is a `block.item` holding a `card`. |  |
| `block.ranked-list` | slot | A numbered top list; each entry is a `block.item` with `card.art`, `card.title` and `card.meta`. |  |
| `block.rank` | part | The rank number of a ranked-list entry. |  |
| `block.profile-header` | slot | The profile banner with the viewer's name, watch stats and shortcut buttons (`button`). |  |
| `block.banner` | part | The profile banner image. |  |
| `block.avatar` | part | The profile avatar (an image, or the first letter of the name). |  |
| `block.name` | part | The profile name. |  |
| `block.stat` | part | The watch statistics line. |  |

#### Cards

| Hook | Kind | What | States |
|---|---|---|---|
| `card` | part | A media card: poster, search, continue or preview. | `data-family` |
| `card.art` | part | The card artwork frame. |  |
| `card.title` | part | The card title. |  |
| `card.meta` | part | The line under the title (season, format, source, episode). |  |
| `card.badge` | part | The label on the artwork (for example "Episode 5"). |  |
| `card.score` | part | The score badge. |  |
| `card.progress` | part | The watch-progress track; the fill is its child. |  |
| `card.episode` | part | The episode number on resume cards. |  |
| `card.overlay` | part | The hover or play overlay on the artwork. |  |

#### Series page

| Hook | Kind | What | States |
|---|---|---|---|
| `detail` | slot | The series page. | `data-layout`, `data-variant` |
| `detail.banner` | slot | The artwork area at the top of the series page. |  |
| `detail.poster` | part | The cover image. |  |
| `detail.title` | part | The title. |  |
| `detail.alt-title` | part | The native or romaji title. |  |
| `detail.header` | part | The theme template under the title (`detail.header`). |  |
| `detail.meta` | part | The facts line. |  |
| `detail.facts` | part | The facts: a theme template (desktop stack and split) or, with `detail.factsStyle`, a table, cards or chips. | `data-variant` |
| `fact` | part | One entry of the details grid. |  |
| `fact.label` | part | A details entry label. |  |
| `fact.value` | part | A details entry value. |  |
| `detail.genres` | part | The genre chips (phone). |  |
| `detail.synopsis` | part | The description. |  |
| `detail.actions` | part | The action buttons row. |  |
| `detail.list-button` | part | The tracker list-status button. | `data-variant` |
| `detail.airing` | part | The release status of upcoming episodes (sub and dub timing, delays). |  |
| `detail.countdown` | part | The next-episode countdown (`detail.countdown` compact or long). | `data-variant` |
| `detail.episodes` | slot | The episode list. |  |
| `detail.relations` | slot | Related titles. |  |
| `detail.characters` | slot | Characters and voice actors. |  |

#### Episodes

| Hook | Kind | What | States |
|---|---|---|---|
| `episode` | part | One episode: a card, a thumbnail row, a compact row or a number tile. | `data-variant` |
| `episode.still` | part | The episode thumbnail. |  |
| `episode.number` | part | The episode number. |  |
| `episode.title` | part | The episode title. |  |

#### Player

| Hook | Kind | What | States |
|---|---|---|---|
| `watch` | slot | The player area. | `data-layout` |
| `watch.stage` | slot | The video frame. It and its ancestors never paint a background: the video is drawn behind the page. |  |
| `watch.rail` | slot | The rail beside or below a docked player. |  |
| `watch.episodes` | slot | The docked episode list or grid. | `data-variant` |
| `watch.servers` | part | The server switcher. |  |
| `watch.comments` | slot | The episode discussion (inline under a docked player, or the sheet). | `data-variant` |
| `player.controls` | slot | The player controls layer. |  |
| `player.seekbar` | part | The seek bar. |  |
| `player.title` | part | The playing title. |  |

#### Search, schedule and library

| Hook | Kind | What | States |
|---|---|---|---|
| `search` | slot | The search page. | `data-variant` |
| `search.filters` | part | The search filter bar. |  |
| `search.results` | slot | The search results. |  |
| `schedule` | slot | The airing schedule page. |  |
| `schedule.day` | part | One day of airings: a day of the week agenda, or the selected day. |  |
| `schedule.item` | part | One airing entry. |  |
| `library` | slot | The library page. |  |
| `library.tabs` | part | The library section tabs. |  |
| `library.grid` | slot | The library card grid. |  |

#### Primitives

| Hook | Kind | What | States |
|---|---|---|---|
| `button` | part | A button. | `data-variant` |
| `chip` | part | A chip or pill (genre, filter, scope). | `data-active` |
| `input` | part | A text input. |  |
| `badge` | part | A small label on an item (for example an episode rating). |  |
| `tabs` | part | A tab strip. | `data-variant` |
| `tab` | part | One tab. | `data-active` |

### Platforms

A catalog listing can carry `platforms` (`desktop`, `phone`, primary first). The gallery shows "Phone only", "Desktop only", "Designed for phones · desktop layout included" or "Desktop & phone" (`platformLabel` in `packages.ts`) and offers an All / Desktop / Phone filter; a listing without the field serves both. The label replaces the old fixed "Desktop & mobile" text, which was wrong for packages an older client could not render.

### What themes do not own

Home row order and visibility, navigation destinations, episode list density, skip rules, subtitle file style, recovery chrome (Theme Studio and the installation preview bar keep independent palettes), and native/TV shells beyond the tokens already applied.

ZIP archives, remote fonts and images, JavaScript and native plugins are not supported. Stylesheets are API 3 only and sanitised as described above. Pack-provided fonts and images are planned with packs.

Theme Studio's Layout tab exposes common controls, discovers rows on the current page, shows a template outline, and provides a validated JSON editor for component templates. The existing home editor still owns row content, visibility and order.

## Authoring and publishing

The catalog repository owns the [format reference](https://github.com/nickEatsBread/izumi-themes/blob/main/docs/FORMAT.md), JSON editor schemas, example packages, listing metadata and CI. Authors can publish a package anywhere with public HTTPS access; a catalog listing is optional. Browser builds need the host to allow cross-origin requests. Raw GitHub URLs work for both the browser and native client.

Packages declare `app: "izumi"`, `kind: "theme-package"`, `schemaVersion: 1`, `themeApi: 1` or `2`, a stable ID, numeric `major.minor.patch` version, author metadata and `design`. The `design` contains appearance values and optional `presentation`. Packages omit local saved-theme IDs and timestamps. Existing personal exports are normalized into an installable shared theme. The `shared.*` ID namespace is reserved for these client-created imports; external packages and catalog listings cannot claim it. Saved installations and their rollback records retain valid shared IDs when loaded.

Templates compose `stack`, `row`, `grid`, `overlay`, `text`, `artwork` and `action` nodes. Text and artwork bind to a host display model. Hero actions call the client's existing play, details, favorite, list, trailer, share and slide-navigation callbacks when the host provides them. Cards keep their host-owned detail or play links. Field types are fixed across hosts: `rankPosition`, `score` (0-100), `duration` (minutes), `episodeNumber` and `progress` (0-100) are numbers; every other field is a string. Artwork may be `poster`, `backdrop`, `logo` or `still`. Text nodes render `score` and `progress` as a percentage such as `78%`, and `duration` as `24m`. Optional conditions check presence for any field; `atMost` is accepted only for the numeric fields. Hosts bind different fields: a card condition on a missing field simply never matches.

Style values are a bounded allowlist. There are no arbitrary selectors, URLs, HTML or executable expressions. Text is escaped, artwork comes from the host media record, and templates are confined to their component. A template is limited to 96 nodes and eight nesting levels. Card, rank and episode templates cannot nest interactive controls inside a host link. Theme Studio and installation-preview recovery controls keep independent styling.

`src/lib/themes/presentation.ts` is the client contract. Its pure validator is mirrored in the catalog's `scripts/presentation.ts`; keep them aligned when extending the API. New keys are added under the next API number (the `api2` gate in the parsers), so an older client refuses a package it cannot render instead of half-parsing it, while packages declaring the older API keep validating exactly as before.

## Installation, updates and recovery

1. The gallery fetches a versioned catalog document from the separate GitHub repository. It caches the last valid listing for offline browsing. Refreshing a listing does not update an installed theme.
2. Catalog packages and release-descriptor links must match the listed byte size, SHA-256, ID and version before preview or installation. Direct package links and local files receive the same schema validation but have no independent listing checksum. These checks establish consistency with the selected listing, not an author's cryptographic identity.
3. HTTPS downloads have a 20-second timeout and a streamed size limit: 256 KB per package and 1 MB for the catalog. Native clients use the existing bounded HTTP transport. Requests use its background lane; the browser path omits credentials and referrers.
4. Preview changes in-memory appearance only. Cancel restores the previously applied appearance. Reloading also ends the preview. Opening Theme Studio cancels an installation preview before starting an editable draft. Preview controls are hidden during playback and return when playback closes.
5. Installation records the normalized author package, origin and associated editable Theme Studio design. Installed designs work offline. A same-ID package from another origin cannot replace an installation without removing it first.
6. **Check update** checks the catalog or a release-descriptor link. A newer package opens for review; applying it performs a three-way merge against the prior author design. Unmodified values take the update; personal edits and explicit deletions remain. Arrays, including a template's child order, are treated as whole personal edits.
7. The previous version and edited design are kept for **Restore previous**. **Remove** returns an active installation to the shipped appearance and leaves other saved themes alone. **Use default** is always available. A design deleted separately in Theme Studio can be reinstalled from the same origin.

The client retains the existing limit of 24 saved designs. Install writes attempt to restore the prior library and metadata if persistence fails. Package metadata uses `installed-themes-v1`; editable appearance stays in the existing Theme Studio library. Browser local storage is not a transactional database, so external corruption or exhausted storage may still require freeing storage and reinstalling. Direct package URLs are snapshots; use a release descriptor to provide an update pointer.

## Implementation map

| Area | Location |
| --- | --- |
| Presentation contract and resolution | `src/lib/themes/presentation.ts` |
| Host display-model bindings | `src/lib/themes/host-model.ts` |
| Package, release and catalog parsing | `src/lib/themes/packages.ts` |
| Bounded downloads, integrity and cache | `src/lib/themes/catalog.ts` |
| Install, preview, merge and rollback | `src/lib/themes/installed.ts` |
| Active presentation store and navigation placement | `src/lib/themes/runtime.ts` |
| Video insets and the docked stage | `src/lib/player/insets.ts`, `PlayerOverlay.svelte`, `DockEpisodes.svelte`, `player_set_inset` in `src-tauri/src/lib.rs` |
| Document chrome (density, true black, seekbar vars) | `src/lib/theme.ts`, `src/app.css` |
| Declarative renderer and layout editor | `src/lib/components/themes/` |
| Gallery and installed library | `src/routes/app/settings/themes/+page.svelte` |
| Host integration | `Hero.svelte`, `HomeRowFrame.svelte`, `Carousel.svelte`, `SmallCard.svelte`, `ContinueCard.svelte`, `SearchResults.svelte`, `AnimeDetail.svelte`, `Tabs.svelte`, `EpisodeCard.svelte`, `Sidebar.svelte`, `BottomNav.svelte`, `Seekbar.svelte` |

## Validation

Focused tests cover package validation, rejected styles and versions, bounded downloads, checksums, cached listings, stable row overrides, page composition helpers, card-family resolution, coverage labels, preview cancellation, personal edits through updates, rollback, origin conflicts, reinstalling a removed design and failed-install recovery. Existing Theme Studio, hero, carousel and series-page navigation checks are included in the verification run.

Browser QA uses the real gallery and public package links. Responsive checks cover desktop and a 390px viewport, including a split series page collapsing the episode rail below the info column. Native player behavior and physical mobile/TV deployment require their normal platform test environments.

The catalog's preview images are screenshots of this client: `scripts/preview/` in izumi-themes serves the dev build to headless Chromium behind a Tauri IPC shim, answers the AniList and episode-metadata requests from a fixture catalogue with generated artwork, seeds the theme and a few plays into local storage, and captures Home (desktop themes) or a two-phone composite (phone themes). Re-render after changing a renderer or a package.
