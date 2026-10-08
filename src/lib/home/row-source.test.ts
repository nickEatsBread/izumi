import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('$lib/anilist/client', () => ({ anilist: { query: (...args: unknown[]) => ({ toPromise: () => query(...args) }) } }))
const provider = { home: vi.fn(), search: vi.fn() }
vi.mock('$lib/catalog/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/catalog/registry')>()),
  loadCatalogProvider: vi.fn(async () => provider),
}))

const { loadRowPage, resolveRowId, rowSource, tabbableRows, clearRowSourceCache, appendUnique } = await import('./row-source')

const media = (id: number) => ({ id, title: { romaji: `T${id}` } })

describe('appending pages', () => {
  it('keeps the first copy of a title that appears on two pages', () => {
    expect(appendUnique([media(1), media(2)] as never, [media(2), media(3)] as never).map((item) => item.id)).toEqual([1, 2, 3])
  })
})

describe('row source', () => {
  beforeEach(() => {
    query.mockReset()
    provider.home.mockReset()
    provider.search.mockReset()
    clearRowSourceCache()
  })

  it('offers catalog rows and the recently aired schedule as tabs', () => {
    const rows = [{ id: 'continue', title: 'C' }, { id: 'trending', title: 'T' }, { id: 'anilist:recent', title: 'R' }, { id: 'tmdb:movies', title: 'M' }, { id: 'list', title: 'L' }, { id: 'recommendations', title: 'F' }]
    expect(tabbableRows(rows).map((row) => row.id)).toEqual(['trending', 'anilist:recent', 'tmdb:movies'])
  })

  it('resolves a tab role against the current Home', () => {
    expect(resolveRowId('anilist', 'trending', [])).toBe('trending')
    expect(resolveRowId('anilist', 'anilist:trending', [])).toBe('trending')
    expect(resolveRowId('merged', 'trending', ['continue', 'kitsu:trending', 'anilist:trending'])).toBe('kitsu:trending')
    expect(resolveRowId('merged', 'anilist:trending', ['anilist:trending'])).toBe('anilist:trending')
    expect(resolveRowId('merged', 'rated', ['anilist:trending'])).toBeNull()
  })

  it('keeps a single-catalog row id with its own colons intact instead of stripping a false "prefix"', () => {
    // Stremio row ids are `<addon origin>:<catalog>`; JVM row ids are `popular:<source>`. Neither
    // is a merged-style `provider:row` id, so resolveRowId must return them unchanged.
    const stremioId = 'https://example.test/addon:top%20rated'
    expect(resolveRowId('stremio', stremioId, [])).toBe(stremioId)
    expect(resolveRowId('jvm', 'popular:my-source', [])).toBe('popular:my-source')
  })

  it('maps rows to their source', () => {
    expect(rowSource('auto', 'trending')).toEqual({ kind: 'anilist', role: 'trending' })
    expect(rowSource('tmdb', 'movies')).toEqual({ kind: 'provider', selection: 'tmdb', rowId: 'movies' })
    expect(rowSource('merged', 'anilist:season')).toEqual({ kind: 'anilist', role: 'season' })
    expect(rowSource('merged', 'kitsu:rated')).toEqual({ kind: 'provider', selection: 'kitsu', rowId: 'rated' })
    expect(rowSource('merged', 'nonsense')).toBeNull()
  })

  it('pages AniList rows with the row filters', async () => {
    query.mockResolvedValue({ data: { Page: { pageInfo: { hasNextPage: true, lastPage: 9 }, media: [media(1), media(2)] } } })
    const page = await loadRowPage('anilist', 'romance', 2, 18)
    expect(page).toEqual({ media: [media(1), media(2)], hasNextPage: true, lastPage: 9 })
    expect(query.mock.calls[0][1]).toMatchObject({ page: 2, perPage: 18, genre: 'Romance', sort: ['TRENDING_DESC'] })
    await expect(loadRowPage('anilist', 'recommendations', 1, 18)).resolves.toEqual({ media: [], hasNextPage: false })
  })

  it('pages the Popular Movies row with a format filter and no status variable', async () => {
    query.mockResolvedValue({ data: { Page: { pageInfo: { hasNextPage: false, lastPage: 1 }, media: [media(4)] } } })
    const page = await loadRowPage('anilist', 'movies', 1, 18)
    expect(page).toEqual({ media: [media(4)], hasNextPage: false, lastPage: 1 })
    expect(query.mock.calls[0][1]).toMatchObject({ page: 1, perPage: 18, format: 'MOVIE', sort: ['POPULARITY_DESC'] })
    expect(query.mock.calls[0][1]).not.toHaveProperty('status')
  })

  describe('the recently aired row', () => {
    const release = (id: number, episode: number, extra: Record<string, unknown> = {}) => ({ episode, airingAt: 1_000 - id, media: { ...media(id), ...extra } })
    const schedule = (releases: unknown[]) => ({ data: { Page: { airingSchedules: releases } } })

    it('pages the airing schedule newest first, one entry per show at its latest episode', async () => {
      query.mockResolvedValueOnce(schedule([release(1, 12), release(2, 5), release(1, 11), release(3, 8), release(2, 4)]))
      const page = await loadRowPage('anilist', 'recent', 1, 2)
      expect(page).toEqual({ media: [media(1), media(2)], hasNextPage: true, episodes: { 1: 12, 2: 5 } })
      // Newest first over the Recently Released row's window, read once for both pages.
      const vars = query.mock.calls[0][1]
      expect(vars).toMatchObject({ page: 1, perPage: 50 })
      expect(vars.before - vars.after).toBe(21 * 86_400)
      expect(await loadRowPage('anilist', 'recent', 2, 2)).toEqual({ media: [media(3)], hasNextPage: false, episodes: { 3: 8 } })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('reads further schedule pages until a page of shows is full', async () => {
      const first = Array.from({ length: 50 }, (_, index) => release(1 + (index % 2), 50 - index))
      query.mockResolvedValueOnce(schedule(first)).mockResolvedValueOnce(schedule([release(3, 2), release(4, 1)]))
      const page = await loadRowPage('anilist', 'recent', 1, 3)
      expect(page.media.map((item) => item.id)).toEqual([1, 2, 3])
      expect(page.hasNextPage).toBe(true)
      expect(query.mock.calls[1][1]).toMatchObject({ page: 2 })
    })

    it('leaves out adult titles and the ones dismissed from the Recently Released row', async () => {
      const { dismissedRecentReleaseIds } = await import('$lib/settings/ui')
      dismissedRecentReleaseIds.set([2])
      query.mockResolvedValueOnce(schedule([release(1, 3), release(2, 4), release(3, 5, { isAdult: true }), { episode: 1, airingAt: 1, media: null }]))
      expect((await loadRowPage('anilist', 'recent', 1, 10)).media.map((item) => item.id)).toEqual([1])
      dismissedRecentReleaseIds.set([])
    })

    it('resolves on the merged Home and surfaces errors', async () => {
      expect(resolveRowId('merged', 'recent', ['continue', 'anilist:recent'])).toBe('anilist:recent')
      expect(rowSource('merged', 'anilist:recent')).toEqual({ kind: 'anilist', role: 'recent' })
      query.mockResolvedValueOnce({ error: new Error('rate limited') })
      await expect(loadRowPage('merged', 'anilist:recent', 1, 10)).rejects.toThrow('rate limited')
    })
  })

  it('surfaces AniList errors', async () => {
    query.mockResolvedValue({ error: new Error('rate limited') })
    await expect(loadRowPage('anilist', 'trending', 1, 18)).rejects.toThrow('rate limited')
  })

  it('pages provider rows through search, loading the section once', async () => {
    provider.home.mockResolvedValue({ hero: [], sections: [{ id: 'movies', title: 'Movies', media: [media(5)], more: { type: 'movie', sort: 'popular' } }] })
    provider.search.mockResolvedValue({ media: [media(7), media(8)], page: 2, hasNextPage: false })
    expect(await loadRowPage('tmdb', 'movies', 2, 18)).toEqual({ media: [media(7), media(8)], hasNextPage: false })
    expect(provider.search.mock.calls[0][0]).toMatchObject({ type: 'movie', sort: 'popular', page: 2 })
    await loadRowPage('tmdb', 'movies', 1, 18)
    expect(provider.home).toHaveBeenCalledTimes(1)
    expect(provider.home.mock.calls[0][1]).toEqual(['movies'])
  })

  it('treats a section without "more" as one page and a providers section as empty', async () => {
    provider.home.mockImplementation(async (_signal: unknown, ids: string[]) => ({
      hero: [],
      sections: ids[0] === 'pick' ? [{ id: 'pick', title: 'Pick', media: [media(1), media(2), media(3)] }] : [{ id: 'services', title: 'S', media: [media(9)], presentation: 'providers' }],
    }))
    expect(await loadRowPage('tmdb', 'pick', 1, 2)).toEqual({ media: [media(1), media(2)], hasNextPage: false })
    expect(await loadRowPage('tmdb', 'pick', 2, 2)).toEqual({ media: [], hasNextPage: false })
    expect(await loadRowPage('tmdb', 'services', 1, 18)).toEqual({ media: [], hasNextPage: false })
  })

  it("does not let one caller's abort reject another caller sharing the same section load", async () => {
    let resolveHome!: (value: { hero: never[]; sections: { id: string; title: string; media: unknown[] }[] }) => void
    provider.home.mockImplementation(() => new Promise((resolve) => { resolveHome = resolve }))
    const controllerA = new AbortController()
    const pageA = loadRowPage('tmdb', 'movies', 1, 18, controllerA.signal)
    const pageB = loadRowPage('tmdb', 'movies', 1, 18)
    controllerA.abort()
    await expect(pageA).rejects.toMatchObject({ name: 'AbortError' })
    resolveHome({ hero: [], sections: [{ id: 'movies', title: 'Movies', media: [media(1)] }] })
    await expect(pageB).resolves.toEqual({ media: [media(1)], hasNextPage: false })
    expect(provider.home).toHaveBeenCalledTimes(1)
  })

  it('does not cache a section that resolves to nothing, so a later call retries instead of staying empty', async () => {
    provider.home.mockResolvedValueOnce({ hero: [], sections: [] })
    expect(await loadRowPage('tmdb', 'missing-row', 1, 18)).toEqual({ media: [], hasNextPage: false })
    expect(provider.home).toHaveBeenCalledTimes(1)
    provider.home.mockResolvedValueOnce({ hero: [], sections: [{ id: 'missing-row', title: 'Now here', media: [media(1)] }] })
    expect(await loadRowPage('tmdb', 'missing-row', 1, 18)).toEqual({ media: [media(1)], hasNextPage: false })
    expect(provider.home).toHaveBeenCalledTimes(2)
  })
})
