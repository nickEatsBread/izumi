import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media } from '$lib/anilist/types'

const mocks = vi.hoisted(() => ({ anilist: vi.fn(), tmdb: vi.fn() }))
vi.mock('$lib/anilist/abortable-query', () => ({ queryAniList: mocks.anilist }))
vi.mock('$lib/catalog/providers/tmdb', () => ({ tmdbTrending: mocks.tmdb }))

const { showAdult } = await import('$lib/settings/ui')
const { trendingSections } = await import('./trending')

const media = (id: number, english: string): Media => ({ id, title: { english } })
const titles = async (selections: Parameters<typeof trendingSections>[0]) =>
  (await Promise.all(trendingSections(selections))).map((row) => row && row.title)

let adult = false
beforeEach(() => {
  // Each test reads a fresh cache slot: the 18+ setting is part of the key.
  adult = !adult
  showAdult.set(adult)
  mocks.anilist.mockReset().mockResolvedValue({ data: { Page: { media: [media(1, 'Anime')] } } })
  mocks.tmdb.mockReset().mockResolvedValue([media(-1, 'Film')])
})

describe('Search page trending rows', () => {
  it("asks each enabled catalog's trending list once, in the catalogs' order, and skips catalogs without one", async () => {
    expect(await titles(['tmdb', 'auto', 'anilist', 'stremio', 'jvm'])).toEqual(['Trending movies & TV', 'Trending anime'])
    expect(await titles(['auto', 'tmdb'])).toEqual(['Trending anime', 'Trending movies & TV'])
    expect(mocks.anilist).toHaveBeenCalledTimes(1)
    expect(mocks.tmdb).toHaveBeenCalledTimes(1)
  })

  it('asks a failed list again next time, and shows no row for an empty one', async () => {
    mocks.tmdb.mockRejectedValueOnce(new Error('offline'))
    mocks.anilist.mockResolvedValue({ data: { Page: { media: [] } } })
    expect(await titles(['auto', 'tmdb'])).toEqual([null, null])
    expect(await titles(['auto', 'tmdb'])).toEqual([null, 'Trending movies & TV'])
    expect(mocks.anilist).toHaveBeenCalledTimes(1)
    expect(mocks.tmdb).toHaveBeenCalledTimes(2)
  })
})
