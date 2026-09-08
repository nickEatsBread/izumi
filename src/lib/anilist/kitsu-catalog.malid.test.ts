import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ http: vi.fn(), get: vi.fn(), set: vi.fn(), airing: vi.fn() }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.http }))
vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set, del: vi.fn() }))
vi.mock('$lib/anime/animeschedule', () => ({
  getAiringProgress: mocks.airing,
  scheduleTitles: (title: { romaji?: string; english?: string }) => [title.romaji, title.english],
}))

import { fetchKitsuCatalog, fetchKitsuDetail } from './kitsu-catalog'
import { getIndex } from '$lib/stremio/idmap'

const anime = {
  id: '42',
  attributes: { canonicalTitle: 'Example', slug: 'example', status: 'current', episodeCount: 12 },
  relationships: { mappings: { data: [{ id: '1', type: 'mappings' }] } },
}
const anilistOnly = [{ id: '1', type: 'mappings', attributes: { externalSite: 'anilist/anime', externalId: '7' } }]
const FRIBB = [{ anilist_id: 7, kitsu_id: 42, mal_id: 70 }]

const respond = (url: string): unknown => {
  if (url.includes('anime-list-mini.json')) return FRIBB
  if (url.includes('/mappings?')) return { data: [{ relationships: { item: { data: { id: '42', type: 'anime' } } } }] }
  if (url.includes('/anime/42')) return { data: anime, included: anilistOnly }
  return { data: [anime], included: anilistOnly, meta: { count: 1 }, links: {} }
}

const mapDownloaded = () => mocks.http.mock.calls.some(([url]) => String(url).includes('anime-list-mini.json'))

beforeEach(() => {
  mocks.http.mockReset().mockImplementation(async (url: string) => ({ ok: true, status: 200, json: async () => respond(url) }))
  mocks.get.mockReset().mockResolvedValue(undefined)
  mocks.set.mockReset().mockResolvedValue(undefined)
  mocks.airing.mockReset().mockResolvedValue(null)
})

// Order matters: the id map is a module-level memo, so the cold browse case must run first.
describe('Kitsu fallback MAL identity', () => {
  it('carries MAL ids on degraded catalog cards only once the id map is already in memory', async () => {
    // Browse rows must not trigger the multi-megabyte map download on their own account.
    const cold = await fetchKitsuCatalog({ operation: 'Page', variables: {} } as never)
    const coldBody = await cold.json() as { data: { Page: { media: { id: number; idMal?: number | null }[] } } }
    expect(coldBody.data.Page.media).toMatchObject([{ id: 7 }])
    expect(coldBody.data.Page.media[0].idMal).toBeNull()
    expect(mapDownloaded()).toBe(false)

    await getIndex()
    const warm = await fetchKitsuCatalog({ operation: 'Page', variables: {} } as never)
    const warmBody = await warm.json() as { data: { Page: { media: { id: number; idMal: number | null }[] } } }
    expect(warmBody.data.Page.media).toMatchObject([{ id: 7, idMal: 70 }])
  })

  it('fills the MAL id of a degraded detail record from the shared id map', async () => {
    const response = await fetchKitsuDetail({ operation: 'MediaById', variables: { id: 7 } })
    const body = await response.json() as { data: { Media: { id: number; idMal: number | null } } }
    expect(body.data.Media.id).toBe(7)
    expect(body.data.Media.idMal).toBe(70)
  })
})
