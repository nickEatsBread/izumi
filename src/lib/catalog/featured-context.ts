import type { Media } from '$lib/anilist/types'

/** Preserve the list that justified a featured placement instead of presenting it as arbitrary. */
export function rankFeaturedMedia(media: Media[], label: string): Media[] {
  return media.map((item, index) => ({
    ...item,
    featuredRank: { position: index + 1, label },
  }))
}

/** Mix equally important ranked lists without losing the rank each provider assigned. */
export function interleaveFeatured(lists: Media[][], limit = 10): Media[] {
  const output: Media[] = []
  const seen = new Set<string>()
  const length = Math.max(0, ...lists.map((list) => list.length))
  for (let index = 0; index < length && output.length < limit; index++) {
    for (const list of lists) {
      const item = list[index]
      if (!item) continue
      const key = item.catalog ? `${item.catalog.provider}:${item.catalog.type}:${item.catalog.id}` : String(item.id)
      if (seen.has(key)) continue
      seen.add(key)
      output.push(item)
      if (output.length >= limit) break
    }
  }
  return output
}
