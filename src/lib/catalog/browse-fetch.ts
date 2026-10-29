// Where a Browse listing comes from, per catalog: AniList's search (through the app's GraphQL
// client, so its outage backup still answers), another catalog's own search, or a source's own
// paged listings (a source's search wants a query, so its Popular, New, … listings are the sorts).
import { get } from 'svelte/store'
import { pipe, subscribe, take } from 'wonka'
import type { Client } from '@urql/svelte'
import { GENRE_COLLECTION, searchQuery, searchVariables } from '$lib/anilist/detail-queries'
import type { Media } from '$lib/anilist/types'
import { TOP_GENRES } from '$lib/home/blocks'
import { phttp } from '$lib/net/http'
import { gameMode } from '$lib/player/session'
import type { CatalogSelection } from '$lib/settings/catalog'
import { showAdult } from '$lib/settings/ui'
import type { StremioMeta } from './providers/stremio'
import { loadCatalogProvider } from './registry'
import { isSourceSelection, sourceAddon, sourcePackageOf } from './source-catalogs'
import {
  anilistBrowseFilters, browseSorts, sourceBrowseCatalogs, sourceBrowseGenres, sourceBrowseSorts, sourceGenreImages, sourceSortValue,
  type BrowseFetch, type BrowseOption,
} from './browse'
import type { CatalogPage, CatalogSearchRequest } from './types'
import type { AddonCatalog } from '$lib/stremio/manifest'

export interface BrowseCatalog {
  sorts: BrowseOption[]
  /** The categories a sort can be narrowed to (each of a source's listings has its own). */
  genres(sort: string): string[]
  /** A category's artwork, when the catalog has any (the Categories screen's backdrop). */
  genreImage?(genre: string): string | undefined
  fetch(sort: string, genre: string): BrowseFetch
}

function anilistPage(client: Client, sort: string, genre: string, page: number, signal: AbortSignal): Promise<CatalogPage> {
  return new Promise((resolve, reject) => {
    const variables = { ...searchVariables(anilistBrowseFilters(sort, genre)), page, withPreview: !get(gameMode) }
    // Unsubscribing tears the operation down, which aborts its request: a superseded listing stops
    // spending AniList's rate limit.
    const { unsubscribe } = pipe(
      client.query(searchQuery(), variables, { requestPolicy: 'network-only' }),
      take(1),
      subscribe((result) => {
        if (result.error) return reject(new Error(result.error.message))
        const data = result.data?.Page as { media?: Media[]; pageInfo?: { hasNextPage?: boolean } } | undefined
        const adult = get(showAdult)
        resolve({ media: (data?.media ?? []).filter((item) => adult || !item.isAdult), page, hasNextPage: !!data?.pageInfo?.hasNextPage })
      }),
    )
    signal.addEventListener('abort', () => { unsubscribe(); reject(signal.reason) }, { once: true })
  })
}

async function anilistGenres(client: Client): Promise<string[]> {
  const result = await client.query(GENRE_COLLECTION, {}).toPromise().catch(() => null)
  const list = (result?.data as { GenreCollection?: string[] } | undefined)?.GenreCollection
  const genres = Array.isArray(list) && list.length ? list : TOP_GENRES
  return get(showAdult) ? genres : genres.filter((genre) => genre !== 'Hentai')
}

/** Pages through one of a source's listings, narrowed by `extra` (a category, a season). */
export function sourceListingFetch(packageId: string, entry: AddonCatalog, extra: Record<string, string> = {}): BrowseFetch {
  return async (page, offset, signal) => {
    const stremio = await import('./providers/stremio')
    // Re-read each time: a restarted source service comes back on another port.
    const live = await sourceAddon(packageId)
    const narrowed = Object.fromEntries(Object.entries(extra).filter(([, value]) => value))
    const url = stremio.stremioCatalogUrl(live.base, entry, { ...narrowed, skip: offset || undefined })
    const response = await phttp(url, { signal, timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 })
    if (!response.ok) throw new Error(`The source answered HTTP ${response.status}.`)
    const metas = ((await response.json()) as { metas?: StremioMeta[] }).metas ?? []
    const media = metas.flatMap((meta) => stremio.mapStremioMeta(meta, live.base, entry.type) ?? [])
    // A listing pages until it returns nothing: the protocol has no page size.
    return { media, page, hasNextPage: metas.length > 0 }
  }
}

async function sourceCatalog(packageId: string): Promise<BrowseCatalog> {
  const addon = await sourceAddon(packageId)
  const entries = sourceBrowseCatalogs(addon.manifest)
  const entryOf = (sort: string) => entries.find((entry) => sourceSortValue(entry) === sort)
  const images = sourceGenreImages(addon.manifest)
  return {
    sorts: sourceBrowseSorts(addon.manifest),
    genres: (sort) => sourceBrowseGenres(entryOf(sort)),
    genreImage: (genre) => images[genre],
    fetch: (sort, genre) => {
      const entry = entryOf(sort)
      return entry ? sourceListingFetch(packageId, entry, { genre }) : async (page) => ({ media: [], page, hasNextPage: false })
    },
  }
}

const loaded = new Map<string, BrowseCatalog>()
const catalogKey = (selection: CatalogSelection) => `${selection}|${get(showAdult)}`

/** A catalog's Browse listings already loaded this session: a return to Browse draws at once. */
export const cachedBrowseCatalog = (selection: CatalogSelection): BrowseCatalog | undefined => loaded.get(catalogKey(selection))

/** The Browse listings of `selection` (a concrete catalog, never Merged). */
export async function loadBrowseCatalog(selection: CatalogSelection, client: Client): Promise<BrowseCatalog> {
  const key = catalogKey(selection)
  const catalog = await buildBrowseCatalog(selection, client)
  // Without categories it is read again next time: its genre list may have failed to load.
  if (catalog.sorts.some((sort) => catalog.genres(sort.value).length)) loaded.set(key, catalog)
  return catalog
}

async function buildBrowseCatalog(selection: CatalogSelection, client: Client): Promise<BrowseCatalog> {
  if (selection === 'auto' || selection === 'anilist') {
    const genres = await anilistGenres(client)
    return {
      sorts: browseSorts(selection),
      genres: () => genres,
      fetch: (sort, genre) => (page, _offset, abort) => anilistPage(client, sort, genre, page, abort),
    }
  }
  if (isSourceSelection(selection)) return sourceCatalog(sourcePackageOf(selection))
  const provider = await loadCatalogProvider(selection)
  const genres = await provider.genres?.().catch(() => []) ?? []
  return {
    sorts: browseSorts(selection),
    genres: () => genres,
    fetch: (sort, genre) => (page, _offset, abort) => provider.search({
      sort: sort as CatalogSearchRequest['sort'],
      genre: genre || undefined,
      type: 'all',
      page,
      signal: abort,
    }),
  }
}
