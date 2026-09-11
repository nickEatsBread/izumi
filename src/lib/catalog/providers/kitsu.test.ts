import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ http: vi.fn(), get: vi.fn(), set: vi.fn(), airing: vi.fn() }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.http }))
vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set, del: vi.fn() }))
vi.mock('$lib/anime/animeschedule', () => ({
  getAiringProgress: mocks.airing,
  scheduleTitles: (title: { romaji?: string; english?: string }) => [title.romaji, title.english],
}))

import { kitsuCatalog } from './kitsu'
import { getIndex } from '$lib/stremio/idmap'
import { airedCount } from '$lib/anilist/media'
import { normalizeAnimeDetail } from '$lib/catalog/anime-detail'

const anime = {
  id: '42',
  attributes: { canonicalTitle: 'Example', slug: 'example', status: 'current', episodeCount: 12 },
  relationships: { mappings: { data: [{ id: '1', type: 'mappings' }] } },
}
const anilistOnly = [{ id: '1', type: 'mappings', attributes: { externalSite: 'anilist/anime', externalId: '7' } }]

const respond = (url: string): unknown => {
  if (url.includes('anime-list-mini.json')) return [{ anilist_id: 7, kitsu_id: 42, mal_id: 70 }]
  if (url.includes('/episodes?')) return { data: [], links: {} }
  if (url.includes('/characters') || url.includes('/staff')) return { data: [], included: [] }
  if (url.includes('/anime/42')) return { data: anime, included: anilistOnly }
  return { data: [anime], included: anilistOnly, meta: { count: 1 }, links: {} }
}

beforeEach(() => {
  mocks.http.mockReset().mockImplementation(async (url: string) => ({ ok: true, status: 200, json: async () => respond(url) }))
  mocks.get.mockReset().mockResolvedValue(undefined)
  mocks.set.mockReset().mockResolvedValue(undefined)
  mocks.airing.mockReset().mockResolvedValue(null)
})

describe('native Kitsu tracker identity', () => {
  it('fills a missing MAL id from the shared id map without changing the Kitsu identity', async () => {
    const media = await kitsuCatalog.detail({ provider: 'kitsu', type: 'anime', id: '42' })
    expect(media?.catalog).toEqual({ provider: 'kitsu', type: 'anime', id: '42' })
    expect(media?.id).toBeLessThan(0)
    expect(media?.externalIds).toMatchObject({ kitsu: 42, anilist: 7, mal: 70 })
    expect(media?.idMal).toBe(70)
  })

  it('fills MAL ids on search results once the id map is already in memory', async () => {
    await getIndex()
    const page = await kitsuCatalog.search({ query: 'example' })
    expect(page.media).toMatchObject([{ idMal: 70, externalIds: { anilist: 7, mal: 70 } }])
  })
})

describe('Kitsu detail airing progress', () => {
  // Kitsu publishes the planned episode list for a currently-airing season with every airdate null,
  // so the record carries no evidence of its own about what has been released.
  beforeEach(() => {
    mocks.http.mockImplementation(async (url: string) => ({
      ok: true, status: 200,
      json: async () => url.includes('/episodes?')
        ? { data: Array.from({ length: 12 }, (_, index) => ({ id: String(index + 1), attributes: { number: index + 1, airdate: null } })), links: {} }
        : respond(url),
    }))
    mocks.airing.mockResolvedValue({ airedEpisodes: 8, nextEpisode: 9, nextAiringAt: 2_000_000_000 })
  })

  it('keeps the confirmed released count on an airing title whose episodes carry no airdate', async () => {
    const media = await kitsuCatalog.detail({ provider: 'kitsu', type: 'anime', id: '42' })
    expect(media?.nextAiringEpisode?.episode).toBe(9)
    expect(airedCount(normalizeAnimeDetail(media!))).toBe(8)
  })

  it('leaves the count unknown when the airing provider has nothing', async () => {
    mocks.airing.mockResolvedValue(null)
    const media = await kitsuCatalog.detail({ provider: 'kitsu', type: 'anime', id: '42' })
    expect(airedCount(normalizeAnimeDetail(media!))).toBe(Infinity)
  })
})
