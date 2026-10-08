# Installable themes

Settings → Themes opens the community catalog at [izumi-themes](https://github.com/nickEatsBread/izumi-themes). Users can browse, search, inspect a theme, preview it on their client, and install it. **Add theme** opens a dialog: a public HTTPS package or release descriptor (including GitHub file links), one or more JSON files, or a folder of packages. Theme Studio exports are accepted. The catalog repository link is in that dialog.

The Theme Studio button inside Themes opens the live design editor. Themes is the single settings-menu entry for browsing and customizing themes; the editor remains directly searchable.

The shipped appearance remains the default. Community packages live in the [izumi-themes](https://github.com/nickEatsBread/izumi-themes) catalog; the client does not ship them. Installing a theme is an explicit choice. No appearance update is applied automatically.

## Theme API coverage

The client renders theme API 1, 2, 3 and 4 (`SUPPORTED_THEME_APIS` in `src/lib/themes/packages.ts`). API 1 is the original key set and stays valid unchanged; a package declares `themeApi: 2` to use the additions below (bottom bar, slide indicator, section headings, series tabs, docked watch layout, phone overrides), `themeApi: 3` for stylesheets, fonts, template parts, airing and slide fields and the text wordmark (see "Theme API 3"), and `themeApi: 4` for the phone root size, scroll chrome, series header buttons, fact selection, names and formats, the Information section, the synopsis control, countdown formats and placement, the actions-row lead, ten display fields, the full-resolution poster, the hero's slide count, pool and cross-fade, header shortcuts that repeat a bottom-bar tab, artwork on profile-header buttons, the tabbed grid's opening tab, the portrait series header and its cover fallback, the phone series bar's Home link, logo and solid point, per-episode download buttons, where the season row opens, the series progress row, the folding actions row, the studio button, plain status words and aired episode counts, recommendations among the relations, the kind of title, the hero's artwork choice and the Continue Watching empty state (see "Theme API 4"). The validator gates keys by the declared API, so an API 1 package cannot carry API 2 chrome past an older client. A package newer than the client is refused with a clear message and listed in the gallery as "Needs a newer izumi". Markup hooks and state attributes are not gated: an older client simply never renders the new ones.

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
- Top bar (API 3, `shell.top`): destination names as text links or with icons (`labels`), an inline search field in the centre or at the end (`search`), a menu drawer (`menu: "drawer"`) or a menu pinned as a labelled panel down the left under the bar (`menu: "side"`, `sideWidth` 200–320 px, default 260: the page moves over for it on windows from 1100 px, the menu button folds it away, narrower windows get the drawer, and it hides while a video plays), a centred brand (`brand`) and a Categories menu after the destinations (`categories: true`) with Browse all, Release calendar and the catalog's genres, each opening search.
- Handheld controls (API 3): `shell.top.bumpers: true` turns the top bar's destinations into tabs that L1/R1 switch (no wrap), with the bumper glyphs at either end; L2/R2 step the page's own tabs (series sections, Library sections, Schedule days, and any strip marked `data-page-tabs`), Start opens the menu drawer and View opens search. With a pad in use the bar's controls leave the d-pad order, and the drawer reaches every destination and Settings. `shell.hints: true` adds the controller button-hint bar along the bottom: what A, X, B, the page-tab triggers and the menu button do for the focused element, in the connected pad's printed labels (Steam Deck, Xbox, PlayStation or Nintendo). It shows after pad input in Game or controller mode, hides on the next touch or mouse move, and the page keeps its height free while it shows.

### Home

- Hero: visibility, desktop/mobile height, rotation interval, rank badge visibility, an optional badge template and an optional entire hero template.
- Slide indicator (API 2, `hero.indicator`): filled bars, dots, pills, an "n / N" counter or none, at the start, centre or end, in a theme colour. One snippet in `Hero.svelte` serves the built-in desktop and phone layouts and custom templates; without it each layout keeps its own default (timed bars on desktop, dots on a phone).
- Hero actions: a hero template's `list` action opens the list editor for the slide's title, over Home (the same editor as the series page's list button, read from this device's tracking, the AniList entry and the other connected trackers); a title without an AniList identity gets this device's Save sheet, as its series page offers. API 4 adds the slide count, the pool and a cross-fade (see "Theme API 4").
- Loading: while the featured titles load, a placeholder holds the hero's place as `[data-slot="home.hero"][data-state="loading"]`, with the `data-variant` of the hero that replaces it: `template` (full width, at the template's `height`, `mobileHeight` or `scale` box), `phone` (izumi's inset card, at `mobileHeight` when set) or `desktop` (the banner, at `height` when set); the other catalogs' Homes name the same variants but keep izumi's banner box for all three. It holds `.skeloader` shimmer blocks, so a stylesheet can size it like its own hero (it is `aria-hidden`; a hidden hero has none). While a row loads, its placeholder cards are `.skeloader` blocks with `data-part="row.skeleton"` inside `row.track` (on another catalog's first load, inside plain placeholder rows): 2:3 posters, or 16:9 cards on Continue Watching. Style them through the hook, not the class.
- Continue Watching links to the Library (whose default list is the titles being watched, each with its resume Play) only when the theme names a `heading.viewMore` style (`text` or `arrow`) on that row itself, `rows.byId.continue` or the row's scoped id; a style in `rows.defaults` never adds the link, and izumi's own Home shows none.
- Wide hero (API 3): `hero.scale: "wide"` sizes a hero template as the 16:9 artwork box instead of a viewport height. `hero.bleed` (0–480 px) applies only together with `scale: "wide"` (the client ignores it under `viewport` or `banner`) and runs that many pixels of the artwork's bottom under the rows that follow, with the content, arrows and markers lifted above it. Both apply on windows wider than a phone; phones keep `mobileHeight`. `hero.indicator.past: "empty"` leaves the bars of earlier slides unfilled.
- Rows: carousel or wrapping grid, card width and spacing, row spacing, artwork shape and corners (these style the default cover; a custom card template owns its own shape), heading size, and optional media-card templates.
- Focus caption (API 3, `caption: "focus"` on `rows.defaults` or a row): with a pad in use each row keeps one line under its cards for the focused card's full title and detail line (episode, episode title and time left on Continue Watching; format, season and episode count on posters), so a theme can shorten card labels without losing the full title.
- Section headings (API 2, `heading`): weight, uppercase, a bar/dot/underline accent and whether "View more" is text, an arrow or hidden. Home-row cards also receive `rankPosition` and a zero-padded `rank`, so a row template can number trending titles.
- Per-row overrides follow stable row identities, so reordering a row does not move its visual settings to another row. Resolution is global defaults → semantic row role → exact scoped row ID. For example, `continue` can override every Continue Watching row and `anime:continue` can target one catalog.

Home blocks — latest episodes, tabbed grid, genre chips, ranked list and profile header — and the side column are izumi features: anyone adds, configures and removes them from Edit Home (`src/lib/home/blocks.ts`, `src/lib/components/home/`). Themes style them through the block hooks listed under "Styling hooks".

Theme layout (API 3, `layout`): `home` lists the Home in order — catalog rows by role (`continue`, `recent`, `trending`, …; `hero` is the featured banner, and leaving it out hides it) and blocks with their settings (`{ "block": "ranked-list", "area": "aside", "tabs": [{ "label": "Top airing", "role": "trending" }] }`; `airing-today` lists today's episodes in airing order, with `limit` 3–20, `clock` for the date and a live clock under the heading and `more` for a link to the schedule); `asideWidth` sets the side column (240–420 px) and `asideGap` the gutter between it and the main column (0–96 px, default 32; the main rows scroll inside themselves, so their own padding never separates them from the side column); `asideStart` the main row the side column starts beside, counted after the featured banner (0–29, default 0; the rows before it span the whole width, as when a site runs its first rows edge to edge and puts its sidebar beside a later section); `nav` sets the phone bottom bar (`bottom`), the Home header icons (`top`) and Home's position on the bar (`home`); from API 4 `top` may repeat a `bottom` destination as a header shortcut (see "Theme API 4"). `mobile.layout.home` replaces the Home list on phones. A role the active catalog lacks is skipped. The layout applies while the theme is active; people turn it off, or customize a copy that becomes their own layout, in Edit Home and Settings → Navigation — their own layout is never overwritten. The featured banner is itself a Home row, so anyone can move or hide it.

### Cards

Optional templates for three families: `poster` (ordinary tiles), `continue` (resume cards), and `search` (search grids). A home-row `card` template still wins on that row. Search falls back to the poster family when it has no template of its own.

`cardPreview: "none"` (API 3) switches off izumi's hover popup on poster cards, for a card template that draws its own hover panel (for example a stack shown on `[data-part="card"]:hover`).

### Series page

- Page composition: stacked tabs (`stack`), a split info + episode rail (`split`), or a full-bleed overlay (`overlay`) with title, Play and synopsis on the artwork.
- Episode placement: inside the Episodes tab, a right-hand rail, or below the series info. A right-hand rail becomes a list under the info column on narrow windows. Overlay pages keep episodes below the artwork.
- Banner visibility and poster width. Overlay pages always show the banner and hide the overlapping poster.
- Optional episode-card templates (non-interactive, like poster tiles). Arrangement can be a wrapping grid or one full-width tile per row; hover can grow the tile. The cards / compact / grid control in Appearance still chooses cards vs numbers.
- Optional series-facts template (icons + text). Theme Studio can edit facts and episode cards per theme.
- Tab style (API 2, `detail.tabs`): underline, pills, an iOS-style segmented control, or a bar of equal tabs with a tinted pill behind the active one (`Tabs.svelte`).
- API 3: `factsStyle` (`table`, `cards`, `chips` or the `facts` template), `countdown` (`compact` or `long` airing countdown), `listButton` (`inline`, `full` or `hidden`), `tabs: "bottom"` (a phone tab bar that takes the bottom navigation's place), and `header`, a non-interactive template rendered under the series title on every layout (a studio chip, a score, a meta line) whatever `factsStyle` shows. `art: "keyart"` puts 16:9 key art first in every series-page header (the phone band, the overlay backdrops and the desktop banner), falling back to the banner; without it the banner comes first and key art stands in for a missing or broken one. `title: "logo"` shows the title logo instead of the text title on every layout when the title has one.
- Header art (`src/lib/detail/backdrop.ts`), the same choice on every layout and while the page loads: the banner or key art in the theme's order, retried twice before the next one takes its place. A banner never waits for key art; without one the page waits for key art at most 1.2 s from its arrival. A title with neither gets a wash of its cover's colour, never a trailer still or a blurred or stretched cover; the cover stays in the header, hidden, as `[data-part="detail.backdrop"][data-art="cover"]`, for a theme that wants it shown (API 4 `artFallback: "cover"` shows it, sharp, in the wash's place). API 4 `art: "portrait"` is key art, then the portrait poster (`posterHd`, else the largest cover), never the banner. `data-art` on `detail.banner`, `detail.backdrop` and the desktop banner's `hero.art` names what is shown: `banner`, `keyart`, `poster` (API 4 `portrait`), `wash` (the slot only), `pending` (the slot only, while the choice still waits) or `cover`.
- While the series record loads, the page is the theme's own page drawn from what the card the user tapped showed, with `data-pending` on `[data-slot="detail"]`: every hook is present (the bar and Back included), in the order the loaded page has it, and the parts the card cannot fill (a missing title, synopsis, byline or fact, Overview's Themes and Alternative titles, the episode list, relations, cast, recommendations) hold `.skeloader` placeholders inside their usual containers. The artwork painted while loading stays when the record lands. A page that fails to load or finds nothing keeps the phone bar with Back.
- API 3 composition (`detail.sections`): `tabs` lists the sections that get a tab, in order (1–5 of `overview`, `episodes`, `relations`, `characters`, `recommended`, each once). Sections left out render inside Overview after its own content, each as a titled `detail.section`; Overview always keeps a tab, unless `unlisted: "hidden"` drops everything `tabs` leaves out (Overview included) for a page whose info column already carries the facts and synopsis. `labels` renames a tab from a fixed set — Overview: `overview`, `info`, `details`, `about`, `home`; Episodes: `episodes`, `watch`; Relations: `relations`, `related`; Characters: `characters`, `cast`; Recommended: `recommended`, `more-like-this` ("More like this"), `recommendations`. `default` is the tab open on arrival. `info: "overview"` (phones, stacked and split layouts) moves the facts, countdown, release timing, genres and synopsis from above the tabs into Overview. On desktop stacked and split pages a theme that sets `sections` shows the synopsis once: the info column's short synopsis, which Overview then leaves out, or with `info: "overview"` the whole text in Overview and none in the info column (the facts stay in the info column). Without `sections` the info column keeps its short synopsis and Details holds the whole text. `mode: "stack"` drops the tab strip and renders every section in `tabs` order, then the rest, each as a titled `detail.section`. Episodes placed on a right-hand rail or below the info stay there and never take a tab. Series tabs carry `data-tab` with their section id. `detail.column: "poster"` (API 3, desktop stacked and split pages without an episode rail) turns the poster into the head of a left column (`detail.column`, `posterWidth` wide, default 248 px) holding a labelled Watch Trailer button (`detail.trailer`, which then leaves the action bar), the countdown and the facts, with the titles, actions, synopsis and sections beside it. Without the key the tabs are izumi's own: Episodes, Overview, Relations, Characters, Recommended on phones; Episodes, Relations, Cast & Crew, Recommended, Details on desktop.
- API 3 `nav: "hidden"`: the series page covers the phone's bottom navigation, like a page pushed over an app's tab bar, and the room the bar took at the bottom goes with it (bottom tabs, `tabs: "bottom"`, keep theirs).
- API 3 `continue: "card"`: a Continue card (`episode.continue`) above the episode list — the next episode's still, "Continue: Episode N" (or "Play: Episode N" before the series is started), its title and a progress line — plays what the Play button would. On phones it takes the header Play button's place once an episode has aired, while the episodes are on the page (below the header, stacked, or the Episodes tab open, or Overview when the episodes fold into it); with another tab open the header keeps its Play button. Desktop keeps both.
- API 3 episode list (`detail.episodes`):
  - `order`: `tabs` (Oldest | Newest, the default), `flip` (one toggle naming the current order: inside the theme's toolbar, or a round button in the gutter beside the list on desktop, see below) or `none` (no sort control; oldest first).
  - `toolbar`: `bar` (default) or `header`, a heading row with "Episodes" and the count (`episodes.heading`, `episodes.count`) and compact controls at the end.
  - `controls`: the controls shown inline, in order, from `sort`, `layout`, `search`, `download` and `queue`. Every control that applies but is not listed moves into the overflow menu (`episodes.more`: a popover on desktop, a sheet on phones), so a theme can rearrange the controls but not remove one; `[]` puts them all in the menu. A control applies unless the theme turned it off (`order: "none"`, `search: false`) or it cannot work there: the cards/numbers `layout` switch is phone-only and does nothing under a `grid` or `carousel` arrangement (izumi's own bar hides it there too), `download` needs a connection, and `queue` appears once the episode queue is on in Settings. Setting any of these keys (or `search: "field"`, `order: "none"`, `paging: "dropdown"`, or a list shorter than `toolbarMin`) replaces izumi's own toolbar with the theme's. `order: "flip"` on its own does not: izumi's toolbar stays, with the flip as a round button in the gutter beside the list on desktop (as before API 3), and phones keep the Oldest | Newest switch. With the theme's toolbar the flip is a toggle inside it, except beside a desktop right-hand rail, where it keeps the gutter button.
  - `search: "field"`: an always-visible filter field, filling the bar or on its own row under a heading toolbar. Every search lists number matches first ("10" finds 10, 100–109, then titles containing 10) and shows `episodes.empty` when nothing matches.
  - `paging`: `pages` (Prev/Next under the list, `episodes.pager`), `ranges` (a scrolling row of range chips above the list, `episodes.ranges`, labelled "1–50" from the printed numbers and opened on the range holding the episode the series Play button starts) or `dropdown` (a range picker in the toolbar, `episodes.range`, labelled "1 – 100"). `pageSize` sets the page or range length (12–200, default 48); `auto` uses 25, 50 or 100 for lists under 250, under 500 or longer.
  - `toolbarMin` (0–100): with fewer episodes than this the toolbar shrinks to its overflow button, so downloads and the queue stay reachable.
  - `seasons`: `chips` (with the year), `posters` (2:3 covers) or `dropdown` ("Season N" with a list): a picker above the episodes when the title is one of two or more TV, TV short or ONA seasons linked by AniList prequel/sequel relations (a film between seasons is followed but not listed), labelled "Season N" in release order. Picking one opens that title. In a `header` toolbar the dropdown takes the heading's place. Offline pages and titles without an AniList mapping show no picker.
- Every episode element (`episode`, in every layout) carries `data-state` (`watched`, `partial`, `resume`, `unwatched`, `unaired`), `data-next` on the episode the Play button opens and `data-filler` on known filler, so a stylesheet can dim watched episodes or badge the next one without a template.
- The episode overflow menu, range list and season dropdown list (`episodes.menu`, `data-variant` `more` / `range` / `seasons`) render outside `detail.episodes`, at the end of the page, not inside it: target them directly (for example `[data-part="episodes.menu"]`), never nested under `[data-slot="detail.episodes"]`.

### Player

Seekbar thickness and color. Skip rules, subtitle files and playback shortcuts stay in Settings.

Watch layout (API 2, `player.layout` and `player.dock`): `docked` keeps the browse chrome while watching and mounts the video in a stage of `dock.width` percent, with the episode rail beside it (`episodes: "right"`, a scrolling list of episode cards) or below it (`episodes: "below"`, a server switcher and an episode number grid, `DockEpisodes.svelte`). `dock.comments` (default `below`) renders the episode discussion inline (`CommentsPanel` with `inline`) under the stage, or after the episode grid. The stage is the transparent hole over the native video, so neither the player root nor any of its ancestors may paint a background: everything around the stage is an opaque sibling (rail, discussion panel, gutters). Picking an episode takes the Next button's route (`playEpisodeInPlayer`), so a cached same-release source continues without the picker. Fullscreen, picture-in-picture, Game mode and phones keep the full container. API 3 adds five `dock` keys. `flow: "page"` turns the watch view into a scrolling page: the video frame moves up with it, the native video follows, and every block under it keeps its natural height, so the discussion grows with its comments instead of scrolling inside a box (Windows; other desktops keep the fixed layout). Beside a side rail only the video's column scrolls (the rail keeps its own list), and that is the default there whenever the discussion sits under the video, whatever the package's API; `flow: "fixed"` keeps the discussion in its own scroller under a video that stays put. Below the video the default is `fixed`. Under a top bar the app backs the bar with the page colour while the page scrolls, so a translucent bar never shows the video passing beneath it. `maxWidth` (480–2400 px) caps the column, centred when `align` is `center`. `below` orders the blocks under the video: `toolbar` (a row of dropdowns opening upward: `server`, `episode`, `release` and `download`, chosen and ordered by `toolbar`), `info` (the poster, "Title - 12", the format and airing line and the season), `episodes` (the server switcher and number grid) and `comments`; without it the grid comes first, then the discussion unless `comments` hides it. `hide` drops player chrome the page already shows: `back` (the Back button) and `title` (the title and episode line over the video); they only apply while docked, so fullscreen keeps them. The torrent readout follows the viewer's own setting, never the theme.

How the video follows the layout: the webview is transparent over the native mpv surface, so the player root in `PlayerOverlay.svelte` is the video's frame. While the chrome is up the root measures its edges as fractions of a full-viewport probe (zoom-agnostic) into `playerStage`; the app shell turns them into physical-pixel insets (`src/lib/player/insets.ts`) and calls `player_set_inset` with all four edges. Windows moves the mpv container to that rect, macOS sets the GL view's frame and Linux (Wayland) positions and sizes the `wl_subsurface`; each keeps rendering at the surface's real pixel size, so a smaller stage changes the picture's size, never its scaling. Before the overlay has measured itself the shell uses the chrome's own extent (sidebar rail, top bar or bottom bar), which also fixes the old blank rail beside a top navigation bar: the root is inset from whichever edge `shellNav` (`src/lib/themes/runtime.ts`) says the chrome occupies.

### Phone overrides

`presentation.mobile` (API 2) carries a phone variant of the same layout: `density`, `hideCardLabels`, `trueBlack`, `hero`, `rows`, `detail`, `player` and `cards`, with the same shapes as their top-level counterparts. It applies when `isMobile` is true (the Android app and any window up to 640px) and is dropped everywhere else, so a package can lead with a poster-based featured card, narrower rows and a stacked series page on phones while keeping its desktop composition. `resolvePresentation` in `src/lib/themes/presentation.ts` merges the block one level deep per section (a phone hero keeps the shared interval; a `rows.byId` entry or card family replaces its shared counterpart whole); both the runtime store and the document chrome in `src/lib/theme.ts` read the resolved tree. `shell` is not accepted inside `mobile`: phones always use the bottom bar, and `shell.bottomNav` at the top level is what styles it. `mobile.rootSize` (API 4) is the one key that exists only inside `mobile` (see "Theme API 4").

### Theme API 3

A package declares `themeApi: 3` to use these keys. The validator refuses them on API 1/2 packages, and packages may be up to 512 KB.

- **Stylesheet (`design.css`, ≤ 128 KB).** Ordinary CSS aimed at the styling hooks (`data-slot`, `data-part`, state attributes such as `data-active`) and the theme variables. The webview parses it (CSSOM) and izumi rebuilds it from the parsed rules (`src/lib/themes/css.ts`), then scans the result and rejects it whole if anything forbidden remains. The shared policy lives in `src/lib/themes/css-policy.ts` (the catalog CI uses a copy).
  - Removed: `@import`, `@font-face`, `@page`, `@property`, `@counter-style`, `@font-feature-values`; `-webkit-app-region`, `app-region`, `behavior`, `-moz-binding`; every `url()` except `data:image/(png|jpeg|gif|webp|avif|svg+xml)` URIs up to 32 KB (base64 or percent-encoded, without quotes or parentheses inside); `image-set()`, `image()`, `src()`, `element()`, `cross-fade()` and `expression()` with or without a vendor prefix; custom properties containing a backslash; any `--izumi-safe-*` declaration. CSS escapes are decoded before the check, so escaped function names are caught too.
  - Rejected outright: a stylesheet containing `@namespace`, and one whose rebuilt text still loads anything. The install check refuses remote loads and blocked at-rules up front; the Themes page shows why an applied stylesheet was rejected.
  - Limits: 4,000 rules (keyframe frames count), nesting depth 8.
  - The stylesheet is injected last in `<head>` inside `@scope (:root) to ([data-theme-protected])`. Top-level `@keyframes` and `@layer` statements stay outside the scope; declare `@keyframes` at the top level, not inside `@media` or `@supports`.
  - Tailwind class names are not a supported target and change between releases.
  - Write longhands when a value uses `var()` and the same rule also sets one of that shorthand's parts: after `background: linear-gradient(… var(--x) …)` a following `background-clip: text` leaves the other `background-*` parts unserialisable, so the rebuilt rule loses them. `background-image: linear-gradient(… var(--x) …)` survives.
- **Fonts (`design.fonts`).** `{ ui, heading, display }`, each a bundled id: `system`, `serif`, `nunito`, `geist-mono`, `inter`, `roboto`, `poppins`, `lato`, `montserrat`, `open-sans`, `rubik`, `dm-sans`, `plus-jakarta-sans`, `outfit`, `manrope`, `figtree`, `source-sans-3`, `noto-sans`, `fira-sans`, `oswald`, `bebas-neue`, `cinzel`, `playfair-display`, `sansita`, `geist` (`src/lib/themes/font-ids.ts`). Stylesheets use `var(--ui-font)`, `var(--font-heading)` and `var(--font-display)`. Only Latin and Latin Extended files ship; other scripts fall back to the system font. Files load on first use (`src/lib/themes/fonts.ts`).
- **Template parts.** Any template node may carry `part` (`^[a-z][a-z0-9.-]{0,39}$`), rendered as `data-part`.
- **Fields.** `nextEpisode`, `slide`, `slides`, `episodesAired` (numbers) and `airingIn` (`2d 21h`), `airingCountdown` (`4 days 19 hrs 43 mins`), `genre` (the first genre alone), `ageRating` (`13+`, `17+`, `18+`, `PG`, `G`, or the catalog's certification), `audio` (`Sub | Dub`, `Subtitled`, or absent when unknown) and `timeLeft` (`21m left`, resume cards only, absent before an episode starts) (strings). The hero binds `slide`/`slides` and re-derives the countdowns on its clock. Episode templates also bind `episodeNo` (the printed number, `12`; the series-wide number when the viewer shows those), `episodeCode` (`S2 E5` when the episode metadata knows its season, else `E5`), `watched` (`Watched` once the episode is finished), `filler` (`Filler`), `rating` (out of ten with one decimal, `8.5`, released episodes only) and `episodeName` (the episode's own title: absent when it has none, where `episodeTitle` reads `Episode 12`, and while spoiler protection hides it); `episodeNumber` still renders `E12`.
- **Conditions.** `when.field` may also name artwork (`poster`, `backdrop`, `logo`, `still`, `keyart`): the node renders when that artwork exists. Artwork that fails to load counts as absent. `when.absent: true` inverts any condition (not combinable with `atMost`), so `{ "type": "artwork", "artwork": "logo", "when": { "field": "logo" } }` beside `{ "type": "text", "field": "title", "when": { "field": "logo", "absent": true } }` shows a title logo, else the title.
- **Title extras.** `keyart` (16:9 title artwork), `logo`, `ageRating` and `audio` are looked up per title, and only when a hero, series-header or series-page option binds them: key art and logos from the title's TVDB artwork (or the TMDB/add-on backdrop and logo), the age rating from the catalog certification or MyAnimeList's rating, audio from the release schedule's dub premiere. Lookups are cached and never block the page; a hero template that shows key art or a logo waits up to 1.5 s for them. A title logo is taken in the app's language, else English, else the title's own language, else none (the title shows as text); a logo in any other language is never used. ani.zip does not say which language its TVDB logo is in, so that logo counts as the title's own; when the viewer has TMDB set up (Settings → Catalog), TMDB's logo in the app's language or English, for the title ani.zip maps there, takes its place (key art never waits for that lookup).
- **Icons.** `icon` nodes and actions may use `bookmark`, `plus`, `info` and `share` besides the fact icons. An action with an `icon` and no `text` is an icon-only button labelled for screen readers; with `text` it shows both.
- **Logo.** The izumi mark and wordmark are not themeable. They render in the app's own font and palette and sit outside the stylesheet's scope (`data-theme-protected`), so a theme can place the brand in the top bar (`shell.top.brand`) but never recolour, restyle or replace it.
- **Cover colour.** `--cover-rgb` (`r g b`) carries a series' catalog cover colour on each poster and search card (`card`), each ranked-list row (`block.item`) and the series page (`detail`), for per-title tints such as `-webkit-text-stroke-color: rgb(var(--cover-rgb, 255 255 255))`. Titles without one leave it unset, so always give a fallback.
- **Ambient colour.** While a theme stylesheet is applied, the home hero publishes `--hero-ambient-rgb` (`r g b`) on `<html>` from the current artwork (for AniList titles, the cover's dominant colour, since their images can't be read back). When the image can't be read the variable is cleared, so always give `var(--hero-ambient-rgb, …)` a fallback.
- **Video.** During playback `html` and `body` are forced transparent with inline `!important` and the page content is hidden the same way, so ordinary theme backgrounds never cover the video. Don't paint over the player area yourself (fixed overlays, pseudo-elements on `body`).
- **Protected surfaces and safe mode.** The Themes page, Theme Studio's panel, the install preview bar, the safe-mode banner and the Store's trust and install dialogs carry `data-theme-protected`: theme rules can't match inside them, they read a client-owned palette (`--izumi-safe-*`, written by `src/lib/theme.ts`) and they reset inherited `visibility` and `pointer-events`. Ancestor opacity, transforms and overlays can't be undone from inside; engines without `@scope` remove the stylesheet while the Themes page is open. Safe mode (Ctrl/Cmd + Alt + Shift + T, or `izumi://safe-mode`, which works even while Themes is open) shows izumi's default appearance — colours, fonts, layout and no stylesheet — for the session without changing the saved theme.

### Theme API 4

A package declares `themeApi: 4` to use these keys; the validator refuses them on API 1–3 packages. They exist so a theme can match a phone app's own scale, chrome and series page where a stylesheet alone cannot (script-driven state, values that are not in the page, or elements that live in another part of the page). The markup hooks and state attributes added with them (destination ids, the scroll-chrome state, series action states, relation types, the expanded synopsis) are not gated; they are listed under "Styling hooks".

- **Phone root size (`mobile.rootSize`, 14–18 px).** Accepted only inside `mobile`, never at the top level. Every rem of izumi's phone UI follows the root font size (izumi's own is 14.5 px), so `16` puts the app on the 16 dp grid most phone apps are built on; the design's font scale still multiplies it. izumi's own screens that the theme does not restyle grow with it. The izumi mark and wordmark keep their size under every theme: they are sized from the client-owned `--izumi-safe-rem`, which a stylesheet cannot declare. Inside the stylesheet's `@scope` wrapper `:scope` is the root (`<html>`), and `:root` or `html` do not match it; prefer this key to a `:scope { font-size }` rule, which drops the font scale and does not count towards the theme's coverage.
- **Scroll chrome (`shell.bottomNav`).** `hide: "collapse"` keeps the bottom bar in place (its labels stay in the DOM and the page keeps the bar's height) and only reports the state, for a stylesheet to fold the bar, for example into an icon-only pill. `threshold` (8–160 px, whole) is how far the page scrolls in one direction before the state flips; a change of direction starts the count again. Without it izumi's own rule applies. `idle` (0–5000 ms, whole) brings the chrome back after that long without scrolling; `0` or no value never does. Only the page's vertical scroll counts (sideways rows never move it). The state is `shown` within 8 px of the top, resets on navigation and stays `shown` while the Android mini-player is docked. It is published as `data-chrome` on `<html>` (select it as `:scope[data-chrome="hidden"]`) and as `data-state` on `nav.bottom`, also on pages that hide the bar (`detail.nav: "hidden"`), so a stylesheet can move `home.header` or `detail.bar` with it.
- **Display fields.** `startYear` (the release year, `2023`; `year` stays the season, `Fall 2023`), `genre2` and `genre3` (the second and third genres, beside API 3's `genre`) and `episodesWatched` (a number: the episodes the viewer has finished, from their list or watch history, bound on the series page and on poster and Continue cards; absent when unknown; `when.atMost` compares it). Templates bound to a title (cards, the hero, the series header and facts) also get `rating` (API 3): the average score out of ten with one decimal (`8.6`), absent for an unscored title. Episode templates keep binding the episode's own `rating`, absent for an unrated or unaired episode.
- **Series header buttons (`detail.buttons`).** 0–3 of `play`, `list` and `download`, each once, in order, rendered inside `detail.buttons` on the phone stacked page and the phone overlay body; desktop ignores the key. `play` is the Play button (a `continue: "card"` still takes its place, as before), `list` the full-width list button, `download` a "Download E{n}" button (`button` with `data-action="download"`) for the episode Play opens: a tap queues that episode with the Settings → Downloads defaults, as the episode's own download button (`episode.download`) does, and once it is queued, downloading or saved a tap opens Downloads. Its text follows the download ("Queued E3", "Downloading E3 · 42%", "Downloaded E3", "Retry E3" after a failed one), as do `data-state` (`none`, `queued`, `progress`, `done`), `data-episode` and `--download-progress`. Choosing several episodes stays with the episode list's download selection: the list's own Download control, and "Download episodes" in the phone More menu (`detail.menu`) beside a header Download, which opens it with the Play episode picked (opening the tab that holds the episodes when another is open). Download is left out offline and before the first episode airs. `[]` shows no header buttons. Without the key the header keeps Play, plus the list button under `listButton: "full"`, and renders no `detail.buttons` wrapper: they stay straight in the page's column (or the overlay body), as before.
- **Actions-row lead (`detail.actionsLead`).** A non-interactive template rendered first in the phone actions row, inside `detail.lead` (which takes the free width), bound to the series facts plus `episodesWatched`, `episodesAired` and `episodeCount`: "Watched 3 out of 12", or "Total of 12" through `when: { "field": "episodesWatched", "absent": true }`. `episodeCount` there is the catalog's episode count, as on the cards, and absent while the catalog does not know it (a long runner), so "Total of 1180 / ??" is `episodesAired`, then `episodeCount` with a `when: { "field": "episodeCount", "absent": true }` "??" beside it, never a count that reads as finished. The lead and the `facts` template bind the title extras they name (`ageRating`, `audio`, key art, the logo), as the series header template does.
- **Facts (`detail.factsKeys`, `infoKeys`, `factsLabels`, `factsFormat`).** `factsKeys` sets which standard facts the `table`, `cards` and `chips` styles show, on phones and desktop, and their order: 1–20 of `format`, `episodes`, `status`, `aired`, `season`, `duration`, `studio`, `source`, `country`, `score`, `members`, `genres`, `progress`, and the API 4 facts `year` (the release year), `ended` (the end date), `favourites`, `author` (the original creator) and the title's names, `romaji`, `english` and `native`, each once (each `fact` carries its key in `data-key`, so a label-over-value block per name is a stylesheet rule on the Information grid). A fact without a value is left out (`ended` while a show airs); while the page loads, a fact the tapped card cannot fill holds a placeholder inside its `fact.value` instead. `infoKeys` does the same for the phone Information block; without it the block keeps izumi's own facts and wording ("Runtime", "Premiered", "184,000 members", every studio). `factsLabels` and `factsFormat` apply to both. `factsLabels` renames a fact from a fixed list per key, rendered in Title Case (the first is izumi's own): `format` `type`, `format`; `episodes` `episodes`, `total-episodes`; `aired` `aired`, `premiered`, `start-date`, `release-date`; `ended` `ended`, `end-date`; `year` `year`, `release-year`; `duration` `duration`, `runtime`, `average-duration`; `studio` `studio`, `studios`; `author` `author`, `creator`; `source` `source`, `source-material`; `country` `country`, `origin-country`; `score` `score`, `mean-score`, `rating`; `members` `members`, `popularity`; `favourites` `favourites`, `favorites`; `progress` `watched`, `progress`; `romaji` `romaji`, `name-romaji` ("Name Romaji"), `romaji-title`; `english` `english`, `name`, `english-title`; `native` `native`, `native-title`; `status`, `season` and `genres` keep their own. `factsFormat` sets `score` (`percent` "86%", the default; `ten` "8.6"; `ten-of` "8.6" followed by a `fact.suffix` part, " / 10"), `dates` (`numeric` "2026-1-1", the default; `short` and `long` in the viewer's locale, such as "1/1/2026" and "1 January 2026") `counts` (`compact` "184K", the default; `full` "184,000"; `raw` "184000") and `duration` (`min` "24 min"; `long` "24 mins", "1 hr 45 mins"; `short` "24m", "1h 45m"; without it izumi's own "24 min", "24 minutes" in the Information grid's own wording), `status` (`catalog`, the default, the catalog's word: "Releasing", "Finished", "Not Yet Released"; `plain` "Ongoing", "Completed", "Hiatus" or "Cancelled", and nothing for a title not out yet, so the fact is left out; it also sets the `status` field of the series page's header, facts and actions-row templates and the status in izumi's own facts line) and `episodes` (`total`, the default, the episode count: the catalog's, else the airing schedule's; `aired`, while the title airs (Releasing or on hiatus), the episodes aired so far; `aired-of`, while it airs, those followed by a `fact.suffix` part with " / " and the catalog's planned total, or "?" without one: "1147 / ?", "14 / 26"; a title that is not airing, or whose aired count is unknown, reads its total under both). The tables are `FACT_KEYS`, `FACT_LABELS` and `FACT_LABEL_TEXT` in `src/lib/themes/presentation.ts`.
- **Information section (`detail.sections`).** `information`, the phone Overview's Information block (`detail.info`), joins the sections, and `tabs` takes 1–6. Listed in `tabs`, it becomes its own section at that position: a tab under `mode: "tabs"`, a `detail.section` with `data-section="information"` under `mode: "stack"`. Left out, it stays inside Overview exactly where it sits today (never folded to the end, never a tab), and leaves the page only with Overview: `unlisted: "hidden"` removes it when `tabs` leaves Overview out too, while a page that keeps Overview keeps the block inside it (hide `detail.info` in the stylesheet to drop it there). It may be named `information`, `details` or `show-details` ("Show Details"), and `default` may name it only when `tabs` lists it. Desktop pages are unchanged.
- **Synopsis control (`detail.synopsis`, phones).** `more`: `none` (the default: tapping the text expands it, with no link), `expand` (a `detail.synopsis.more` button after the clamped text toggles `data-expanded` on `detail.synopsis` and reads "Show less" while open) or `tab` (the button opens Overview, which holds the whole synopsis, and scrolls it under the bar; where the clamped text is Overview's own, or the page has no Overview, it expands in place like `expand`). `label`: `more` ("More"), `read-more` ("Read more") or `show-more` ("Show more"). It follows every phone synopsis: the one with the facts, the overlay body's and Overview's. The button renders only while the text is actually clamped, or while it is open; the line count stays in the stylesheet (`-webkit-line-clamp` on `detail.synopsis`). izumi drops its own clamp from an open synopsis, so scope the stylesheet's to `[data-part="detail.synopsis"]:not([data-expanded])`. Under `tab`, a tap on the clamped text with the facts opens Overview as the button does; text the clamp does not cut, and open text, still toggle in place.
- **Countdown (`detail.countdown`, `countdownAt`, `countdownWithin`).** Three more formats: `words` (the two largest units in words, "Episode 13 airs in 2 days 3 hours"), `full` (days, hours, minutes and seconds, ticking each second) and `date` ("Next episode 13" over the local airing time, "Sun, Aug 2 at 4:16 PM", in the viewer's locale and on its 12- or 24-hour clock), with `detail.countdown.label` and `detail.countdown.time` parts. `countdownAt` places it with the facts (`info`, the default), at the top of the episode list under its toolbar (`episodes`), or `both`. `countdownWithin` (1–365 days, whole) hides it while the next episode is further away.
- **Episode list (`detail.episodes.download`, `seasonsScroll`).** `download`: `none` (the default) or `button`, which ends every episode card and row (built-in or `card` template, not the number tiles) with the episode's own download button, `episode.download`. A press queues that episode with the Settings → Downloads defaults, the queue the list's download selection fills, or, once it is queued, downloading or saved, opens Downloads, where it can be paused, cancelled or deleted; it never plays the episode, and a controller or keyboard reaches it like the episode's other controls. It shows the download's state itself (`data-state` `none`, `queued`, `progress` or `done`, `--download-progress` "42%"), so the card's read-only download badge goes. Offline pages and select mode leave it out; an episode that has not aired keeps a disabled one, so the rows stay aligned. `seasonsScroll`: `active` (the default) opens the `chips` or `posters` season row scrolled to the current season; `start` leaves it at its start, on the first season.
- **Tabbed grid opening tab.** A `tabbed-grid` block in `layout.home` may set `default`: the index of the tab open on arrival (0-based, within its `tabs`; the first without it). A tab (of a tabbed grid or a ranked list, on any API that has layouts) may name the role `recent`: the recently aired titles of the airing schedule, newest first, one entry per show with its latest episode on the card ("Episode 12"), over the Recently Released row's three weeks and without the titles dismissed there; on the AniList and merged Homes (other catalogs have no airing schedule and show the tab empty). Edit Home offers it as a tab too.
- **Continue Watching empty state (`rows.byId.continue.empty`).** `hidden` (the default) leaves Continue Watching off Home while there is nothing to continue, as izumi's own Home does; `shown` keeps the row with its title and puts an empty state in its track: `row.empty`, holding the line `row.empty.text` ("Nothing to continue yet") and a Browse link to Search (`row.empty.action`). Read from that row's own entry (the role `continue` or the row's scoped id, the phone block's included), never from `rows.defaults`, like its view-more link.
- **More display fields.** `durationLong` (the running time in words: `24 mins`, `1 min`, `1 hr`, `1 hr 45 mins`, `2 hrs`; an episode template's follows the episode's own runtime), `scoreValue` (the score alone, `81`, where `score` reads `81%`), `completed` (`Completed` once the viewer has finished the series: izumi's own list status, else the catalog list entry, is Completed, or the series has finished airing and the episodes watched reach its count; a rewatch in progress does not count; bound on poster and search cards and the hero) and `airingSoon` (`Soon` once the next episode's countdown has run out but the catalog has not moved on to a newer episode, where `airingIn` and `airingCountdown` are absent; "EP 13 SOON" is `nextEpisode` with it). All four are strings, absent when unknown, so `when` tests them for presence. `starring` (the first three characters' names, "Frieren, Fern, Stark") and `creators` (every main studio, "MADHOUSE, Studio X", else a provider's creator names) feed credit lines on title templates; also strings, absent when unknown. `kind` names the kind of title as streaming apps do, for a meta line such as "Series • Action • 2024": `Series` (TV, TV short, ONA), `Movie` or `Special` (OVA, special, music video); a string bound wherever a title is (cards, the hero, the series page), absent for an unknown format.
- **Full-resolution poster (`posterHd`).** An artwork kind and `when` field: the title's TVDB poster from the same ani.zip record that key art and logos come from, looked up only where a template binds it (the hero, the series header), else the catalog cover at its largest size (AniList's `extraLarge`, never the card-sized one). For a full-bleed portrait phone hero, which upscales the 460 px catalog cover several times. A hero that binds it waits for it like key art.
- **Hero (`hero.limit`, `source`, `transition`, `art`).** `limit` is the number of slides (1–15, whole; izumi features 7 on the AniList Home and up to 10 elsewhere). `source` picks the AniList pool: `season` (the default: this season's top-scored titles that have landscape art, in a stable shuffle) or `trending` (released titles trending now, in trending order, with or without landscape art, each with a "#N in Trending Now" rank); other catalogs keep their own picks. `transition`: `slide` (the default, izumi's directional entrance) or `fade`, a 650 ms cross-fade. On a template hero the outgoing slide's copy lies over the incoming one (inert, `aria-hidden`) and fades out; on izumi's own layouts the outgoing artwork stays under the incoming slide (`hero.slide` with `data-state="leaving"`) while it fades in. Reduced motion swaps at once. In Game mode the fading layers keep their static `translateZ(0)` and animate opacity only. `art` picks the artwork of a slide without a catalog banner. izumi's own desktop banner shows the title's key art in its place, then the trailer still, then the cover, so a trailer still (YouTube bakes blurred pillarbox bars and burned-in captions into those) shows only for a title with neither a banner nor key art. `banner-cover` drops the trailer still there, and gives a template's `backdrop` the same order: the catalog banner, key art, then the cover, never a trailer still (without it a template's `backdrop` stays the banner, else the trailer still, else the cover, as before). A slide without a banner waits for its key art as long as a template waits for the artwork it binds (1.5 s), then does without. izumi's own phone card shows the cover either way.
- **Header shortcuts (`layout.nav.top`).** `top` may list a destination that `bottom` also lists, such as a search icon in the Home header beside a Search tab; API 1–3 packages are still refused ("A destination can sit on the bottom bar or the top, not both"). The repeat is a shortcut, not a second placement: the bottom bar and Settings → Navigation keep one entry per destination (the bottom one), and only the phone Home header (`home.header.action`) shows the icon. The rule exists because the navigation config holds one placement per destination and every list built from it is keyed by destination; the header now reads the theme's own `top` list, so the config never holds the repeat.
- **Profile-header button art.** A `profile-header` block's button may set `art: true` (`{ "label": "Lists", "to": "library", "art": true }`): an `<img data-part="block.button.art">` under its label shows the banner (else the cover) of one of the viewer's own titles. Buttons that ask take titles in order and never the same one twice: Continue Watching first, most recent first, then this device's library, most recently changed first. A button past the titles there are shows none. `block.profile` wraps the avatar, name and stats, so a theme that wants only the buttons can hide it.
- **Portrait series header (`detail.art: "portrait"`, `detail.artFallback`).** `portrait` puts key art first, then the full-resolution portrait poster (the TVDB `posterHd`, else the catalog cover at its largest), and never the ~5:1 banner, for a tall portrait header; it shows as `data-art="poster"`. `artFallback`: `wash` (the default) or `cover`, which shows the cover itself, sharp and never blurred, when the title has nothing else (`data-art="cover"`). Both apply on every layout.
- **Series bar (`detail.bar`, phones).** `home: true` adds a Home link after Back (`detail.home`). `title`: `text` (the default) or `logo`, the title logo (`detail.bar.logo`, inside `detail.bar.title`) once the artwork is under the bar, when the title has one; it does not need `detail.title: "logo"`. `solidAt` (0.2–1) is how far through the artwork's scroll (its height less the bar's) the bar turns solid (`data-solid`) and shows its title; 1 is izumi's own, once the artwork is fully under it.
- **Recommendations among the relations (`detail.sections.relations`).** `{ "recommended": "append" }` follows the related titles in the Relations section (tab or `detail.section`) with the recommended ones, each a `relation` with `data-relation="recommended"` and a `relation.type` reading "recommended", and the Recommended section leaves the page; `tabs` and `default` may not name `recommended` then. `separate` (the default) keeps izumi's own. Every `relation` also carries `data-media` (`anime`, `manga`, `novel`, `one-shot`), so a stylesheet can keep the anime alone (`[data-part="relation"]:not([data-media="anime"]) { display: none }`). Phones and desktop.
- **Series progress row (`detail.progress: "row"`, phones).** A row under the header buttons (stacked page and overlay body) once the series is under way, as the Play button's `resume` state says: `detail.progress.label` "Episode 4 of 12" (the episode Play opens, of the episode total, or of the episodes aired when that is more, as on a long runner without a planned total), `detail.progress.value` "31%" and `detail.progress.meter`, a track whose child `span` fills to that share. The share is the episodes before that one plus how far into it the viewer got, over the total, and 100% once the episodes watched reach it; `--progress` on the row carries it too. `none` (the default) draws no row. Desktop ignores the key.
- **Folding actions row (`detail.actions: "expand"`, phones).** The stacked page's actions row shows only More (after `detail.lead`) until its first tap unfolds Save, Share and Trailer (`data-expanded` on `detail.actions`, `aria-expanded` on More). A tap on More while they show opens the More menu (`detail.menu`: the list button, "Download episodes" beside a header Download, and the tracker links), and closing the menu (a tap outside, Escape, or one of its entries) folds the row again. `row` (the default) keeps every action showing and More opening the menu at once.
- **Studio button.** The `detail.header` and `detail.facts` templates may hold an `action` node with `action: "studio"` (the header holds no other action): a `button` with `data-action="studio"` and the template's `part`, reading the main studio's name (or the node's `text`, or only its `icon`), that opens izumi's studio page, or a search for the studio when the catalog gives it no page. It renders only while the title names a studio. Other templates refuse it.
- **Play resumes where Continue Watching does.** Every series Play button (and the Continue card, the episode list's opening range and `data-next`) opens the episode after the ones finished or, when an episode was opened here and not finished, that episode, the rule Continue Watching uses; `data-state="resume"`, the Continue wording and the progress row follow, and so does an episode 1 left part-way (a saved position in the episode Play opens), which counts nothing as finished yet resumes where it stopped (this applies on every theme API and without a theme). In the episode list, `data-state="resume"` goes only to the episode `data-next` marks, so one episode reads as where the viewer is up to. Each Play button also carries `data-season` and `data-season-episode` when the episode metadata knows them.

`resolvePresentation` merges a phone `factsLabels`, `factsFormat`, `synopsis` and `bar` over the shared ones key by key, like `sections` and `episodes`; a phone `buttons`, `factsKeys` or `infoKeys` list replaces the shared one whole.

### Styling hooks

Theme stylesheets target these attributes, never Tailwind classes: `[data-slot="…"]` for page regions and `[data-part="…"]` for components, with state attributes such as `[data-active]`, `[data-variant="…"]` and `[data-layout="…"]`. The list lives in `src/lib/themes/hooks.ts`; `hooks.test.ts` fails if the markup and the list drift apart, so a documented hook is only removed or renamed deliberately. Template nodes add their own `data-part` names (`part` in a template).

Never give `watch.stage` or its ancestors a background: the video is drawn behind the page, and the app pins that path transparent with inline `!important`.

A horizontal scroller made in theme CSS must pair `overflow-x: auto` with `overflow-y: hidden`; the client clamps row tracks and template `nowrap` rows itself.

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
| `data-past` | `hero.dot` | present on the markers of slides before the current one |
| `data-variant` | `nav.item` | `menu` (the Categories menu button; `data-active` while it is open) |
| `data-dest` | `nav.item` (every bar, rail, drawer and panel), `home.header.action`, `button` (profile-header block buttons) | `home`, `schedule`, `downloads`, `watch`, `settings`, `search`, `trakt`, `letterboxd`, `library`; none on the Categories menu button. People reorder their destinations, so style one by `data-dest`, never by position (`:nth-child`) or link target |
| `data-chrome` | `<html>` (`:scope` in a theme stylesheet) | `shown`, `hidden`, `collapsed`: the phone scroll-chrome state (`shell.bottomNav.hide`, `threshold`, `idle`), also on pages that hide the bottom bar |
| `data-state` | `nav.bottom` | `shown`, `hidden`, `collapsed` (the same state as `data-chrome`) |
| `data-count` | `nav.bottom` | the number of destinations on the bar, Home included (also the `--nav-items` custom property) |
| `data-variant` | `nav.categories.link` | `genre` |
| `data-variant` | `home` | `offline`, `anilist`, `merged`, `catalog` |
| `data-variant` | `home.hero` | `template`, `phone`, `desktop` (the desktop banner is `detail.banner` on a series page) |
| `data-state` | `home.hero` | `loading` on the placeholder shown while the featured titles load |
| `data-state` | `hero.slide` | `leaving` on the outgoing artwork during a `fade` transition |
| `data-variant` | `hero.indicator` | `default`, `bars`, `dots`, `pills`, `counter` |
| `data-layout` | `row` | `carousel`, `grid` |
| `data-row`, `data-role` | `row` | the row's stable id; the role is the part after its `:` (the whole id when it has none) |
| `data-family` | `card` | `poster`, `search`, `continue`, `preview` |
| `data-state` | `card.overlay` | `resolving` while a Continue card looks up its source (also over a `continue` template) |
| `data-caption` | `block.latest-episodes` | `below`, `overlay` |
| `data-aired` | `block.item` (airing-today) | present once the episode has aired |
| `data-key` | `block.stat` | `episodes`, `titles` |
| `data-button` | `nav.bumper`, `hints.item`, `hints.glyph` | `a`, `b`, `x`, `y`, `l1`, `r1`, `l2`, `r2`, `start`, `select`; `l2r2` on `hints.item` |
| `data-family` | `hints.glyph` | `deck`, `xbox`, `playstation`, `nintendo` |
| `data-layout` | `detail` | `stack`, `split`, `overlay` |
| `data-variant` | `detail` | `phone`, `desktop` |
| `data-variant` | `detail.facts` | `table`, `cards`, `chips` (none for a template) |
| `data-variant` | `detail.countdown` | `compact`, `long`; API 4 `words`, `full`, `date` |
| `data-variant` | `detail.list-button` | `full` (the full-width button) |
| `data-action` | series page actions: `button`, `detail.action`, `detail.list-button` | `play`, `save`, `share`, `download` (`button`: every series Play button, Save, Share and the header's Download button); `trailer`, `more` (`detail.action`); `list` (`detail.list-button`, also inside the phone's More menu) |
| `data-state` | `detail.list-button` | `listed` while the title is on a tracker list |
| `data-state` | `button` with `data-action="save"` | `saved` while the title is saved on this device |
| `data-state` | `button` with `data-action="download"` (the header's Download E{n}) | the download of the episode it names, as on `episode.download`: `none` (a tap queues it), `queued`, `progress` (downloading or paused), `done`; `--download-progress` is the share downloaded ("42%") |
| `data-action` | a `studio` action of the `detail.header` or `detail.facts` template (API 4) | `studio` |
| `data-state` | `button` with `data-action="play"` (every series Play button) | `start` (nothing watched or opened yet, or offline without progress), `resume` (Play continues the series: an episode is finished, or one was opened here, which Play then opens, as Continue Watching does, or the episode Play opens has a saved position, such as an episode 1 left part-way) |
| `data-episode` | `button` with `data-action="play"` | the episode Play opens (`3`), for wording such as `content: "Resume E" attr(data-episode)` |
| `data-episode` | `button` with `data-action="download"` | the episode the header's Download names and queues (the one Play opens) |
| `data-season`, `data-season-episode` | `button` with `data-action="play"` | the season of the episode Play opens (`1`) and its number within that season (`3`), when the episode metadata knows them, so "Play S1 E3" (`content: "Play S" attr(data-season) " E" attr(data-season-episode)`) matches the episode cards' `episodeCode`; absent otherwise |
| `data-expanded` | `detail.actions` | present while More has unfolded Save, Share and Trailer (`detail.actions: "expand"`, phones) |
| `data-season-label` | `detail.section-title` of `data-section="episodes"` | the one season the list shows: `Season 1` for a TV, TV short or ONA title with no other season, `Specials` for an OVA or special; absent for a film, a title with other seasons (without a season picker, any prequel or sequel), or one the page cannot tell yet |
| `data-solid` | `detail.bar` | present once the artwork has scrolled under the bar |
| `data-expanded` | `detail.synopsis` | present while a phone synopsis is open: tapped open, or opened by its `detail.synopsis.more` button (`detail.synopsis` `more: "expand"`) |
| `data-pending` | `detail` | present while the series record loads (the page shows the tapped card's record and placeholders) |
| `data-art` | `detail.banner`, `detail.backdrop`, `hero.art` on a series page | `banner`, `keyart`, `poster` (API 4 `art: "portrait"`), `wash`, `pending`, `cover` (see the series page's header art) |
| `data-key` | `fact` | `format`, `episodes`, `status`, `aired`, `season`, `duration`, `studio`, `source`, `country`, `score`, `members`, `genres`, `progress`, `synonyms`; API 4 `year`, `ended`, `favourites`, `author`, `romaji`, `english`, `native` |
| `data-relation` | `relation` | the relation type in lower case, as the catalog names it (AniList: `sequel`, `prequel`, `side_story`, `parent`, `spin_off`, `alternative`, `adaptation`, `summary`, `character`, `source`, `compilation`, `contains`, `other`); `recommended` on a recommendation the Relations section holds (`sections.relations.recommended: "append"`) |
| `data-media` | `relation` | the kind of the related title: `anime`, `manga`, `novel` (a light novel) or `one-shot`; absent when the catalog does not say |
| `data-active` | `detail.rating.segment` | present on the steps the score fills (bar and stars), or on the chosen number (numbers) |
| `data-episode` | `detail.progress` | the episode the series Play button opens |
| `data-variant` | `episode` | `template`, `thumb`, `compact`, `number`, `row` |
| `data-filler` | `episode.continue` | present when that episode is a known filler |
| `data-variant` | `episodes.seasons` | `chips`, `posters`, `dropdown` |
| `data-active` | `season` | present on the title being viewed |
| `data-open` | `season.toggle` | present while the season list is open |
| `data-open` | `episodes.range` | present while its list is open |
| `data-variant` | `episodes.menu` | `more`, `range`, `seasons` |
| `data-control` | buttons in `episodes.menu` | `sort`, `layout`, `search`, `download`, `queue`; the chosen option is `data-active` |
| `data-variant` | `episodes.toolbar` | `bar`, `header` |
| `data-variant` | `episodes.sort` | `tabs`, `flip` |
| `data-dir` | `episodes.sort` | `asc` (oldest first), `desc` (newest first) |
| `data-layout` | `episodes.layout` | `cards`, `compact`, `grid` (the Appearance setting) |
| `data-active` | `episodes.search`, the options inside `episodes.sort` and `episodes.layout` | present while the search is open or the option is chosen |
| `data-state` | `episode` | `watched`, `partial` (started, not finished), `resume` (the episode the series Play button opens, the one `data-next` marks, while not started; no other episode carries it), `unwatched`, `unaired` |
| `data-next` | `episode` | present on the episode the series Play button opens |
| `data-filler` | `episode` | present on a known filler episode |
| `data-state` | `episode.download` | `none` (not downloaded, or failed: a press queues it again), `queued`, `progress` (downloading or paused), `done` |
| `data-rank` | `chip` (a tag of `detail.tags`, or of a reading page) | the tag's rank, a whole percent (`94`); its text is the tag's `chip.meta` |
| `data-layout` | `watch` | `full`, `docked` |
| `data-flow` | `watch` | `page` on a page-flow watch view (absent otherwise) |
| `data-block` | `watch.block` | `toolbar`, `info`, `episodes`, `comments` |
| `data-item` | `watch.toolbar.item`, `watch.toolbar.menu` | `server`, `episode`, `release`, `download` |
| `data-state` | `watch.toolbar.item` | `open`, `closed` |
| `data-state` | `watch.toolbar.option` | `active` on the current server, episode or release, or a finished download |
| `data-variant` | `watch.episodes` | `right`, `below` |
| `data-variant` | `watch.comments` | `inline`, `sheet` |
| `data-variant` | `home.main` | `lead` on the full-width rows above the side column (`layout.asideStart`) |
| `data-variant` | `search` | `anilist-scope`, `anilist`, `merged`, `catalog` |
| `data-variant` | `search.title` | `explore` while a genre, studio or voice actor is being explored (the heading is then shown) |
| `data-filter` | `search.filter` | `genres`, `format`, `status`, `season`, `year`, `sort`, `advanced`, `clear`; `type`, `genre`, `source`, `source-filters` on other catalogs |
| `data-active` | `search.filter` | present while the filter is set (a selection, a value other than the default) |
| `data-variant` | `search.grid` | `grid`, `list` (the browse layout) |
| `data-state` | `search.grid` | `loading` on the placeholder grid shown while more results load |
| `data-variant` | `button` | `primary`, `secondary`, `ghost`, `icon` |
| `data-variant` | `tabs` | `underline`, `pills`, `segmented`, `bar` |
| `data-tab` | `tab` (series page) | `overview`, `episodes`, `relations`, `characters`, `recommended`, `information` (API 4, when `sections.tabs` lists it) |
| `data-section` | `detail.section` | `overview`, `episodes`, `relations`, `characters`, `recommended`, `information` (API 4, when `sections.tabs` lists it) |

#### Shell

| Hook | Kind | What | States |
|---|---|---|---|
| `page` | slot | The routed page content (the app's `<main>`). |  |
| `nav.side` | slot | The side navigation rail. |  |
| `nav.top` | slot | The top navigation bar (`shell.nav: "top"`). |  |
| `nav.bottom` | slot | The bottom tab bar (phones, or `shell.nav: "bottom"`). `data-state` is the scroll-chrome state, the same as `data-chrome` on `<html>`. `data-count` and the `--nav-items` custom property are the number of destinations on it, Home included, so a pill can be sized to them (`width: calc(var(--nav-items) * 56px)`) without counting links. | `data-state`, `data-count` |
| `nav.item` | part | A navigation destination link, or the Categories menu button (`data-variant="menu"`). `data-dest` names the destination on every bar, rail, drawer and panel. | `data-active`, `data-variant`, `data-dest` |
| `nav.item.icon` | part | The icon of a navigation destination. |  |
| `nav.item.label` | part | The label of a navigation destination. |  |
| `search.field` | part | A search input: the global search overlay, the theme top bar's search field, or the Search page's own field. |  |
| `search.suggestions` | part | The live results panel under the top bar's search field while typing. |  |
| `search.suggestion` | part | One live result; the keyboard-highlighted one has `data-active`. | `data-active` |
| `search.suggestion.poster` | part | A live result's poster. |  |
| `search.suggestion.title` | part | A live result's title. |  |
| `search.suggestion.meta` | part | The format, episode count, year and status line of a live result. |  |
| `search.suggestion.all` | part | The "View all results" link at the end of the panel. |  |
| `nav.menu` | part | The top bar menu button that opens the drawer. |  |
| `nav.bumper` | part | The L1 or R1 glyph at either end of the top bar's tabs (`shell.top.bumpers`, pad in use). | `data-button` |
| `nav.drawer` | slot | The side drawer of destinations (top bar `menu: "drawer"`); items are `nav.item`. |  |
| `nav.panel` | slot | The pinned menu panel down the left (top bar `menu: "side"`); items are `nav.item`. |  |
| `nav.categories` | slot | The Categories menu panel (top bar `categories`). |  |
| `nav.categories.heading` | part | The Genres heading in the Categories menu. |  |
| `nav.categories.link` | part | A Categories menu link; genre links carry `data-variant="genre"`. | `data-variant` |
| `hints.glyph` | part | A controller button's printed label: round for face buttons, a pill for bumpers, triggers and the menu buttons. | `data-button`, `data-family` |
| `hints` | slot | The controller button-hint bar along the bottom (`shell.hints`). |  |
| `hints.item` | part | One prompt: its glyph (two for the page-tab triggers, `data-button="l2r2"`) and label. | `data-button` |
| `hints.label` | part | What the button does for the focused element. |  |
| `home.header.action` | part | A destination icon in the phone Home app bar (`home.header`), one per destination placed at the top; `data-dest` names it. | `data-dest` |
| `home.header.actions` | part | The row holding the `home.header.action` icons. |  |

#### Home

| Hook | Kind | What | States |
|---|---|---|---|
| `home` | slot | The Home page. | `data-variant` |
| `home.hero` | slot | The featured banner on Home. While its titles load, a placeholder with `data-state="loading"` holds its place, with the `data-variant` of the hero that replaces it (`template`, `phone` or `desktop`) and `.skeloader` shimmer inside. | `data-variant`, `data-state` |
| `hero.slide` | part | The current slide (the artwork layer). During a `fade` transition the outgoing artwork stays under it as a second `hero.slide` with `data-state="leaving"`. | `data-state` |
| `hero.art` | part | The slide artwork image. On a series page `data-art` names the artwork it shows. | `data-art` |
| `hero.scrim` | part | A gradient over the artwork. |  |
| `hero.logo` | part | The title logo, when the show has one. |  |
| `hero.title` | part | The text title, when there is no logo. |  |
| `hero.meta` | part | The facts line (format, episodes, score, status). |  |
| `hero.synopsis` | part | The description (desktop). |  |
| `hero.actions` | part | The Watch, Details and Favorite buttons. |  |
| `hero.indicator` | part | The slide marker row. | `data-variant` |
| `hero.dot` | part | One slide marker. | `data-active`, `data-past` |
| `hero.dot.track` | part | The drawn shape of a slide marker (its bar, dot or pill). |  |
| `hero.dot.fill` | part | The timed fill inside a bar marker (indicator style `bars`). |  |
| `hero.counter` | part | The `n / N` counter (indicator style `counter`). |  |
| `row` | slot | A titled row or grid of cards, on Home and elsewhere. Home rows carry their stable id and role. | `data-row`, `data-role`, `data-layout` |
| `row.header` | part | The row heading bar. |  |
| `row.title` | part | The row title. |  |
| `row.more` | part | The row's view-more link. Continue Watching has one (to the Library) only when the theme sets `heading.viewMore` on that row itself. |  |
| `row.track` | part | The scrolling track or grid holding the cards. |  |
| `row.skeleton` | part | A placeholder card in a Home row while the row loads (`.skeloader`): posters, or 16:9 cards on Continue Watching. |  |
| `row.caption` | part | The focus caption line under a row (`caption: "focus"`, pad in use). |  |
| `row.caption.title` | part | The focused card's full title in the caption. |  |
| `row.caption.meta` | part | The focused card's detail line: episode, episode title and time left on Continue Watching; format, season and episodes on posters. |  |
| `row.empty` | part | The empty state inside the Continue Watching track while there is nothing to continue: only with `empty: "shown"` on that row (`rows.byId.continue` or its id); izumi's own Home leaves the row out instead. |  |
| `row.empty.text` | part | The line of the Continue Watching empty state ("Nothing to continue yet"). |  |
| `row.empty.action` | part | The Browse link of the Continue Watching empty state (opens Search). |  |

#### Home blocks

| Hook | Kind | What | States |
|---|---|---|---|
| `home.header` | slot | The phone Home app bar: the wordmark and the top icons. |  |
| `home.main` | slot | The main column of Home; the rows above the side column (`layout.asideStart`) are a second one with `data-variant="lead"`. | `data-variant` |
| `home.aside` | slot | The side column of Home, holding blocks placed in the aside. |  |
| `pagination` | part | Page controls under a block: numbered pages or a Load more button. |  |
| `page-number` | part | A page button: a numbered page under a block, Prev/Next under the episode list, or an entry of the episode range picker. | `data-active` |
| `block.title` | part | A block heading. |  |
| `block.genre-chips` | slot | Genre shortcuts: an All chip and one chip per genre (each a `chip`). |  |
| `block.latest-episodes` | slot | Newly aired episodes as a grid of stills. Items reuse `episode.still`, `episode.number`, `card.title` and `card.meta`. `data-caption` is `below` or `overlay`. | `data-caption` |
| `block.item` | part | One entry in a block (an episode, a poster, a ranked title or an airing). | `data-aired` |
| `block.tabbed-grid` | slot | A tab strip (`tabs`) over a poster grid; each poster is a `block.item` holding a `card`. |  |
| `block.ranked-list` | slot | A numbered top list; each entry is a `block.item` with `card.art`, `card.title` and `card.meta`. |  |
| `block.rank` | part | The rank number of a ranked-list entry. |  |
| `block.profile-header` | slot | The profile banner with the viewer's name, watch stats and shortcut buttons (`button`). |  |
| `block.banner` | part | The profile banner image. |  |
| `block.profile` | part | The avatar, name and stats of a profile header, as one group (hide it to keep only the banner and buttons). |  |
| `block.avatar` | part | The profile avatar (an image, or the first letter of the name). |  |
| `block.button.art` | part | The artwork under a profile-header button's label (`art`): the banner of one of the viewer's own titles. |  |
| `block.name` | part | The profile name. |  |
| `block.stat` | part | One watch statistic, its value then its label: episodes, then titles (`data-key`). izumi shows both on one line; the later one's `::before` draws the dot between them. | `data-key` |
| `block.stat.value` | part | The number of a watch statistic ("26"). |  |
| `block.stat.label` | part | The word of a watch statistic ("episodes"). |  |
| `block.scrim` | part | The gradient over the profile banner. |  |
| `block.airing-today` | slot | Today's airings in time order; each entry is a `block.item` with `airing.poster`, `airing.title` and `airing.time`, and `data-aired` once it has aired. |  |
| `block.more` | part | A block's link to its full page (the schedule, on airing-today). |  |
| `block.clock` | part | The date (`block.clock.date`) and live clock (`block.clock.time`) under an airing-today heading. |  |
| `block.clock.date` | part | Today's date in an airing-today clock. |  |
| `block.clock.time` | part | The live time in an airing-today clock. |  |
| `airing.poster` | part | The poster of an airing-today entry. |  |
| `airing.title` | part | The series title of an airing-today entry. |  |
| `airing.time` | part | The local airing time of an airing-today entry: a tick once aired, a clock before. |  |

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
| `card.overlay` | part | The hover or play overlay on the artwork. A Continue card shows it with `data-state="resolving"` while it looks up its source; over a `continue` template it covers the whole card and exists only then. | `data-state` |

#### Series page

| Hook | Kind | What | States |
|---|---|---|---|
| `detail` | slot | The series page. `data-pending` while its record loads: the page is drawn from the card the user tapped, with placeholders (`.skeloader`) inside the parts it cannot fill yet. | `data-layout`, `data-variant`, `data-pending` |
| `detail.banner` | slot | The artwork area at the top of the series page; `data-art` names the artwork it shows. | `data-art` |
| `detail.poster` | part | The cover image. |  |
| `detail.column` | slot | The left column headed by the poster (`detail.column: "poster"`): the trailer button, the countdown and the facts. |  |
| `detail.trailer` | part | The labelled Watch Trailer button in the poster column. |  |
| `detail.title` | part | The title. |  |
| `detail.logo` | part | The title logo inside `detail.title` (`detail.title: "logo"`). |  |
| `detail.backdrop` | part | The header artwork of the series page (the phone band, the backdrop of an overlay page): the banner or key art, or the portrait poster (`detail.art: "portrait"`). On a title with none of them, the cover: shown, sharp, with `detail.artFallback: "cover"`, else hidden behind a wash of its colour until a theme shows it (`data-art="cover"`). | `data-art` |
| `detail.body` | part | The text column over the artwork of an overlay series page. |  |
| `detail.studio` | part | The studio line of the desktop overlay page. |  |
| `detail.rating` | part | The "Your rating" row (your score), on every layout once it shows (Settings → Interface). On a phone overlay page it is a `display: contents` box inside the row's spacing. |  |
| `detail.rating.label` | part | The "Your rating" label of `detail.rating`. |  |
| `detail.rating.value` | part | The readout of `detail.rating`: "8/10 · Very Good", or "Not rated". |  |
| `detail.rating.segment` | part | One step of `detail.rating` (a bar segment, a star or a number); `data-active` on the steps the score fills (the chosen number in the numbers style). | `data-active` |
| `detail.alt-title` | part | The native or romaji title. |  |
| `detail.header` | part | The theme template under the title (`detail.header`). |  |
| `detail.meta` | part | The facts line. |  |
| `detail.facts` | part | The facts: a theme template (stacked and split layouts, on phones and desktop) or, with `detail.factsStyle`, a table, cards or chips. | `data-variant` |
| `fact` | part | One fact: an entry of the details grid, or a table row, card or chip of `detail.facts`. | `data-key` |
| `fact.label` | part | A details entry label. |  |
| `fact.value` | part | A details entry value. |  |
| `detail.genres` | part | The genre chips (phone). |  |
| `detail.synopsis` | part | The description. `data-expanded` while a phone synopsis shows its whole text. | `data-expanded` |
| `detail.actions` | part | The action buttons row. With `detail.actions: "expand"` (phones) `data-expanded` while More has unfolded Save, Share and Trailer. | `data-expanded` |
| `detail.list-button` | part | The tracker list-status button; `data-state="listed"` while the title is on a tracker list. | `data-variant`, `data-action`, `data-state` |
| `detail.action` | part | A series action that is not a `button`: Trailer, and on phones More (whose menu holds the list button and tracker links). | `data-action` |
| `detail.airing` | part | The release status of upcoming episodes (sub and dub timing, delays). |  |
| `detail.countdown` | part | The next-episode countdown (`detail.countdown`): with the facts, or at the top of the episode list (`countdownAt`). | `data-variant` |
| `detail.countdown.label` | part | The caption of a `words`, `full` or `date` countdown ("Episode 13 airs in", "Next episode 13"). |  |
| `detail.countdown.time` | part | The time in a countdown: "2d 21h", "2 days 3 hours", the ticking count or the airing date. |  |
| `detail.episodes` | slot | The episode list. |  |
| `detail.relations` | slot | Related titles. |  |
| `relation.type` | part | The relation above a related title ("sequel", "side story"; "recommended" on a recommendation the Relations section holds). |  |
| `detail.characters` | slot | Characters and voice actors. |  |
| `detail.staff` | slot | Staff credits. |  |
| `detail.bar` | slot | The floating top bar of the phone series page (back, a Home link with `detail.bar.home`, and once scrolled the title). | `data-solid` |
| `detail.byline` | part | The phone studio · source · members line. |  |
| `person` | part | One character or staff credit. |  |
| `person.photo` | part | The credit's picture. |  |
| `person.name` | part | The character or staff name. |  |
| `person.role` | part | The character's role or the staff job. |  |
| `detail.heading` | part | The heading of the characters ("Characters & Japanese voices") and of the staff. |  |
| `detail.track` | part | The grid holding the character credits, the staff credits or the recommended titles; a stylesheet can make it a row. |  |
| `detail.recommended` | slot | The recommended titles (also `detail.track`); each title is a `card`. |  |
| `person.voice` | part | A character's voice actor, a link to their profile when they have one. |  |
| `person.voice.photo` | part | The voice actor's picture. |  |
| `person.voice.name` | part | The voice actor's name. |  |
| `person.voice.role` | part | The "Japanese voice" label under the voice actor. |  |
| `detail.section` | slot | A titled section outside the tab strip: every section with `sections.mode: "stack"`, or a section without a tab inside Overview. | `data-section` |
| `detail.section-title` | part | The heading of a `detail.section`. On the Episodes section, `data-season-label` names the one season its list shows ("Season 1", "Specials"), when it can be told. | `data-season-label` |
| `detail.back` | part | The Back button in `detail.bar`. |  |
| `detail.bar.title` | part | The series title `detail.bar` shows once the artwork has scrolled under it; with `detail.bar.title: "logo"` it holds the title logo (`detail.bar.logo`) when the title has one. |  |
| `detail.bar.scrim` | part | The gradient behind `detail.bar` while it sits over the artwork. |  |
| `detail.buttons` | part | The phone header buttons in the theme's order (`detail.buttons`): Play, the full-width list button and Download. Only with that key; without it they sit straight in the page's column, as before. |  |
| `detail.lead` | part | The template at the start of the phone actions row (`detail.actionsLead`), taking its free width. |  |
| `fact.suffix` | part | Text after a fact value: " / 10" after a `ten-of` score, " / 26" (or " / ?") after an `aired-of` episode count (`detail.factsFormat`). |  |
| `detail.info` | part | The phone Information block (the facts grid of `fact` entries): inside Overview, or a section of its own when `sections.tabs` lists `information`. |  |
| `detail.tags` | part | The phone Overview's Themes block; every tag is a `chip` (spoiler tags too) with its rank in `data-rank` and a hidden `chip.meta` ("94%"). |  |
| `detail.synonyms` | part | The phone Overview's Alternative titles block; each title is a `chip`, inline, every one after the first drawing " · " in its `::before` (`content: none` drops it). |  |
| `detail.block-title` | part | The heading of a block inside the phone Overview (Synopsis, Information, Themes, Alternative titles). |  |
| `relation` | part | One related title (its `relation.type` and its card); `data-relation` is the relation type (`recommended` on a recommendation `sections.relations` adds), `data-media` the kind of title (`anime`, `manga`, `novel`, `one-shot`). | `data-relation`, `data-media` |
| `detail.synopsis.more` | part | The "more" control after a clamped phone synopsis (`detail.synopsis`); "Show less" while the text is open. |  |
| `detail.content` | part | The phone page's column under the artwork: the title row, the facts, the header buttons, the actions and the sections (on an overlay page, everything after the artwork). |  |
| `detail.head` | part | The phone title row: the poster beside the alternative title, the title and the header template, pulled up into the artwork band. |  |
| `detail.overview` | part | The phone Overview's own content: the facts (with `sections.info: "overview"`) and the Synopsis, Information, Themes and Alternative titles blocks. |  |
| `detail.banner.fade` | part | The gradient that fades the phone artwork into the page: the bottom of the band, or the scrim under the text of an overlay page. |  |
| `detail.airing.wrap` | part | The box holding `detail.airing` and its spacing (under the phone facts; on desktop, where the release timing leaves the episode toolbar). Hide it, not `detail.airing`, to drop the release timing with its margin. |  |
| `detail.menu` | part | The phone More menu (the list button, "Download episodes" beside a header Download, and the tracker links), open while the More action (`detail.action` with `data-action="more"`) is expanded; with `detail.actions: "expand"` a tap on More while the row is unfolded opens it. |  |
| `detail.home` | part | The Home link after Back in `detail.bar` (`detail.bar.home`). |  |
| `detail.bar.logo` | part | The title logo inside `detail.bar.title` once the artwork has scrolled under the bar (`detail.bar.title: "logo"`). |  |
| `detail.progress` | part | The phone series progress row under the header buttons (`detail.progress: "row"`), once the series is under way. `data-episode` is the episode Play opens and `--progress` the share watched ("31%"). | `data-episode` |
| `detail.progress.label` | part | The progress row's "Episode 4 of 12". |  |
| `detail.progress.value` | part | The share of the series watched ("31%"). |  |
| `detail.progress.meter` | part | The progress row's track; its child `span` is the fill. |  |

#### Episodes

| Hook | Kind | What | States |
|---|---|---|---|
| `episode` | part | One episode: a card, a thumbnail row, a compact row or a number tile. | `data-variant`, `data-state`, `data-next`, `data-filler` |
| `episode.still` | part | The episode thumbnail. |  |
| `episode.number` | part | The episode number. |  |
| `episode.title` | part | The episode title. |  |
| `episode.meta` | part | The line under an episode card title: the episode label, the airing countdown or Not aired. |  |
| `episode.download` | part | An episode's own download button, the last control inside every episode card and row but the number tiles (`detail.episodes.download: "button"`; not offline, not in select mode, disabled before the episode airs). A press queues the episode with the Settings → Downloads defaults, or opens Downloads once it is queued, downloading or saved; it never plays the episode. `data-state` is `none`, `queued`, `progress` (downloading or paused) or `done`, and `--download-progress` the share downloaded ("42%"). | `data-state` |
| `episodes.track` | part | The scrolling row holding the episode cards of a `carousel` arrangement. It opens with the episode the series Play button starts as its first card. |  |
| `episodes.grid` | part | The grid holding the episode cards (the cards layout, or a theme's `grid` arrangement); a stylesheet sets its columns. |  |
| `episodes.toolbar` | slot | The episode controls: izumi's own bar, or the theme's bar or heading row (`detail.episodes.toolbar`). | `data-variant` |
| `episodes.sort` | part | The order control: Oldest and Newest options (`tabs`, the chosen one `data-active`) or one toggle naming the current order (`flip`). | `data-variant`, `data-dir` |
| `episodes.search` | part | The episode search: the field (holding `input`) or the button that opens it. | `data-active` |
| `episodes.layout` | part | The phone cards/numbers switch: izumi's own bar shows both options (the chosen one `data-active`); a theme's toolbar shows one toggle to the other layout. | `data-layout` |
| `episodes.download` | part | The button that starts picking episodes to download. |  |
| `episodes.queue` | part | The button that adds the next episode to the episode queue. |  |
| `episodes.ranges` | part | The row of range chips above the list (`paging: "ranges"`); each range is a `chip`, the current one `data-active` and scrolled to the middle. The list opens on the range holding the episode the series Play button starts. |  |
| `episodes.pager` | part | The Prev/Next row under the list; its buttons are `page-number`. |  |
| `episodes.empty` | part | The line shown when a search matches no episode. |  |
| `episodes.heading` | part | The "Episodes" heading of a heading-row toolbar (`toolbar: "header"`). |  |
| `episodes.count` | part | The episode count beside the heading. |  |
| `episodes.range` | part | The range picker button in the toolbar (`paging: "dropdown"`). | `data-open` |
| `episodes.more` | part | The overflow button holding the controls the toolbar does not show. |  |
| `episodes.menu` | part | A menu opened from the episode controls: the overflow menu (a popover; a sheet on phones), the range list or the season list. It renders outside `detail.episodes`, at the end of the page, so select it directly rather than inside that slot. | `data-variant` |
| `episodes.seasons` | slot | The season picker above the episodes (`detail.episodes.seasons`); a `dropdown` in a heading-row toolbar takes the place of its heading. Its dropdown list is `episodes.menu` with `data-variant="seasons"`, which renders outside `detail.episodes`. | `data-variant` |
| `season` | part | One season: a chip, a poster or a list entry that opens that title. | `data-active` |
| `season.art` | part | The season cover (`posters`). |  |
| `season.label` | part | The "Season N" label. |  |
| `season.year` | part | The season's year (`chips` and the dropdown list). |  |
| `season.toggle` | part | The dropdown button showing the current season (`dropdown`). | `data-open` |
| `episode.continue` | part | The Continue card at the top of the episodes (`detail.continue: "card"`). | `data-filler` |
| `episode.continue.label` | part | The card's "Continue: Episode N" line ("Play: Episode N" before the series is started). |  |
| `episode.continue.title` | part | The card's episode title. |  |

#### Player

| Hook | Kind | What | States |
|---|---|---|---|
| `watch` | slot | The player area; the scroller of a page-flow watch view with the episodes below the video. | `data-layout`, `data-flow` |
| `watch.stage` | slot | The video frame. It and its ancestors never paint a background: the video is drawn behind the page. |  |
| `watch.page` | slot | The column of a page-flow watch view: the video frame, then the blocks under it (the scroller beside a side rail). An ancestor of the frame, so it never paints a background. |  |
| `watch.block` | part | One block under a page-flow video, in `dock.below` order (beside a side rail, the discussion). | `data-block` |
| `watch.toolbar` | slot | The row of dropdowns under a docked video (`dock.below` `toolbar`). |  |
| `watch.toolbar.item` | part | One dropdown button: the server, the episode, the release or the download. | `data-item`, `data-state` |
| `watch.toolbar.menu` | part | An open dropdown menu. | `data-item` |
| `watch.toolbar.option` | part | A menu entry; the current one is `data-state="active"`. | `data-state` |
| `watch.info` | slot | The info block under a docked video (`dock.below` `info`). |  |
| `watch.info.poster` | part | The poster, linking to the series page. |  |
| `watch.info.title` | part | "Title - 12", the title linking to the series page. |  |
| `watch.info.meta` | part | The format, episode count and airing state line. |  |
| `watch.info.season` | part | The season line. |  |
| `watch.rail` | slot | The rail beside or below a docked player. |  |
| `watch.episodes` | slot | The docked episode list or grid. | `data-variant` |
| `watch.servers` | part | The server switcher. |  |
| `watch.comments` | slot | The episode discussion (inline under a docked player, or the sheet). | `data-variant` |
| `comments.header` | part | The discussion heading row ("Discussion · Ep 12"). |  |
| `comments.tabs` | part | The row of discussion sources (All, then each source found). |  |
| `comments.tab` | part | One discussion source. | `data-active` |
| `player.controls` | slot | The player controls layer. |  |
| `player.seekbar` | part | The seek bar. |  |
| `player.title` | part | The playing title. |  |

#### Search, schedule and library

| Hook | Kind | What | States |
|---|---|---|---|
| `search` | slot | The search page. | `data-variant` |
| `search.header` | slot | The Search page header: the title and the filter bar; on another catalog's page also the streaming service; on the all-catalogs page the field (or the chosen catalog's filter bar) under the catalog chips. It is a `display: contents` box, so the parts inside lay out (and stick) as they always did, until a theme gives it one: `display: block; position: sticky; top: 0` pins the whole header, and `:scope[data-chrome="hidden"]` can slide it away. |  |
| `search.title` | part | The Search page heading: "Search" in the app language, visually hidden (`sr-only`) until a theme shows it, or with `data-variant="explore"` the genre, studio or voice actor being explored, shown. On the all-catalogs page it is the visible "Search" heading. | `data-variant` |
| `search.filters` | part | The search filter bar: the `search.field`, then the `search.filter` controls. |  |
| `search.filter` | part | One control of the search filter bar, named by `data-filter` (`genres`, `format`, `status`, `season`, `year`, `sort`, `advanced`, `clear`; on other catalogs `type`, `genre`, `source`, `source-filters`), with `data-active` while it is set. | `data-filter`, `data-active` |
| `search.grid` | part | The grid holding the search results (`data-variant` `grid` or `list`); a stylesheet sets its gaps and columns. The placeholders shown while more results load are a second one with `data-state="loading"`. | `data-variant`, `data-state` |
| `search.results` | slot | The search results. |  |
| `schedule` | slot | The airing schedule page. |  |
| `schedule.day` | part | One day of airings: a day of the week agenda, or the selected day. |  |
| `schedule.item` | part | One airing entry. |  |
| `library` | slot | The library page. |  |
| `library.tabs` | part | The library section tabs. |  |
| `library.grid` | slot | The library card grid. |  |

The hidden `search.title` is shown by undoing its visually hidden box, for example `[data-part="search.title"]:not([data-variant]) { position: static; width: auto; height: auto; margin: 0 0 12px; overflow: visible; clip: auto; white-space: normal; }`; its text follows the app language.

#### Primitives

| Hook | Kind | What | States |
|---|---|---|---|
| `button` | part | A button. Series page actions carry `data-action` (Save also `data-state="saved"`; every Play button `data-state` `start` or `resume`, the episode it opens in `data-episode` and, when the episode metadata knows it, that episode's season in `data-season` and its number within the season in `data-season-episode`; the header's Download `data-state` `none`, `queued`, `progress` or `done` and the episode it queues in `data-episode`); profile-header shortcuts carry their destination in `data-dest`. | `data-variant`, `data-action`, `data-dest`, `data-state`, `data-episode`, `data-season`, `data-season-episode` |
| `chip` | part | A chip or pill (genre, tag, alternative title, filter, scope, episode range). A tag carries its rank in `data-rank`. | `data-active`, `data-rank` |
| `chip.meta` | part | Extra text at the end of a chip, hidden (`display: none`) until a theme shows it: a tag's rank ("94%"). Where izumi prints the rank itself (reading pages), it shows after " · ". |  |
| `input` | part | A text input. |  |
| `badge` | part | A small label on an item (for example an episode rating). |  |
| `tabs` | part | A tab strip. | `data-variant` |
| `tab` | part | One tab. Series page tabs carry their section id. | `data-active`, `data-tab` |

### Platforms

A catalog listing can carry `platforms` (`desktop`, `phone`, primary first). The gallery shows "Phone only", "Desktop only", "Designed for phones · desktop layout included" or "Desktop & phone" (`platformLabel` in `packages.ts`) and offers an All / Desktop / Phone filter; a listing without the field serves both. The label replaces the old fixed "Desktop & mobile" text, which was wrong for packages an older client could not render.

### What themes do not own

Home row order and visibility, navigation destinations, episode list density, skip rules, subtitle file style, recovery chrome (Theme Studio and the installation preview bar keep independent palettes), and native/TV shells beyond the tokens already applied.

ZIP archives, remote fonts and images, JavaScript and native plugins are not supported. Stylesheets are API 3 only and sanitised as described above. Pack-provided fonts and images are planned with packs.

Theme Studio's Layout tab exposes common controls, discovers rows on the current page, shows a template outline, and provides a validated JSON editor for component templates. The existing home editor still owns row content, visibility and order.

## Authoring and publishing

The catalog repository owns the [format reference](https://github.com/nickEatsBread/izumi-themes/blob/main/docs/FORMAT.md), JSON editor schemas, example packages, listing metadata and CI. Authors can publish a package anywhere with public HTTPS access; a catalog listing is optional. Browser builds need the host to allow cross-origin requests. Raw GitHub URLs work for both the browser and native client.

Packages declare `app: "izumi"`, `kind: "theme-package"`, `schemaVersion: 1`, `themeApi` (1–4, the lowest API the package uses), a stable ID, numeric `major.minor.patch` version, author metadata and `design`. The `design` contains appearance values and optional `presentation`. Packages omit local saved-theme IDs and timestamps. Existing personal exports are normalized into an installable shared theme. The `shared.*` ID namespace is reserved for these client-created imports; external packages and catalog listings cannot claim it. Saved installations and their rollback records retain valid shared IDs when loaded.

Templates compose `stack`, `row`, `grid`, `overlay`, `text`, `artwork` and `action` nodes. Text and artwork bind to a host display model. Hero actions call the client's existing play, details, favorite, list (the list editor), trailer, share and slide-navigation callbacks when the host provides them. Cards keep their host-owned detail or play links. Field types are fixed across hosts: `rankPosition`, `score` (0-100), `duration` (minutes), `episodeNumber` and `progress` (0-100) are numbers, as are `nextEpisode`, `slide`, `slides` and `episodesAired` (API 3) and `episodesWatched` (API 4); every other field is a string. Artwork may be `poster`, `backdrop`, `logo` or `still` (`keyart` from API 3, `posterHd` from API 4). Text nodes render `score` and `progress` as a percentage such as `78%`, and `duration` as `24m`. Optional conditions check presence for any field; `atMost` is accepted only for the numeric fields. Hosts bind different fields: a card condition on a missing field simply never matches.

Style values are a bounded allowlist. There are no arbitrary selectors, URLs, HTML or executable expressions. Text is escaped, artwork comes from the host media record, and templates are confined to their component. A template is limited to 96 nodes and eight nesting levels. Card, rank and episode templates cannot nest interactive controls inside a host link. Theme Studio and installation-preview recovery controls keep independent styling.

`src/lib/themes/presentation.ts` is the client contract. Its pure validator is mirrored in the catalog's `scripts/presentation.ts`; keep them aligned when extending the API. New keys are added under the next API number (the `api2`, `api3` and `api4` gates in the parsers; `parseThemeBlock` in `block-schema.ts`, mirrored the same way, takes the API too), so an older client refuses a package it cannot render instead of half-parsing it, while packages declaring the older API keep validating exactly as before.

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
| Series sections, episode toolbar, paging and seasons | `src/lib/detail/sections.ts`, `src/lib/components/detail/toolbar-plan.ts`, `src/lib/components/detail/episode-ranges.ts`, `src/lib/anilist/seasons.ts` |
| Series facts, Play's resume episode and the related titles | `src/lib/detail/facts.ts`, `src/lib/detail/resume.ts` (with `historyResumeProgress` in `src/lib/player/history.ts`, shared with Continue Watching), `src/lib/detail/relations.ts` |
| Host display-model bindings | `src/lib/themes/host-model.ts` |
| Package, release and catalog parsing | `src/lib/themes/packages.ts` |
| Bounded downloads, integrity and cache | `src/lib/themes/catalog.ts` |
| Install, preview, merge and rollback | `src/lib/themes/installed.ts` |
| Active presentation store and navigation placement | `src/lib/themes/runtime.ts` |
| Video insets and the docked stage | `src/lib/player/insets.ts`, `PlayerOverlay.svelte`, `DockEpisodes.svelte`, `player_set_inset` in `src-tauri/src/lib.rs` |
| Document chrome (density, true black, seekbar vars) | `src/lib/theme.ts`, `src/app.css` |
| Declarative renderer and layout editor | `src/lib/components/themes/` |
| Gallery and installed library | `src/routes/app/settings/themes/+page.svelte` |
| Host integration | `Hero.svelte` (its `list` action opens `MediaListSheet.svelte`), `HomeRowFrame.svelte`, `Carousel.svelte`, `SmallCard.svelte`, `ContinueCard.svelte`, `SearchResults.svelte`, `AnimeDetail.svelte`, `Tabs.svelte`, `EpisodeCard.svelte`, `Sidebar.svelte`, `BottomNav.svelte`, `Seekbar.svelte`, `EpisodeList.svelte`, `EpisodeToolbar.svelte`, `SeasonPicker.svelte`, `FactList.svelte`, `RichMetadata.svelte` |

## Validation

Focused tests cover package validation, rejected styles and versions, bounded downloads, checksums, cached listings, stable row overrides, page composition helpers, card-family resolution, coverage labels, preview cancellation, personal edits through updates, rollback, origin conflicts, reinstalling a removed design and failed-install recovery. Existing Theme Studio, hero, carousel and series-page navigation checks are included in the verification run.

Browser QA uses the real gallery and public package links. Responsive checks cover desktop and a 390px viewport, including a split series page collapsing the episode rail below the info column. Native player behavior and physical mobile/TV deployment require their normal platform test environments.

The catalog's preview images are screenshots of this client: `scripts/preview/` in izumi-themes serves the dev build to headless Chromium behind a Tauri IPC shim, answers the AniList and episode-metadata requests from a fixture catalogue with generated artwork, seeds the theme and a few plays into local storage, and captures Home (desktop themes) or a two-phone composite (phone themes). Re-render after changing a renderer or a package.
