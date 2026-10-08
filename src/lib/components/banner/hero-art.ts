// The wide artwork a Home hero slide shows (izumi's own desktop banner, and a theme template's
// `backdrop` under Theme API 4 `hero.art: "banner-cover"`). A pure module, so the order is tested
// without a DOM.
import { cover } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'

/** The theme's `hero.art`: `banner` is izumi's own order, `banner-cover` never shows a trailer still. */
export type HeroArtChoice = 'banner' | 'banner-cover'

/** Key art looked up for a title without a catalog banner: its URL, `null` once the lookup found
 *  none (or its wait ran out), `undefined` while it still runs. */
export type HeroKeyart = string | null | undefined

/** YouTube's still for a title's trailer: what `banner()` falls back to for a title without a banner. */
export function trailerStill(media: Pick<Media, 'trailer'>): string | undefined {
  const trailer = media.trailer
  return trailer?.id && (!trailer.site || trailer.site === 'youtube') ? `https://i.ytimg.com/vi/${trailer.id}/maxresdefault.jpg` : undefined
}

/** Whether a slide's artwork depends on a key-art lookup: it has no catalog banner. */
export const heroNeedsKeyart = (media: Pick<Media, 'bannerImage'>): boolean => !media.bannerImage

/**
 * The wide artwork of a Home hero slide, best first, skipping sources that failed to load:
 *
 * - `banner` (izumi's own): the catalog banner, key art, the trailer still, then the cover. YouTube
 *   bakes blurred pillarbox bars and burned-in captions into its stills, so one shows only for a
 *   title that has neither a banner nor key art.
 * - `banner-cover`: the catalog banner, key art, then the cover; never a trailer still.
 *
 * '' while a title without a banner still waits for its key art (the slide shows its placeholder).
 * A banner that failed does not wait: the lookup only runs for titles without one.
 */
export function heroBackdrop(media: Media, keyart: HeroKeyart, art: HeroArtChoice = 'banner', failed: readonly string[] = []): string {
  const usable = (src: string | null | undefined): src is string => !!src && !failed.includes(src)
  if (usable(media.bannerImage)) return media.bannerImage
  if (keyart === undefined && heroNeedsKeyart(media)) return ''
  if (usable(keyart)) return keyart
  const still = art === 'banner-cover' ? undefined : trailerStill(media)
  if (usable(still)) return still
  return cover(media)
}
