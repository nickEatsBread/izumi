// The Relations section's titles: what kind of media each related title is (`data-media` on
// `relation`), and the recommended titles a theme may add after them (API 4
// `detail.sections.relations.recommended: "append"`).
import type { Media } from '$lib/anilist/types'

/** The kind of media a related title is: `anime`, `manga`, `novel` (a light novel) or `one-shot`.
 *  Nothing when the record names neither its type nor its format. */
export function relationMedia(node: Pick<Media, 'type' | 'format'>): string | undefined {
  if (node.format === 'NOVEL') return 'novel'
  if (node.format === 'ONE_SHOT') return 'one-shot'
  if (node.type === 'MANGA' || node.format === 'MANGA') return 'manga'
  if (node.type === 'ANIME' || node.format) return 'anime'
  return undefined
}

/** The recommended titles of a record, in the catalog's order, without empty entries. */
export function recommendedTitles(media: Pick<Media, 'recommendations'>): Media[] {
  return (media.recommendations?.nodes ?? [])
    .filter((node): node is { rating?: number; mediaRecommendation: Media } => !!node?.mediaRecommendation)
    .map((node) => node.mediaRecommendation)
}
