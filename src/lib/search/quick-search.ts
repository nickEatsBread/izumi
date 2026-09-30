// The live search behind every as-you-type surface (the search overlay and a theme top bar's
// search field): each enabled catalog is asked for its first page in parallel, and AniList's search
// is joined by close matches for typos and half-typed words (close-matches.ts). Every answer is
// merged by identity and ranked against the query the moment it arrives, so a slow source never
// holds back the others. A finished answer is kept for two minutes.
import type { Media } from '$lib/anilist/types'
import { queryAniList } from '$lib/anilist/abortable-query'
import { searchQuery, searchVariables } from '$lib/anilist/detail-queries'
import { loadCatalogProvider } from '$lib/catalog/registry'
import { mediaKey } from '$lib/catalog/identity'
import type { CatalogSelection } from '$lib/settings/catalog'
import { lookUpCloseMatches } from './close-matches'
import { hasStrongMatch, rankQuickSearchResults } from './global-search'

type SearchResponse = { Page?: { media?: Media[] } }
const cache = new Map<string, { expires: number; media: Media[] }>()
const CACHE_MS = 2 * 60 * 1000

// `auto` already searches AniList, so an explicit AniList selection beside it is skipped.
const searched = (selections: readonly CatalogSelection[]) =>
  selections.filter((selection) => selection !== 'anilist' || !selections.includes('auto'))
const keyOf = (clean: string, selections: readonly CatalogSelection[]) =>
  `${searched(selections).join(',')}:${clean.toLocaleLowerCase()}`
const searchesAniList = (selection: CatalogSelection) => selection === 'auto' || selection === 'anilist'

/** The cached answer for a normalised query, while it is fresh. */
export function cachedQuickSearch(clean: string, selections: readonly CatalogSelection[]): Media[] | undefined {
  const hit = cache.get(keyOf(clean, selections))
  return hit && hit.expires > Date.now() ? hit.media : undefined
}

export interface QuickSearchOptions {
  limit?: number
  /** Abandons the search: requests still queued or running are torn down. */
  signal?: AbortSignal
  /** Receives the ranked results so far each time another source answers. */
  onUpdate?: (media: Media[]) => void
}

/** Search every enabled catalog for a normalised query. Throws when the search was abandoned, or
 *  when every catalog failed and nothing close was found either. An empty answer that a failed
 *  lookup may have cut short is not remembered. */
export async function quickSearch(
  clean: string,
  selections: readonly CatalogSelection[],
  options: QuickSearchOptions = {},
): Promise<Media[]> {
  const { limit = 12, signal, onUpdate } = options
  const hit = cachedQuickSearch(clean, selections)
  if (hit) return hit
  const catalogs = searched(selections)
  const pool = new Map<string, { media: Media; closeMatch: boolean }>()
  const everything = () => [...pool.values()].map(({ media }) => media)
  const ranked = () => rankQuickSearchResults(everything(), clean).slice(0, limit)
  const add = (media: Media[], closeMatch = false) => {
    for (const item of media) {
      const key = mediaKey(item)
      const existing = pool.get(key)
      // A catalog's own record is richer than a close-match stand-in for the same title.
      if (!existing || (existing.closeMatch && !closeMatch)) pool.set(key, { media: item, closeMatch })
    }
    if (!signal?.aborted) onUpdate?.(ranked())
  }
  const aniList = catalogs.some(searchesAniList)
    ? queryAniList<SearchResponse>(searchQuery(), { ...searchVariables({ search: clean }), perPage: 10 }, signal)
      .then((response) => {
        if (response.error) throw response.error
        return response.data?.Page?.media ?? []
      })
    : undefined
  const results = Promise.allSettled(catalogs.map(async (selection): Promise<void> => {
    if (searchesAniList(selection)) {
      add(await (aniList as Promise<Media[]>))
      return
    }
    const provider = await loadCatalogProvider(selection)
    const page = await provider.search({
      query: clean, page: 1, type: selection === 'kitsu' || selection === 'jvm' ? 'anime' : 'all', sort: 'popular', signal,
    })
    add(page.media.slice(0, 10))
  }))
  // Close matches stand in for AniList titles, so they join only a search that includes AniList. Their
  // respelling request waits for AniList's own answer and is skipped when anything found so far is
  // already plainly the title typed.
  let closeComplete = true
  const close = aniList
    ? lookUpCloseMatches(clean, { signal, answered: aniList, found: () => hasStrongMatch(everything(), clean) }).then(
      (answer) => {
        add(answer.media, true)
        closeComplete = answer.complete
      },
      () => { closeComplete = false },
    )
    : undefined
  // A source that ignores the signal must not keep an abandoned search open.
  const abandoned = new Promise<never>((_, reject) => {
    const stop = () => reject(new DOMException('Search cancelled', 'AbortError'))
    if (signal?.aborted) stop()
    else signal?.addEventListener('abort', stop, { once: true })
  })
  abandoned.catch(() => {})
  const [batches] = await Promise.race([Promise.all([results, close]), abandoned])
  if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError')
  if (!pool.size && !batches.some((batch) => batch.status === 'fulfilled')) {
    const failed = batches.find((batch): batch is PromiseRejectedResult => batch.status === 'rejected')
    if (failed) throw failed.reason
  }
  const media = ranked()
  const complete = closeComplete && batches.every((batch) => batch.status === 'fulfilled')
  if (media.length || complete) cache.set(keyOf(clean, selections), { expires: Date.now() + CACHE_MS, media })
  return media
}
