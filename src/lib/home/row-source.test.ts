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

  it('offers only catalog rows as tabs', () => {
    const rows = [{ id: 'continue', title: 'C' }, { id: 'trending', title: 'T' }, { id: 'anilist:recent', title: 'R' }, { id: 'tmdb:movies', title: 'M' }, { id: 'list', title: 'L' }]
    expect(tabbableRows(rows).map((row) => row.id)).toEqual(['trending', 'tmdb:movies'])
  })

  it('resolves a tab role against the current Home', () => {
    expect(resolveRowId('anilist', 'trending', [])).toBe('trending')
    expect(resolveRowId('anilist', 'anilist:trending', [])).toBe('trending')
    expect(resolveRowId('merged', 'trending', ['continue', 'kitsu:trending', 'anilist:trending'])).toBe('kitsu:trending')
    expect(resolveRowId('merged', 'anilist:trending', ['anilist:trending'])).toBe('anilist:trending')
    expect(resolveRowId('merged', 'rated', ['anilist:trending'])).toBeNull()
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
})
