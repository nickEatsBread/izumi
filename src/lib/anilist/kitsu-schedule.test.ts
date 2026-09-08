import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ http: vi.fn(), get: vi.fn(), set: vi.fn() }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.http }))
vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set, del: vi.fn() }))
import { fetchKitsuScheduleIndex } from './kitsu-catalog'
import { classifyAiring, emptyMySets } from './my-shows'

const page = (mappings: { site: string; id: string }[]) => ({
  data: [{ id: '42', attributes: { canonicalTitle: 'Example', slug: 'example' }, relationships: {
    mappings: { data: mappings.map((_, index) => ({ id: String(index + 1), type: 'mappings' })) },
  } }],
  included: mappings.map((mapping, index) => ({
    id: String(index + 1), type: 'mappings', attributes: { externalSite: mapping.site, externalId: mapping.id },
  })),
})

beforeEach(() => {
  mocks.http.mockReset()
  mocks.get.mockReset().mockResolvedValue(undefined)
  mocks.set.mockReset().mockResolvedValue(undefined)
})

it('retains MAL membership and watched progress on Kitsu fallback schedule cards', async () => {
  mocks.http.mockResolvedValue({ ok: true, json: async () => page([
    { site: 'anilist/anime', id: '7' }, { site: 'myanimelist/anime', id: '70' },
  ]) })
  const index = await fetchKitsuScheduleIndex(2026, 'summer', false, true)
  const media = index.get('example')!
  expect(media.idMal).toBe(70)
  const sets = emptyMySets()
  sets.malWatching.add(70)
  sets.malProgress.set(70, 3)
  expect(classifyAiring({ media, episode: 3, airingAt: 100 }, sets)).toBe('watched')
  expect(classifyAiring({ media, episode: 4, airingAt: 100 }, sets)).toBe('watching')
})

it('recovers the MAL id from the shared id map when Kitsu has not mapped a new title yet', async () => {
  mocks.http.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => url.includes('anime-list-mini.json')
      ? [{ anilist_id: 7, kitsu_id: 42, mal_id: 70 }]
      : page([{ site: 'anilist/anime', id: '7' }]),
  }))
  const index = await fetchKitsuScheduleIndex(2026, 'summer', false, true)
  const media = index.get('example')!
  expect(media.id).toBe(7)
  expect(media.idMal).toBe(70)
  const sets = emptyMySets()
  sets.malWatching.add(70)
  expect(classifyAiring({ media, episode: 4, airingAt: 100 }, sets)).toBe('watching')
})
