import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ http: vi.fn() }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.http }))
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }))

import { searchKitsuTitles } from './kitsu-catalog'

const hit = (id: string, title: string, mapping?: string) => ({
  id,
  attributes: { canonicalTitle: title, titles: { en: title }, abbreviatedTitles: [`${title} (alt)`], userCount: 100 },
  relationships: { mappings: { data: mapping ? [{ id: mapping, type: 'mappings' }] : [] } },
})

beforeEach(() => {
  mocks.http.mockReset().mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [hit('46474', 'Frieren: Beyond Journey’s End', 'm1'), hit('99', 'Unmapped'), hit('49240', 'Frieren Season 2', 'm2')],
      included: [
        { id: 'm1', type: 'mappings', attributes: { externalSite: 'anilist/anime', externalId: '154587' } },
        { id: 'm2', type: 'mappings', attributes: { externalSite: 'anilist/anime', externalId: '182255' } },
      ],
    }),
  }))
})

describe('Kitsu title search', () => {
  it("asks Kitsu's typo-tolerant text search and keeps its order", async () => {
    const media = await searchKitsuTitles('freiren')
    const url = new URL(String(mocks.http.mock.calls[0][0]))
    expect(url.pathname).toBe('/api/edge/anime')
    expect(url.searchParams.get('filter[text]')).toBe('freiren')
    expect(url.searchParams.get('include')).toBe('mappings')
    expect(media.map((item) => item.id)).toEqual([154587, 182255])
  })

  it('returns AniList-identified records, so they open and dedupe as the AniList title', async () => {
    const [first] = await searchKitsuTitles('freiren')
    expect(first.catalog).toBeUndefined()
    expect(first.externalIds).toMatchObject({ kitsu: 46474, anilist: 154587 })
    expect(first.title.english).toBe('Frieren: Beyond Journey’s End')
    expect(first.synonyms).toEqual(['Frieren: Beyond Journey’s End (alt)'])
  })

  it('drops hits Kitsu has not linked to AniList', async () => {
    const media = await searchKitsuTitles('freiren')
    expect(media.some((item) => item.title.english === 'Unmapped')).toBe(false)
  })

  it('passes the cancel signal to the request', async () => {
    const abort = new AbortController()
    await searchKitsuTitles('freiren', abort.signal)
    expect(mocks.http.mock.calls[0][1]).toMatchObject({ signal: abort.signal })
  })
})
