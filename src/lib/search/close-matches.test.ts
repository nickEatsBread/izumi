import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media } from '$lib/anilist/types'

const mocks = vi.hoisted(() => ({ kitsu: vi.fn(), anilist: vi.fn(), degraded: vi.fn(() => false) }))
vi.mock('$lib/anilist/kitsu-catalog', () => ({ searchKitsuTitles: mocks.kitsu }))
vi.mock('$lib/anilist/abortable-query', () => ({ queryAniList: mocks.anilist }))
vi.mock('$lib/anilist/degraded', () => ({ shouldUseJikanCatalog: mocks.degraded }))

import { showAdult } from '$lib/settings/ui'
import { clearCloseMatchCache, closeMatches, filteredCloseMatches, lookUpCloseMatches, probeQueries } from './close-matches'

const media = (id: number, english: string, extra: Partial<Media> = {}): Media => ({
  id, title: { english, romaji: extra.title?.romaji }, popularity: 1000, ...extra,
})

beforeEach(() => {
  clearCloseMatchCache()
  showAdult.set(false)
  mocks.kitsu.mockReset().mockResolvedValue([])
  mocks.anilist.mockReset().mockResolvedValue({ data: {} })
  mocks.degraded.mockReset().mockReturnValue(false)
})

describe('probeQueries', () => {
  it('joins words typed apart', () => {
    expect(probeQueries('tora dora')).toContain('toradora')
  })

  it('tries the start of words typed together', () => {
    expect(probeQueries('oshinoko')).toEqual(['oshi'])
    expect(probeQueries('madeinabyss')).toEqual(['made'])
    expect(probeQueries('kimi no nawa')).toContain('kimi')
  })

  it('writes words the way titles abbreviate them', () => {
    expect(probeQueries('kaiju number 8')).toContain('kaiju no 8')
    expect(probeQueries('doctor stone')).toContain('dr stone')
  })

  it('has nothing to try for a short single word', () => {
    expect(probeQueries('naruto')).toEqual([])
  })

  it('tries three spellings at most', () => {
    expect(probeQueries('mister number one piece').length).toBeLessThanOrEqual(3)
  })
})

describe('closeMatches', () => {
  it("keeps the typo-tolerant hits that match the query, best first, and drops Kitsu's noise", async () => {
    mocks.kitsu.mockResolvedValue([
      media(1, 'Haru'),
      media(154587, 'Frieren: Beyond Journey’s End', { popularity: 480_000 }),
      media(182255, 'Frieren: Beyond Journey’s End Season 2', { popularity: 220_000 }),
      media(2, 'Yuusha'),
    ])
    const found = await closeMatches('freiren')
    expect(found.map((item) => item.id)).toEqual([154587, 182255])
    expect(mocks.anilist).not.toHaveBeenCalled()
  })

  it('orders its hits like live search does: own titles first, no obscure synonym-only namesake', async () => {
    mocks.kitsu.mockResolvedValue([
      media(142329, 'Demon Slayer: Kimetsu no Yaiba - Entertainment District Arc', { popularity: 125_297 }),
      media(1, 'Onigiri', { synonyms: ['Demon Slayer'], popularity: 3_650 }),
      media(101922, 'Demon Slayer: Kimetsu no Yaiba', { popularity: 402_983 }),
    ])
    expect((await closeMatches('dmon slayer')).map((item) => item.id)).toEqual([101922, 142329])
  })

  it('asks AniList for respellings when the typo-tolerant search has nothing close', async () => {
    mocks.kitsu.mockResolvedValue([media(21038, 'Ushio and Tora')])
    mocks.anilist.mockResolvedValue({ data: {
      p0: { media: [media(4224, 'Toradora!', { popularity: 500_000 })] },
      p1: { media: [media(21038, 'Ushio and Tora')] },
    } })
    const found = await closeMatches('tora dora')
    expect(found.map((item) => item.id)).toEqual([4224])
    expect(mocks.anilist).toHaveBeenCalledTimes(1)
    const [, variables] = mocks.anilist.mock.calls[0]
    expect(Object.values(variables)).toContain('toradora')
  })

  it('still tries respellings when Kitsu cannot be reached', async () => {
    mocks.kitsu.mockRejectedValue(new Error('Kitsu returned HTTP 503'))
    mocks.anilist.mockResolvedValue({ data: { p0: { media: [media(150672, 'Oshi no Ko')] } } })
    expect((await closeMatches('oshinoko')).map((item) => item.id)).toEqual([150672])
  })

  it('answers nothing, rather than failing the search, when neither lookup works', async () => {
    mocks.kitsu.mockRejectedValue(new Error('offline'))
    mocks.anilist.mockRejectedValue(new Error('offline'))
    await expect(closeMatches('oshinoko')).resolves.toEqual([])
  })

  it('hides adult titles unless 18+ is shown', async () => {
    mocks.kitsu.mockResolvedValue([media(5, 'Freiren Nights', { isAdult: true }), media(154587, 'Frieren')])
    expect((await closeMatches('freiren')).map((item) => item.id)).toEqual([154587])
    clearCloseMatchCache()
    showAdult.set(true)
    expect((await closeMatches('freiren')).map((item) => item.id)).toContain(5)
  })

  it('remembers an answer for the same query', async () => {
    mocks.kitsu.mockResolvedValue([media(154587, 'Frieren')])
    await closeMatches('freiren')
    await closeMatches('  Freiren ')
    expect(mocks.kitsu).toHaveBeenCalledTimes(1)
  })

  it('does not look up one or two letters', async () => {
    expect(await closeMatches('fr')).toEqual([])
    expect(mocks.kitsu).not.toHaveBeenCalled()
  })

  it('gives up when the search is abandoned, without remembering a partial answer', async () => {
    const abort = new AbortController()
    mocks.kitsu.mockImplementation(async () => {
      abort.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(closeMatches('freiren', { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
    mocks.kitsu.mockResolvedValue([media(154587, 'Frieren')])
    expect((await closeMatches('freiren')).map((item) => item.id)).toEqual([154587])
  })
})

describe('filteredCloseMatches', () => {
  const frieren = media(154587, 'Frieren: Beyond Journey’s End', { popularity: 480_000 })
  const season2 = media(182255, 'Frieren: Beyond Journey’s End Season 2', { popularity: 220_000 })

  it("re-reads the close matches from AniList under the page's filters, in close-match order", async () => {
    mocks.kitsu.mockResolvedValue([frieren, season2])
    mocks.anilist.mockResolvedValue({ data: { Page: { media: [{ ...season2, genres: ['Adventure'] }, { ...frieren, genres: ['Adventure'] }] } } })
    const found = await filteredCloseMatches({ search: 'freiren', genres: ['Adventure'], year: 2023 })
    expect(found.map((item) => item.id)).toEqual([154587, 182255])
    expect(found[0].genres).toEqual(['Adventure'])
    const [, variables] = mocks.anilist.mock.calls[0]
    expect(variables).toMatchObject({ ids: [154587, 182255], genre_in: ['Adventure'], seasonYear: 2023, perPage: 2 })
    expect(variables).not.toHaveProperty('search')
  })

  it('leaves out what the filters exclude and what the page already shows', async () => {
    mocks.kitsu.mockResolvedValue([frieren, season2])
    mocks.anilist.mockResolvedValue({ data: { Page: { media: [season2] } } })
    const found = await filteredCloseMatches({ search: 'freiren', genres: ['Comedy'] }, { exclude: new Set([154587]) })
    expect(found.map((item) => item.id)).toEqual([182255])
    expect(mocks.anilist.mock.calls[0][1]).toMatchObject({ ids: [182255] })
  })

  it('shows the close matches as they are when AniList cannot re-read an unfiltered search', async () => {
    mocks.kitsu.mockResolvedValue([frieren])
    mocks.anilist.mockResolvedValue({ error: new Error('Too Many Requests.') })
    expect((await filteredCloseMatches({ search: 'freiren' })).map((item) => item.id)).toEqual([154587])
  })

  it('shows nothing it cannot check against the filters', async () => {
    mocks.kitsu.mockResolvedValue([frieren])
    mocks.anilist.mockResolvedValue({ error: new Error('Too Many Requests.') })
    expect(await filteredCloseMatches({ search: 'freiren', genres: ['Comedy'] })).toEqual([])
  })

  it('needs a text query', async () => {
    expect(await filteredCloseMatches({ genres: ['Comedy'] })).toEqual([])
    expect(mocks.kitsu).not.toHaveBeenCalled()
  })
})

describe('respelling lookups', () => {
  it('asks AniList once for the same respellings while a glued word is typed out', async () => {
    mocks.anilist.mockResolvedValue({ data: { p0: { media: [media(97986, 'Made in Abyss')] } } })
    expect((await closeMatches('madeinaby')).map((item) => item.id)).toEqual([97986])
    expect((await closeMatches('madeinabyss')).map((item) => item.id)).toEqual([97986])
    expect(mocks.anilist).toHaveBeenCalledTimes(1)
  })

  it('does not remember a refused request, such as a rate-limited one', async () => {
    mocks.anilist.mockResolvedValueOnce({ error: new Error('Too Many Requests.') })
    expect(await closeMatches('oshinoko')).toEqual([])
    mocks.anilist.mockResolvedValue({ data: { p0: { media: [media(150672, 'Oshi no Ko')] } } })
    expect((await closeMatches('oshinoko')).map((item) => item.id)).toEqual([150672])
  })
})

describe('filteredCloseMatches order', () => {
  it("orders re-read matches by AniList's own titles and popularity", async () => {
    // Kitsu calls the promo video exactly what it calls the series.
    mocks.kitsu.mockResolvedValue([
      media(113415, 'Jujutsu Kaisen', { popularity: 235_358 }),
      media(101343, 'Jujutsu Kaisen', { popularity: 1_651 }),
      media(145064, 'Jujutsu Kaisen Season 2', { popularity: 32_831 }),
    ])
    mocks.anilist.mockResolvedValue({ data: { Page: { media: [
      media(101343, 'Jujutsu Kaisen PV', { popularity: 20_000 }),
      media(145064, 'Jujutsu Kaisen Season 2', { popularity: 400_000 }),
      media(113415, 'Jujutsu Kaisen', { popularity: 900_000 }),
    ] } } })
    const found = await filteredCloseMatches({ search: 'jujustu kaisen' })
    expect(found.map((item) => item.id)).toEqual([113415, 145064, 101343])
  })
})

describe('respellings only when needed', () => {
  it("waits for the caller's own AniList answer and skips respellings when it already holds the title", async () => {
    let answer: (value: unknown) => void = () => {}
    const answered = new Promise((resolve) => { answer = resolve })
    let found = false
    const pending = lookUpCloseMatches('tora dora', { answered, found: () => found })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(mocks.anilist).not.toHaveBeenCalled()
    found = true
    answer(undefined)
    await expect(pending).resolves.toEqual({ media: [], complete: true })
    expect(mocks.anilist).not.toHaveBeenCalled()
  })

  it('does not remember an answer that skipped the respellings for its caller', async () => {
    await lookUpCloseMatches('tora dora', { found: () => true })
    mocks.anilist.mockResolvedValue({ data: { p0: { media: [media(4224, 'Toradora!')] } } })
    expect((await closeMatches('tora dora')).map((item) => item.id)).toEqual([4224])
  })

  it('makes no AniList request while AniList is degraded, and says the answer is incomplete', async () => {
    mocks.degraded.mockReturnValue(true)
    await expect(lookUpCloseMatches('oshinoko')).resolves.toEqual({ media: [], complete: false })
    expect(mocks.anilist).not.toHaveBeenCalled()
  })

  it('reports a failed lookup as incomplete', async () => {
    mocks.kitsu.mockRejectedValue(new Error('Kitsu returned HTTP 503'))
    await expect(lookUpCloseMatches('naruto')).resolves.toEqual({ media: [], complete: false })
  })
})

describe('filteredCloseMatches without AniList', () => {
  it('uses the close matches as they are while AniList is degraded, for an unfiltered search', async () => {
    mocks.kitsu.mockResolvedValue([media(154587, 'Frieren')])
    mocks.degraded.mockReturnValue(true)
    expect((await filteredCloseMatches({ search: 'freiren' })).map((item) => item.id)).toEqual([154587])
    expect(await filteredCloseMatches({ search: 'freiren', genres: ['Comedy'] })).toEqual([])
    expect(mocks.anilist).not.toHaveBeenCalled()
  })

  it('does not send a sort without a search to AniList', async () => {
    mocks.kitsu.mockResolvedValue([media(154587, 'Frieren')])
    mocks.anilist.mockResolvedValue({ data: { Page: { media: [media(154587, 'Frieren')] } } })
    await filteredCloseMatches({ search: 'freiren', sort: 'SEARCH_MATCH' })
    expect(mocks.anilist.mock.calls[0][1]).not.toHaveProperty('sort')
  })
})
