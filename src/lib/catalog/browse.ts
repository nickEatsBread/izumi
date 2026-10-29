// Browse: a whole catalog to scroll through, ordered by a sort and narrowed to one category. The
// sorts and the per-(catalog, sort, category) feed cache live here, free of Svelte and the network,
// so switching back to a listing is instant and a stale listing's request is cancelled.
import type { Media } from '$lib/anilist/types'
import type { SearchFilters } from '$lib/anilist/detail-queries'
import type { AddonCatalog, AddonManifest } from '$lib/stremio/manifest'
import { mediaKey } from './identity'
import type { SourceCatalogEntry } from './source-catalogs'
import type { CatalogPage } from './types'

export interface BrowseOption { value: string; label: string }

const POPULAR = { value: 'popular', label: 'Popular' }
const NEWEST = { value: 'recent', label: 'Newest' }
const A_Z = { value: 'title', label: 'A–Z' }
const RATED = { value: 'rating', label: 'Top rated' }
const TRENDING = { value: 'trending', label: 'Trending' }

/** The orders a catalog's search can list a category in: Popular, Newest and A–Z first, then what
 *  else it supports. A source's own catalog lists its own listings instead (`sourceBrowseSorts`). */
export function browseSorts(selection: string): BrowseOption[] {
  if (selection === 'auto' || selection === 'anilist') return [POPULAR, NEWEST, A_Z, RATED, TRENDING]
  if (selection === 'kitsu') return [POPULAR, NEWEST, RATED]
  if (selection === 'jvm') return [POPULAR, NEWEST]
  return [POPULAR, NEWEST, A_Z, RATED]
}

/** `value` when the catalog offers it, else its first sort. */
export const pickBrowseSort = (value: string | null | undefined, options: BrowseOption[]): string =>
  options.find((option) => option.value === value)?.value ?? options[0]?.value ?? 'popular'

const ANILIST_SORT: Record<string, string> = {
  popular: 'POPULARITY_DESC', recent: 'START_DATE_DESC', title: 'TITLE_ROMAJI', rating: 'SCORE_DESC', trending: 'TRENDING_DESC',
}

/** The AniList search a Browse listing runs. */
export function anilistBrowseFilters(sort: string, genre: string): SearchFilters {
  return {
    sort: ANILIST_SORT[sort] ?? ANILIST_SORT.popular,
    genres: genre ? [genre] : undefined,
    // Announced titles start in the future, so Newest would open on shows nobody can watch yet.
    statuses: sort === 'recent' ? ['RELEASING', 'FINISHED'] : undefined,
  }
}

/** A source's listings that page on their own (`skip`) and need nothing typed: its Popular, New, … */
export function sourceBrowseCatalogs(manifest: AddonManifest): AddonCatalog[] {
  return (manifest.catalogs ?? []).filter((entry) => {
    const roles = (entry as SourceCatalogEntry).izumi
    const extra = entry.extra ?? []
    return !roles?.hero && !roles?.continue && entry.izumi?.browse !== false
      && extra.some((item) => item.name === 'skip') && !extra.some((item) => item.isRequired)
  })
}

export const sourceSortValue = (entry: Pick<AddonCatalog, 'type' | 'id'>): string => `${entry.type}:${entry.id}`

export const sourceBrowseSorts = (manifest: AddonManifest): BrowseOption[] =>
  sourceBrowseCatalogs(manifest).map((entry) => ({ value: sourceSortValue(entry), label: entry.name }))

/** The categories one source listing takes (its `genre` extra, or the legacy `genres` field). */
export function sourceBrowseGenres(entry: AddonCatalog | undefined): string[] {
  if (!entry) return []
  const options = entry.extra?.find((item) => item.name === 'genre')?.options ?? entry.genres ?? []
  return [...new Set(options)]
}

/** Artwork a source gave its categories (`extra[genre].izumi.images`), across all its listings. */
export function sourceGenreImages(manifest: AddonManifest): Record<string, string> {
  const images: Record<string, string> = {}
  for (const entry of sourceBrowseCatalogs(manifest)) {
    const given = entry.extra?.find((item) => item.name === 'genre')?.izumi?.images ?? {}
    for (const [genre, url] of Object.entries(given)) if (typeof url === 'string' && /^https?:\/\//.test(url)) images[genre] ??= url
  }
  return images
}

/** The address bar form of a listing; Popular and All are left out. */
export function browseSearch(sort: string, genre: string, defaultSort: string): string {
  const params = new URLSearchParams()
  if (sort && sort !== defaultSort) params.set('sort', sort)
  if (genre) params.set('genre', genre)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export const browseKey = (...parts: (string | boolean)[]): string => JSON.stringify(parts)

export interface BrowseFeed {
  media: Media[]
  /** Pages fetched so far. */
  page: number
  /** Titles received so far, duplicates included: a source pages by this (`skip`). */
  offset: number
  hasNext: boolean
}

/** Fetch page `page` (1-based); `offset` is how many titles earlier pages returned. */
export type BrowseFetch = (page: number, offset: number, signal: AbortSignal) => Promise<CatalogPage>

// A page made only of titles already shown (a source repeating itself, or filtered titles) fetches
// the next one at once; this many in a row with nothing new ends the listing.
const EMPTY_PAGES = 3

export function createBrowseFeeds(limit = 12) {
  const feeds = new Map<string, BrowseFeed>()
  const running = new Map<string, { promise: Promise<BrowseFeed>; abort: AbortController }>()

  const store = (key: string, feed: BrowseFeed) => {
    feeds.delete(key)
    feeds.set(key, feed)
    while (feeds.size > limit) feeds.delete(feeds.keys().next().value as string)
  }

  async function load(key: string, fetch: BrowseFetch, signal: AbortSignal): Promise<BrowseFeed> {
    let feed = feeds.get(key) ?? { media: [], page: 0, offset: 0, hasNext: true }
    for (let tries = 0; tries < EMPTY_PAGES; tries++) {
      const result = await fetch(feed.page + 1, feed.offset, signal)
      if (signal.aborted) throw signal.reason
      const seen = new Set(feed.media.map(mediaKey))
      const added = result.media.filter((item) => {
        const id = mediaKey(item)
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
      feed = {
        media: added.length ? [...feed.media, ...added] : feed.media,
        page: feed.page + 1,
        offset: feed.offset + result.media.length,
        hasNext: result.hasNextPage && result.media.length > 0,
      }
      store(key, feed)
      if (added.length || !feed.hasNext) return feed
    }
    feed = { ...feed, hasNext: false }
    store(key, feed)
    return feed
  }

  return {
    /** The listing as far as it has loaded, and now the most recently used. */
    cached(key: string): BrowseFeed | undefined {
      const feed = feeds.get(key)
      if (feed) store(key, feed)
      return feed
    },
    /** Load the next page of `key`. A call while one is in flight shares it. */
    more(key: string, fetch: BrowseFetch): Promise<BrowseFeed> {
      const current = running.get(key)
      if (current) return current.promise
      const done = feeds.get(key)
      if (done && !done.hasNext) return Promise.resolve(done)
      const abort = new AbortController()
      const promise = load(key, fetch, abort.signal).finally(() => {
        if (running.get(key)?.promise === promise) running.delete(key)
      })
      running.set(key, { promise, abort })
      return promise
    },
    /** Abort every listing's request but `keep`'s: the user switched away from them. */
    cancelExcept(keep: string) {
      for (const [key, run] of running) {
        if (key === keep) continue
        run.abort.abort(new DOMException('Superseded', 'AbortError'))
        running.delete(key)
      }
    },
  }
}

export type BrowseFeeds = ReturnType<typeof createBrowseFeeds>
