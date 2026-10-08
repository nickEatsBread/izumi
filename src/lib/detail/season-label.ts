// The season an episode list shows, for a heading that names it (`data-season-label` on the series
// page's Episodes heading): phone apps built on TV databases title a single season's list "Season 1"
// or "Specials" where izumi says "Episodes".
import { chainNeighbours, SEASON_FORMATS } from '$lib/anilist/seasons'
import type { Media } from '$lib/anilist/types'

/** Formats a TV database files under its "Specials" season. */
const SPECIAL_FORMATS: ReadonlySet<string> = new Set(['OVA', 'SPECIAL'])

/**
 * "Season 1" for a TV, TV short or ONA title that is the only season of its prequel/sequel chain,
 * "Specials" for an OVA or a special, and nothing for a film, a music video, a title with other
 * seasons (the season picker names those) or a record that does not say yet.
 *
 * @param chain the walked prequel/sequel chain, when the page has it (the season picker's walk);
 *              without it the record's own prequel and sequel links decide, and any of them (a film
 *              between two seasons included) leaves the season unnamed rather than guessed
 */
export function singleSeasonLabel(media: Pick<Media, 'format' | 'relations'>, chain?: readonly Pick<Media, 'format'>[]): string | undefined {
  const format = media.format ?? ''
  if (SPECIAL_FORMATS.has(format)) return 'Specials'
  if (!SEASON_FORMATS.has(format)) return undefined
  if (chain) return chain.filter((entry) => SEASON_FORMATS.has(entry.format ?? '')).length < 2 ? 'Season 1' : undefined
  if (!media.relations) return undefined
  return chainNeighbours(media as Media).length ? undefined : 'Season 1'
}
