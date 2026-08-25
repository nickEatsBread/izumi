import type { MediaTag } from './types'

/**
 * AniList can mark a tag as revealing in general or only for one title. Detail pages protect
 * either kind unconditionally; the global spoiler preference must not expose them.
 */
export function isSpoilerTag(tag: MediaTag): boolean {
  return tag.isGeneralSpoiler === true || tag.isMediaSpoiler === true
}

export function detailTags(tags: MediaTag[] | undefined, limit: number, sortByRank = false): MediaTag[] {
  const ordered = sortByRank
    ? [...(tags ?? [])].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    : [...(tags ?? [])]
  return ordered.slice(0, limit)
}
