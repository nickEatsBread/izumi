// Trending titles the Search page offers before anything is typed, from each enabled catalog's own
// trending list. Each list is asked for once a session; one that failed is asked again next time.
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { queryAniList } from '$lib/anilist/abortable-query'
import { searchQuery, searchVariables } from '$lib/anilist/detail-queries'
import type { CatalogHomeSection } from '$lib/catalog/types'
import type { CatalogSelection } from '$lib/settings/catalog'
import { showAdult } from '$lib/settings/ui'

const aniList = async (): Promise<Media[]> => {
  const response = await queryAniList<{ Page?: { media?: Media[] } }>(searchQuery(), { ...searchVariables({}), page: 1, perPage: 20 })
  if (response.error) throw response.error
  return response.data?.Page?.media ?? []
}

const LISTS: Partial<Record<CatalogSelection, { id: string; title: string; load: () => Promise<Media[]> }>> = {
  auto: { id: 'anilist', title: 'Trending anime', load: aniList },
  anilist: { id: 'anilist', title: 'Trending anime', load: aniList },
  tmdb: { id: 'tmdb', title: 'Trending movies & TV', load: async () => (await import('$lib/catalog/providers/tmdb')).tmdbTrending() },
}

/** Whether any of these catalogs has a trending list to show. */
export const hasTrending = (selections: readonly CatalogSelection[]): boolean => selections.some((selection) => !!LISTS[selection])

const cache = new Map<string, Promise<CatalogHomeSection | null>>()

/** One row per enabled catalog that has a trending list, in the catalogs' order, each settling on
 *  its own: null when that catalog had nothing to offer or could not be reached. */
export function trendingSections(selections: readonly CatalogSelection[]): Promise<CatalogHomeSection | null>[] {
  const lists = [...new Map(selections.flatMap((selection) => LISTS[selection] ?? []).map((list) => [list.id, list])).values()]
  return lists.map(({ id, title, load }) => {
    // 18+ changes what every list holds.
    const key = `${id}:${get(showAdult)}`
    let row = cache.get(key)
    if (!row) {
      row = load().then(
        (media) => media.length ? { id: `trending:${id}`, title, media } : null,
        () => {
          cache.delete(key)
          return null
        },
      )
      cache.set(key, row)
    }
    return row
  })
}
