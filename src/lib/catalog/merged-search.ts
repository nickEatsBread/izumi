import { queryAniList } from '$lib/anilist/abortable-query'
import { searchQuery, searchVariables } from '$lib/anilist/detail-queries'
import type { Media } from '$lib/anilist/types'
import { mediaKey } from './identity'
import { loadCatalogProvider } from './registry'
import { mergedCatalogProviders, type CatalogSelection } from '$lib/settings/catalog'
import { closeMatches } from '$lib/search/close-matches'
import { hasStrongMatch } from '$lib/search/global-search'

interface AniListSearchResponse {
  Page?: { media?: Media[] }
}

export interface MergedCatalogSearchResult {
  media: Media[]
  hasNextPage: boolean
  failedProviders: CatalogSelection[]
}

/** Merged search normally sends only title and page. Genre is the one shared filter every TV
 * catalogue can expose consistently without forcing viewers to choose a provider first. */
export async function searchMergedCatalogs(
  providers: unknown,
  query: string,
  page = 1,
  signal?: AbortSignal,
  genre?: string,
): Promise<MergedCatalogSearchResult> {
  const selections = mergedCatalogProviders(providers)
  const perProvider = 20
  const batches = await Promise.allSettled(selections.map(async (selection) => {
    if (selection === 'auto' || selection === 'anilist') {
      const response = await queryAniList<AniListSearchResponse>(searchQuery(), {
        ...searchVariables({ search: query || undefined, genres: genre ? [genre] : undefined, sort: query ? 'SEARCH_MATCH' : 'TRENDING_DESC' }),
        page,
        perPage: perProvider,
      }, signal)
      if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError')
      if (response.error) throw response.error
      const media = response.data?.Page?.media ?? []
      // AniList matches whole words spelled exactly; a typo or a respaced title gets the close
      // matches it missed, ahead of the rest of AniList's answer, none of which plainly is the title
      // typed. A close match AniList returned too keeps AniList's own, richer record. A genre filter
      // is one they cannot be checked against.
      const close = page === 1 && query && !genre && !hasStrongMatch(media, query)
        ? await closeMatches(query, { signal })
        : []
      const own = new Map(media.map((item) => [item.id, item]))
      const leading = close.map((item) => own.get(item.id) ?? item)
      const led = new Set(leading.map((item) => item.id))
      return { selection, media: [...leading, ...media.filter((item) => !led.has(item.id))], hasNextPage: media.length >= perProvider }
    }
    const provider = await loadCatalogProvider(selection)
    const result = await provider.search({
      query: query || undefined,
      genre,
      page,
      type: selection === 'kitsu' || selection === 'jvm' ? 'anime' : 'all',
      sort: 'popular',
      signal,
    })
    return { selection, media: result.media, hasNextPage: result.hasNextPage }
  }))

  if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError')
  const unique = new Map<string, Media>()
  const failedProviders: CatalogSelection[] = []
  let hasNextPage = false
  batches.forEach((batch, index) => {
    if (batch.status === 'rejected') {
      failedProviders.push(selections[index])
      return
    }
    hasNextPage ||= batch.value.hasNextPage
    for (const media of batch.value.media) unique.set(mediaKey(media), media)
  })
  if (failedProviders.length === selections.length && selections.length) {
    const failure = batches.find((batch): batch is PromiseRejectedResult => batch.status === 'rejected')
    throw failure?.reason ?? new Error('No catalog could complete this search.')
  }
  return { media: [...unique.values()], hasNextPage, failedProviders }
}
