/** The artwork at the top of a series page, chosen once for every layout (the phone band and overlay,
 *  the desktop overlay and banner) and for the page's loading and loaded states alike, so the art the
 *  page paints while the detail query runs is the art it keeps.
 *
 *  - `banner`: the catalog's wide banner.
 *  - `keyart`: 16:9 title artwork (`detail.art: "keyart"` puts it first; otherwise it stands in for
 *    a missing or broken banner).
 *  - `pending`: the choice still waits on a banner the detail record may bring, or on key art the
 *    theme asked for; the page shows a placeholder.
 *  - `wash`: no banner and no key art. A wash of the cover's colour, never a blurred or stretched
 *    photograph; a theme can show the cover itself instead (`[data-art="cover"]`).
 *
 *  A YouTube trailer still is never chosen: YouTube bakes blurred pillarbox bars and burned-in text
 *  into those JPEGs, so they read as broken art. */
export type DetailArt =
  | { kind: 'banner' | 'keyart'; src: string }
  | { kind: 'pending' }
  | { kind: 'wash'; rgb?: string }
export type DetailArtKind = DetailArt['kind']

export interface DetailArtInput {
  /** The record's banner: a URL, `null` when the record has none, `undefined` while the record that
   *  will say is still loading. */
  banner: string | null | undefined
  /** Key art, once looked up. */
  keyart?: string
  /** The key-art lookup has not answered yet and its deadline has not passed. */
  keyartPending?: boolean
  /** The theme's `detail.art`. */
  themeArt?: 'banner' | 'keyart'
  /** Sources that failed to load after their retries. */
  failed?: readonly string[]
  /** The cover's colour as "r g b", for the wash. */
  rgb?: string
}

export function detailArt(input: DetailArtInput): DetailArt {
  const failed = new Set(input.failed ?? [])
  const usable = (src: string | null | undefined): src is string => !!src && !failed.has(src)
  const bannerUnknown = input.banner === undefined
  if (input.themeArt === 'keyart') {
    if (usable(input.keyart)) return { kind: 'keyart', src: input.keyart }
    if (input.keyartPending) return { kind: 'pending' }
    if (usable(input.banner)) return { kind: 'banner', src: input.banner }
    if (bannerUnknown) return { kind: 'pending' }
  } else {
    // A banner never waits on key art.
    if (usable(input.banner)) return { kind: 'banner', src: input.banner }
    if (bannerUnknown) return { kind: 'pending' }
    if (usable(input.keyart)) return { kind: 'keyart', src: input.keyart }
    if (input.keyartPending) return { kind: 'pending' }
  }
  return { kind: 'wash', rgb: input.rgb }
}

/** The banner a record stands for. A record served by the fallback catalog while AniList is
 *  unavailable often has no banner of its own although the title has one on AniList, so the banner
 *  seen on an AniList record of the title (the card the user tapped) wins over its own. While the
 *  page is still loading, a hint without the field says nothing yet (`undefined`). */
export function recordBanner(
  record: { bannerImage?: string | null; catalog?: { provider: string } } | undefined,
  options: { loading: boolean; anilistBanner?: string | null },
): string | null | undefined {
  if (!record) return options.loading ? undefined : null
  if (record.catalog?.provider === 'kitsu') return options.anilistBanner || record.bannerImage || (options.loading ? undefined : null)
  if (record.bannerImage !== undefined) return record.bannerImage
  return options.loading ? undefined : null
}

/** The wash behind a series page without artwork: the cover's colour, else the muted surface. */
export function washBackground(rgb: string | undefined): string {
  return rgb
    ? `linear-gradient(160deg, rgb(${rgb} / 0.6), rgb(${rgb} / 0.22) 55%, rgb(${rgb} / 0.08))`
    : 'linear-gradient(160deg, hsl(var(--muted)), hsl(var(--muted) / 0.35))'
}

/** YouTube answers a missing `maxresdefault` still with a 120x90 grey placeholder sent with HTTP 404,
 *  which Chromium-based webviews still paint. A loaded YouTube image that small is that placeholder. */
export function isPlaceholderThumb(src: string | null | undefined, naturalWidth: number): boolean {
  return !!src && /^https?:\/\/i\d*\.ytimg\.com\//.test(src) && naturalWidth > 0 && naturalWidth <= 120
}

/** `reliableImage` retries a failed image under the same URL plus a retry marker; the source the
 *  page chose is the URL without it. */
export function baseImageSrc(src: string | null | undefined): string {
  return (src ?? '').replace(/[?&]izumi_retry=\d+$/, '')
}
