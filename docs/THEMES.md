# Installable themes

Settings → Themes opens the community catalog at [izumi-themes](https://github.com/nickEatsBread/izumi-themes). Users can browse, search, inspect a theme, preview it on their client, and install it. **Add from link** accepts a public HTTPS package or release descriptor, including GitHub file links. **Import file** accepts JSON packages and existing Theme Studio exports.

The Theme Studio button inside Themes opens the live design editor. Themes is the single settings-menu entry for browsing and customizing themes; the editor remains directly searchable.

The shipped appearance remains the default. Cinema demonstrates an optional top-ten rank treatment; Meridian replaces the hero composition and media cards; Ink hides the hero and uses wrapping rows. Installing a theme is an explicit choice. No appearance update is applied automatically.

## Theme API 1 coverage

- Existing appearance controls: semantic colors, font family and scale, corner radius, backdrop and glass effects.
- Home hero: visibility, desktop/mobile height, rotation interval, rank badge visibility, an optional badge template and an optional entire hero template.
- Home rows: carousel or wrapping grid, card width and spacing, row spacing, artwork shape and corners (these style the default cover; a custom card template owns its own shape), heading size, and optional ordinary media-card templates.
- Per-row overrides follow stable row identities, so reordering a row does not move its visual settings to another row. Resolution is global defaults → semantic row role → exact scoped row ID. For example, `continue` can override every Continue Watching row and `anime:continue` can target one catalog.
- Theme Studio's Layout tab exposes common controls, discovers rows on the current page, and provides a validated JSON editor for component templates. The existing home editor still owns row content, visibility and order.

This is the first presentation API, not full replacement coverage for every screen. The shell and settings use existing global tokens; their component structures are not replaceable. Detail pages, specialized progress cards, player overlays, native surfaces and the separate TV client do not yet expose layout templates. Row arrangement can affect specialized cards, but custom card templates currently render through `SmallCard`. ZIP archives, remote font/image packs, arbitrary CSS, JavaScript and native plugins are not supported.

See [the theme-system audit](THEME_SYSTEM_AUDIT.md) for remaining limitations, comparisons with established theme systems, and a proposed implementation order.

## Authoring and publishing

The catalog repository owns the [format reference](https://github.com/nickEatsBread/izumi-themes/blob/main/docs/FORMAT.md), JSON editor schemas, example packages, listing metadata and CI. Authors can publish a package anywhere with public HTTPS access; a catalog listing is optional. Browser builds need the host to allow cross-origin requests. Raw GitHub URLs work for both the browser and native client.

Packages declare `app: "izumi"`, `kind: "theme-package"`, `schemaVersion: 1`, `themeApi: 1`, a stable ID, numeric `major.minor.patch` version, author metadata and `design`. The `design` contains appearance values and optional `presentation`. Packages omit local saved-theme IDs and timestamps. Existing personal exports are normalized into an installable shared theme. The `shared.*` ID namespace is reserved for these client-created imports; external packages and catalog listings cannot claim it. Saved installations and their rollback records retain valid shared IDs when loaded.

Templates compose `stack`, `row`, `grid`, `overlay`, `text`, `artwork` and `action` nodes. Text and artwork bind to a small host display model. Hero actions call the client's existing play, details, favorite and slide-navigation callbacks. Cards keep their host-owned detail links. Field types are fixed across hosts: `rankPosition` and `score` (0-100) are numbers, every other field is a string. Text nodes render `score` as a percentage such as `78%`. Optional conditions check presence for any field; `atMost` is accepted only for the numeric fields. Hosts bind different fields: hero and badge templates see the full model, including `description`, `rank` and `rankPosition`, while card templates see `title`, `poster`, `backdrop`, `format`, `year` and `score` — a card condition on a hero-only field simply never matches.

Style values are a bounded allowlist. There are no arbitrary selectors, URLs, HTML or executable expressions. Text is escaped, artwork comes from the host media record, and templates are confined to their component. A template is limited to 96 nodes and eight nesting levels. Card and rank templates cannot nest interactive controls inside a host link. Theme Studio and installation-preview recovery controls keep independent styling.

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
| Package, release and catalog parsing | `src/lib/themes/packages.ts` |
| Bounded downloads, integrity and cache | `src/lib/themes/catalog.ts` |
| Install, preview, merge and rollback | `src/lib/themes/installed.ts` |
| Active presentation store | `src/lib/themes/runtime.ts` |
| Declarative renderer and layout editor | `src/lib/components/themes/` |
| Gallery and installed library | `src/routes/app/settings/themes/+page.svelte` |
| Host integration | `Hero.svelte`, `HomeRowFrame.svelte`, `Carousel.svelte`, `SmallCard.svelte` |

## Validation

Focused tests cover package validation, rejected styles and versions, bounded downloads, checksums, cached listings, stable row overrides, preview cancellation, personal edits through updates, rollback, origin conflicts, reinstalling a removed design and failed-install recovery. Existing Theme Studio, hero and carousel navigation checks are included in the verification run.

Browser QA uses the real gallery and public package links. A temporary local fixture exercises the real hero, frame, carousel and media card components with deterministic content when the external catalog service is unavailable. The fixture is removed before committing. Responsive checks cover desktop and a 390px viewport. Native player behavior and physical mobile/TV deployment require their normal platform test environments.
