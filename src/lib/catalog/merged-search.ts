import { anilist } from '$lib/anilist/client'
import { searchQuery, searchVariables } from '$lib/anilist/detail-queries'
import type { Media } from '$lib/anilist/types'
import { mediaKey } from './identity'
import { loadCatalogProvider } from './registry'
import { mergedCatalogProviders, type CatalogSelection } from '$lib/settings/catalog'

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
      const response = await anilist.query<AniListSearchResponse>(searchQuery(), {
        ...searchVariables({ search: query || undefined, genres: genre ? [genre] : undefined, sort: query ? 'SEARCH_MATCH' : 'TRENDING_DESC' }),
        page,
        perPage: perProvider,
      }, { requestPolicy: 'network-only' }).toPromise()
      if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError')
      if (response.error) throw response.error
      const media = response.data?.Page?.media ?? []
      return { selection, media, hasNextPage: media.length >= perProvider }
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
