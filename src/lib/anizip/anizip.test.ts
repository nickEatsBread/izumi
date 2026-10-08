import { beforeEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  phttp: vi.fn(),
}))

vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))

import { episodeRatingPercent, fetchAniZip, getEpisodeMeta, getEpisodeSeasonMap, getExtensionIds, parseEpisodes } from './index'

const RES = {
  episodes: {
    '1': { image: 'i.jpg', title: { en: 'Ep One', ja: 'x' }, rating: '7.8', overview: 'o', airDate: '2024-01-02', runtime: 24 },
    S1: { title: { en: 'special' } },
  },
}

describe('parseEpisodes', () => {
  it('maps numeric episode keys to EpMeta', () => {
    const m = parseEpisodes(RES as any)
    expect(m[1].title).toBe('Ep One')
    expect(m[1]).toMatchObject({ airDate: '2024-01-02', runtime: 24 })
    expect(m[1].image).toBe('i.jpg')
    expect(m[1].rating).toBeCloseTo(7.8)
  })
  it('ignores non-numeric (special) keys', () => expect((parseEpisodes(RES as any) as any).S1).toBeUndefined())
  it('empty on missing', () => expect(Object.keys(parseEpisodes(undefined as any)).length).toBe(0))
  it('keeps the season and the number within it', () => {
    const m = parseEpisodes({ episodes: { '1': { seasonNumber: 4, episodeNumber: 17, absoluteEpisodeNumber: 76 } } } as any)
    expect(m[1]).toMatchObject({ season: 4, seasonEpisode: 17, abs: 76 })
  })
  it('repairs a premiere the mapping paired with the next episode', () => {
    const m = parseEpisodes(LAGGING_SEASON as any)
    expect(m[2]).toMatchObject({ season: 2, seasonEpisode: 2, abs: 14, title: 'Jean du Vix Knows His Stuff' })
    expect(m[3]).toMatchObject({ season: 2, seasonEpisode: 3, abs: 15 })
  })
})

// A second season whose AniList air dates run a week ahead of the episode database: the mapping
// pairs episode 2 with S2E1 and every later episode inherits the lag.
const LAGGING_SEASON = {
  mappings: { kitsu_id: 46917, imdb_id: 'tt15483602', thetvdb_id: 410378, anidb_id: 17789 },
  episodes: {
    '1': { seasonNumber: 2, episodeNumber: 1, absoluteEpisodeNumber: 13, tvdbId: 11877773, anidbEid: 316835, title: { en: 'The Floating Island' } },
    '2': { seasonNumber: 2, episodeNumber: 1, absoluteEpisodeNumber: 13, tvdbId: 11877773, anidbEid: 316836, title: { en: 'Jean du Vix Knows His Stuff' } },
    '3': { seasonNumber: 2, episodeNumber: 2, absoluteEpisodeNumber: 14, tvdbId: 12009468, anidbEid: 316837 },
  },
}

describe('repaired episode coordinates', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.set.mockReset()
    mocks.phttp.mockReset()
    mocks.get.mockImplementation(async (key: string) => key.endsWith('-fetched-at') ? Date.now() : LAGGING_SEASON)
  })

  it('asks sources for the repaired episode, not the one the mapping lagged onto', async () => {
    await expect(getExtensionIds(159042, 2)).resolves.toMatchObject({
      imdbId: 'tt15483602', season: 2, episodeNumber: 2, absoluteEpisodeNumber: 14,
      tvdbEId: 12009468, anidbEid: 316836,
      mappingsE: { seasonNumber: 2, episodeNumber: 2, absoluteEpisodeNumber: 14 },
    })
    expect(mocks.phttp).not.toHaveBeenCalled()
  })

  it('verifies files against the repaired season map', async () => {
    await expect(getEpisodeSeasonMap(159042)).resolves.toEqual({
      1: { season: 2, abs: 13 }, 2: { season: 2, abs: 14 }, 3: { season: 2, abs: 15 },
    })
  })
})

describe('episodeRatingPercent', () => {
  it('shows scores only after an episode has aired', () => {
    expect(episodeRatingPercent(8.4, true)).toBe(84)
    expect(episodeRatingPercent(8.4, false)).toBeUndefined()
  })
})

describe('fetchAniZip watched titles', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.get.mockReset()
    mocks.set.mockReset()
    mocks.phttp.mockReset()
  })

  it('refreshes a legacy cache when a watched episode title is missing', async () => {
    const stale = { episodes: { '1': { image: 'one.jpg', title: { en: 'One' } }, '2': { image: 'two.jpg' } } }
    const fresh = { episodes: { ...stale.episodes, '2': { image: 'two.jpg', title: { en: 'Two' } } } }
    mocks.get.mockResolvedValueOnce(stale).mockResolvedValueOnce(undefined)
    mocks.phttp.mockResolvedValue({ ok: true, json: async () => fresh })

    await expect(fetchAniZip(7, undefined, 2)).resolves.toBe(fresh)
    expect(mocks.phttp).toHaveBeenCalledOnce()
    expect(mocks.set).toHaveBeenCalledTimes(2)
  })

  it('uses a recent cache while a missing title is on cooldown', async () => {
    const now = 1_000_000
    const cached = { episodes: { '1': { image: 'one.jpg' } } }
    vi.spyOn(Date, 'now').mockReturnValue(now)
    mocks.get.mockResolvedValueOnce(cached).mockResolvedValueOnce(now - 1_000)

    await expect(fetchAniZip(7, undefined, 1)).resolves.toBe(cached)
    expect(mocks.phttp).not.toHaveBeenCalled()
  })

  it('uses the cache when every watched episode already has a title', async () => {
    const cached = { episodes: { '1': { title: { en: 'One' } }, '2': { title: { 'x-jat': 'Ni' } } } }
    mocks.get.mockResolvedValueOnce(cached).mockResolvedValueOnce(undefined)

    await expect(fetchAniZip(7, undefined, 2)).resolves.toBe(cached)
    expect(mocks.phttp).not.toHaveBeenCalled()
  })

  it('returns stale episode art immediately and publishes a background refresh', async () => {
    const now = 100 * 24 * 60 * 60 * 1000
    const cached = { episodes: { '1': { image: 'old.jpg', title: { en: 'Old' } } } }
    const fresh = { episodes: { '1': { image: 'new.jpg', title: { en: 'New' } } } }
    vi.spyOn(Date, 'now').mockReturnValue(now)
    // getEpisodeMeta's immediate read, followed by fetchAniZip's cache + timestamp reads.
    mocks.get.mockResolvedValueOnce(cached).mockResolvedValueOnce(cached).mockResolvedValueOnce(0)
    mocks.phttp.mockResolvedValue({ ok: true, json: async () => fresh })
    const refreshed = vi.fn()

    const initial = await getEpisodeMeta(7, undefined, refreshed)

    expect(initial[1]).toMatchObject({ image: 'old.jpg', title: 'Old' })
    await vi.waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
    expect(refreshed.mock.calls[0][0][1]).toMatchObject({ image: 'new.jpg', title: 'New' })
  })

  it('shares one network refresh across callers with different episode requirements', async () => {
    let release!: (value: unknown) => void
    mocks.get.mockResolvedValue(undefined)
    mocks.phttp.mockReturnValue(new Promise((resolve) => { release = resolve }))

    const general = fetchAniZip(7)
    const episodeSpecific = fetchAniZip(7, 2)
    await vi.waitFor(() => expect(mocks.phttp).toHaveBeenCalledOnce())

    release({ ok: true, json: async () => RES })
    await expect(general).resolves.toBe(RES)
    await expect(episodeSpecific).resolves.toBe(RES)
    expect(mocks.set).toHaveBeenCalledTimes(2)
  })
})
