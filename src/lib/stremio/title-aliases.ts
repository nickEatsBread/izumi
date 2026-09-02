import type { Media } from '$lib/anilist/types'
import { title } from '$lib/anilist/media'

/**
 * Every readable title by which a source may identify this media, in provider-query order.
 *
 * Keep discovery and post-discovery validation on this same list. In particular, fallback
 * catalogues such as Kitsu can carry an English title only in `synonyms`; accepting that title
 * during provider search and then omitting it from refinement quarantines the valid result.
 */
export function sourceTitleAliases(media: Media): string[] {
  const aliases = [title(media), media.title.romaji, media.title.english, ...(media.synonyms ?? [])]
  const seen = new Set<string>()
  const unique: string[] = []
  for (const alias of aliases) {
    const value = alias?.trim()
    if (!value) continue
    const key = value.normalize('NFKC').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(value)
  }
  return unique
}
