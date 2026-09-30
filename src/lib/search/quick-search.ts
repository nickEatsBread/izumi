// The live search behind every as-you-type surface (the search overlay and a theme top bar's
// search field): each enabled catalog is asked for its first page in parallel, the answers are
// merged by identity and ranked against the query, and the result is kept for two minutes.
import { anilist } from '$lib/anilist/client'
import { searchQuery, searchVariables } from '$lib/anilist/detail-queries'
import type { Media } from '$lib/anilist/types'
import { loadCatalogProvider } from '$lib/catalog/registry'
import { mediaKey } from '$lib/catalog/identity'
import type { CatalogSelection } from '$lib/settings/catalog'
import { rankQuickSearchResults } from './global-search'

type SearchResponse = { Page?: { media?: Media[] } }
const cache = new Map<string, { expires: number; media: Media[] }>()
const CACHE_MS = 2 * 60 * 1000

// `auto` already searches AniList, so an explicit AniList selection beside it is skipped.
const searched = (selections: readonly CatalogSelection[]) =>
  selections.filter((selection) => selection !== 'anilist' || !selections.includes('auto'))
const keyOf = (clean: string, selections: readonly CatalogSelection[]) =>
  `${searched(selections).join(',')}:${clean.toLocaleLowerCase()}`

/** The cached answer for a normalised query, while it is fresh. */
export function cachedQuickSearch(clean: string, selections: readonly CatalogSelection[]): Media[] | undefined {
  const hit = cache.get(keyOf(clean, selections))
  return hit && hit.expires > Date.now() ? hit.media : undefined
}

/** Search every enabled catalog for a normalised query; throws only when every catalog failed. */
export async function quickSearch(clean: string, selections: readonly CatalogSelection[], limit = 12): Promise<Media[]> {
  const hit = cachedQuickSearch(clean, selections)
  if (hit) return hit
  const batches = await Promise.allSettled(searched(selections).map(async (selection): Promise<Media[]> => {
    if (selection === 'auto' || selection === 'anilist') {
      const response = await anilist
        .query<SearchResponse>(searchQuery(), { ...searchVariables({ search: clean }), perPage: 10 }, { requestPolicy: 'network-only' })
        .toPromise()
      if (response.error) throw response.error
      return response.data?.Page?.media ?? []
    }
    const provider = await loadCatalogProvider(selection)
    return (await provider.search({
      query: clean, page: 1, type: selection === 'kitsu' || selection === 'jvm' ? 'anime' : 'all', sort: 'popular',
    })).media.slice(0, 10)
  }))
  const unique = new Map<string, Media>()
  for (const batch of batches) {
    if (batch.status !== 'fulfilled') continue
    for (const item of batch.value) unique.set(mediaKey(item), item)
  }
  if (!batches.some((batch) => batch.status === 'fulfilled')) {
    const failed = batches.find((batch): batch is PromiseRejectedResult => batch.status === 'rejected')
    if (failed) throw failed.reason
  }
  const media = rankQuickSearchResults([...unique.values()], clean).slice(0, limit)
  cache.set(keyOf(clean, selections), { expires: Date.now() + CACHE_MS, media })
  return media
}
