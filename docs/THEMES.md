# Installable themes

Settings → Themes opens the community catalog at [izumi-themes](https://github.com/nickEatsBread/izumi-themes). Users can browse, search, inspect a theme, preview it on their client, and install it. **Add from link** accepts a public HTTPS package or release descriptor, including GitHub file links. **Import file** accepts JSON packages and existing Theme Studio exports.

The Theme Studio button inside Themes opens the live design editor. Themes is the single settings-menu entry for browsing and customizing themes; the editor remains directly searchable.

The shipped appearance remains the default. Cinema demonstrates an optional top-ten rank treatment; Meridian replaces the hero composition and media cards; Ink hides the hero and uses wrapping rows. Installing a theme is an explicit choice. No appearance update is applied automatically.

## Theme API 1 coverage

API 1 stays additive: existing packages remain valid. New keys are optional.

Coverage chips in Theme Studio (`Home`, `Shell`, `Details`, `Player`, or `Full`) reflect the slots a draft actually uses.

### Appearance

Semantic colors, font family and scale, corner radius, backdrop and glass effects.

### Chrome

- Information density: `compact`, `comfortable`, or `large`.
- Hide poster titles (`hideCardLabels`).
- True black canvas on dark palettes (`trueBlack`).
- Navigation placement: side rail, top bar, or bottom bar. Phones keep the bottom bar. Destination order stays in Settings → Navigation.
- Compact shell padding.

### Home

- Hero: visibility, desktop/mobile height, rotation interval, rank badge visibility, an optional badge template and an optional entire hero template.
- Rows: carousel or wrapping grid, card width and spacing, row spacing, artwork shape and corners (these style the default cover; a custom card template owns its own shape), heading size, and optional media-card templates.
- Per-row overrides follow stable row identities, so reordering a row does not move its visual settings to another row. Resolution is global defaults → semantic row role → exact scoped row ID. For example, `continue` can override every Continue Watching row and `anime:continue` can target one catalog.

### Cards

Optional templates for three families: `poster` (ordinary tiles), `continue` (resume cards), and `search` (search grids). A home-row `card` template still wins on that row. Search falls back to the poster family when it has no template of its own.

### Series page

- Page composition: stacked tabs (`stack`) or a split info + episode rail (`split`).
- Episode placement: inside the Episodes tab, a right-hand rail, or below the series info. A right-hand rail becomes a list under the info column on narrow windows.
- Banner visibility and poster width.
- Optional episode-card templates (non-interactive, like poster tiles). The cards / compact / grid control in Appearance still chooses how the list is arranged.

### Player

Seekbar thickness and color. Skip rules, subtitle files and playback shortcuts stay in Settings.

### What themes do not own

Home row order and visibility, navigation destinations, episode list density, skip rules, subtitle file style, recovery chrome (Theme Studio and the installation preview bar keep independent palettes), and native/TV shells beyond the tokens already applied.

ZIP archives, remote font/image packs, arbitrary CSS, JavaScript and native plugins are not supported. Wallpaper file upload is reserved for a later additive key.

Theme Studio's Layout tab exposes common controls, discovers rows on the current page, shows a template outline, and provides a validated JSON editor for component templates. The existing home editor still owns row content, visibility and order.

## Authoring and publishing

The catalog repository owns the [format reference](https://github.com/nickEatsBread/izumi-themes/blob/main/docs/FORMAT.md), JSON editor schemas, example packages, listing metadata and CI. Authors can publish a package anywhere with public HTTPS access; a catalog listing is optional. Browser builds need the host to allow cross-origin requests. Raw GitHub URLs work for both the browser and native client.

Packages declare `app: "izumi"`, `kind: "theme-package"`, `schemaVersion: 1`, `themeApi: 1`, a stable ID, numeric `major.minor.patch` version, author metadata and `design`. The `design` contains appearance values and optional `presentation`. Packages omit local saved-theme IDs and timestamps. Existing personal exports are normalized into an installable shared theme. The `shared.*` ID namespace is reserved for these client-created imports; external packages and catalog listings cannot claim it. Saved installations and their rollback records retain valid shared IDs when loaded.

Templates compose `stack`, `row`, `grid`, `overlay`, `text`, `artwork` and `action` nodes. Text and artwork bind to a host display model. Hero actions call the client's existing play, details, favorite, list, trailer, share and slide-navigation callbacks when the host provides them. Cards keep their host-owned detail or play links. Field types are fixed across hosts: `rankPosition`, `score` (0-100), `duration` (minutes), `episodeNumber` and `progress` (0-100) are numbers; every other field is a string. Artwork may be `poster`, `backdrop`, `logo` or `still`. Text nodes render `score` and `progress` as a percentage such as `78%`, and `duration` as `24m`. Optional conditions check presence for any field; `atMost` is accepted only for the numeric fields. Hosts bind different fields: a card condition on a missing field simply never matches.

Style values are a bounded allowlist. There are no arbitrary selectors, URLs, HTML or executable expressions. Text is escaped, artwork comes from the host media record, and templates are confined to their component. A template is limited to 96 nodes and eight nesting levels. Card, rank and episode templates cannot nest interactive controls inside a host link. Theme Studio and installation-preview recovery controls keep independent styling.

`src/lib/themes/presentation.ts` is the client contract. Its pure validator is mirrored in the catalog's `scripts/presentation.ts`; keep them aligned when extending the API. Changes that break existing packages need an API version change. Existing API 1 packages should remain renderable after compatible additions.

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
| Active presentation store | `src/lib/themes/runtime.ts` |
| Document chrome (density, true black, seekbar vars) | `src/lib/theme.ts`, `src/app.css` |
| Declarative renderer and layout editor | `src/lib/components/themes/` |
| Gallery and installed library | `src/routes/app/settings/themes/+page.svelte` |
| Host integration | `Hero.svelte`, `HomeRowFrame.svelte`, `Carousel.svelte`, `SmallCard.svelte`, `ContinueCard.svelte`, `SearchResults.svelte`, `AnimeDetail.svelte`, `EpisodeCard.svelte`, `Sidebar.svelte`, `Seekbar.svelte` |

## Validation

Focused tests cover package validation, rejected styles and versions, bounded downloads, checksums, cached listings, stable row overrides, page composition helpers, card-family resolution, coverage labels, preview cancellation, personal edits through updates, rollback, origin conflicts, reinstalling a removed design and failed-install recovery. Existing Theme Studio, hero, carousel and series-page navigation checks are included in the verification run.

Browser QA uses the real gallery and public package links. Responsive checks cover desktop and a 390px viewport, including a split series page collapsing the episode rail below the info column. Native player behavior and physical mobile/TV deployment require their normal platform test environments.
