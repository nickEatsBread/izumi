import { beforeEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  phttp: vi.fn(),
}))

vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))

import { episodeRatingPercent, fetchAniZip, parseEpisodes } from './index'

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
})
