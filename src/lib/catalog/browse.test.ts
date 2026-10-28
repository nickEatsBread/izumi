import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import type { AddonManifest } from '$lib/stremio/manifest'
import {
  anilistBrowseFilters, browseSearch, browseSorts, createBrowseFeeds, pickBrowseSort,
  sourceBrowseCatalogs, sourceBrowseGenres, sourceBrowseSorts, type BrowseFetch,
} from './browse'
import type { CatalogPage } from './types'

const media = (id: number) => ({ id, title: { romaji: `T${id}` } }) as Media
const page = (ids: number[], hasNextPage = true): CatalogPage => ({ media: ids.map(media), page: 1, hasNextPage })

describe('browse sorts', () => {
  it('leads every catalog with Popular and Newest, and offers only what its search can order by', () => {
    expect(browseSorts('anilist').map((sort) => sort.value)).toEqual(['popular', 'recent', 'title', 'rating', 'trending'])
    expect(browseSorts('auto')).toEqual(browseSorts('anilist'))
    expect(browseSorts('kitsu').map((sort) => sort.value)).toEqual(['popular', 'recent', 'rating'])
    expect(browseSorts('jvm').map((sort) => sort.value)).toEqual(['popular', 'recent'])
    expect(browseSorts('tmdb').map((sort) => sort.label)).toEqual(['Popular', 'Newest', 'A–Z', 'Top rated'])
  })

  it('falls back to the first sort for a value the catalog does not offer', () => {
    expect(pickBrowseSort('title', browseSorts('anilist'))).toBe('title')
    expect(pickBrowseSort('title', browseSorts('jvm'))).toBe('popular')
    expect(pickBrowseSort(null, [{ value: 'series:cr-new', label: 'New' }])).toBe('series:cr-new')
  })

  it('maps to AniList sorts, and Newest leaves out titles that have not started', () => {
    expect(anilistBrowseFilters('title', 'Action')).toEqual({ sort: 'TITLE_ROMAJI', genres: ['Action'], statuses: undefined })
    expect(anilistBrowseFilters('recent', '')).toEqual({ sort: 'START_DATE_DESC', genres: undefined, statuses: ['RELEASING', 'FINISHED'] })
    expect(anilistBrowseFilters('nonsense', '').sort).toBe('POPULARITY_DESC')
  })

  it('writes only what differs from the default view into the address bar', () => {
    expect(browseSearch('popular', '', 'popular')).toBe('')
    expect(browseSearch('title', 'Slice of Life', 'popular')).toBe('?sort=title&genre=Slice+of+Life')
    expect(browseSearch('popular', 'Action', 'popular')).toBe('?genre=Action')
  })
})

describe('source listings', () => {
  const manifest = {
    id: 'x', name: 'Source', version: '1', resources: [], types: ['series'],
    catalogs: [
      { type: 'series', id: 'hero', name: 'Featured', izumi: { hero: true }, extra: [{ name: 'skip' }] },
      { type: 'series', id: 'history', name: 'Continue', izumi: { continue: true } },
      { type: 'series', id: 'popular', name: 'Popular', extra: [{ name: 'skip' }, { name: 'genre', options: ['Action', 'Drama', 'Action'] }] },
      { type: 'series', id: 'new', name: 'New', extra: [{ name: 'skip' }] },
      { type: 'series', id: 'watchlist', name: 'Watchlist' },
      { type: 'series', id: 'search', name: 'Search', extra: [{ name: 'search', isRequired: true }, { name: 'skip' }] },
    ],
  } as unknown as AddonManifest

  it('are the paged listings that need nothing typed, not the banner, Continue Watching or Home rows', () => {
    expect(sourceBrowseCatalogs(manifest).map((entry) => entry.id)).toEqual(['popular', 'new'])
    expect(sourceBrowseSorts(manifest)).toEqual([{ value: 'series:popular', label: 'Popular' }, { value: 'series:new', label: 'New' }])
  })

  it('take the categories their own genre extra lists', () => {
    const [popular, newest] = sourceBrowseCatalogs(manifest)
    expect(sourceBrowseGenres(popular)).toEqual(['Action', 'Drama'])
    expect(sourceBrowseGenres(newest)).toEqual([])
    expect(sourceBrowseGenres(undefined)).toEqual([])
  })
})

describe('browse feeds', () => {
  it('appends pages without repeating a title, and remembers how far a listing got', async () => {
    const feeds = createBrowseFeeds()
    const calls: [number, number][] = []
    const fetch: BrowseFetch = async (n, offset) => {
      calls.push([n, offset])
      return n === 1 ? page([1, 2, 3]) : page([3, 4], false)
    }
    expect((await feeds.more('a', fetch)).media.map((item) => item.id)).toEqual([1, 2, 3])
    const second = await feeds.more('a', fetch)
    expect(second.media.map((item) => item.id)).toEqual([1, 2, 3, 4])
    expect(second.hasNext).toBe(false)
    expect(calls).toEqual([[1, 0], [2, 3]])
    // An ended listing is not asked again, and a return to it is served from memory.
    await feeds.more('a', fetch)
    expect(calls).toHaveLength(2)
    expect(feeds.cached('a')).toBe(second)
  })

  it('shares one request between calls made while it is in flight', async () => {
    const feeds = createBrowseFeeds()
    let calls = 0
    const fetch: BrowseFetch = async () => { calls++; return page([1]) }
    const [first, second] = await Promise.all([feeds.more('a', fetch), feeds.more('a', fetch)])
    expect(first).toBe(second)
    expect(calls).toBe(1)
  })

  it('cancels the requests of listings switched away from, and caches nothing from them', async () => {
    const feeds = createBrowseFeeds()
    const signals: AbortSignal[] = []
    const stalled: BrowseFetch = (_n, _o, signal) => {
      signals.push(signal)
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
    }
    const stale = feeds.more('old', stalled)
    const kept = feeds.more('new', async (_n, _o, signal) => { signals.push(signal); return page([9]) })
    feeds.cancelExcept('new')
    await expect(stale).rejects.toThrow()
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    expect((await kept).media).toHaveLength(1)
    expect(feeds.cached('old')).toBeUndefined()
  })

  it('reads on past pages that added nothing, then ends a listing that keeps repeating itself', async () => {
    const feeds = createBrowseFeeds()
    let calls = 0
    const repeat: BrowseFetch = async () => { calls++; return page([1]) }
    await feeds.more('a', repeat)
    const ended = await feeds.more('a', repeat)
    expect(calls).toBe(4)
    expect(ended.hasNext).toBe(false)
    expect(ended.offset).toBe(4)
  })

  it('keeps only the most recently used listings', async () => {
    const feeds = createBrowseFeeds(2)
    const fetch: BrowseFetch = async () => page([1])
    await feeds.more('a', fetch)
    await feeds.more('b', fetch)
    feeds.cached('a')
    await feeds.more('c', fetch)
    expect(feeds.cached('b')).toBeUndefined()
    expect(feeds.cached('a')).toBeDefined()
    expect(feeds.cached('c')).toBeDefined()
  })
})
