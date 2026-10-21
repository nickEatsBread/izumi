import { beforeEach, describe, expect, it, vi } from 'vitest'

// Home blocks page a row with `pageInfo { hasNextPage lastPage }`. Graphcache drops a whole answer
// that lacks a selected field, so a backup page without `lastPage` reached the block as `null`.
const mocks = vi.hoisted(() => ({ http: vi.fn(), get: vi.fn(), set: vi.fn(), schedule: vi.fn() }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.http }))
vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set, del: vi.fn() }))
vi.mock('$lib/anime/animeschedule', () => ({ getAiringProgress: vi.fn(async () => null), scheduleTitles: () => [] }))
vi.mock('$lib/stremio/idmap', () => ({ getIndex: vi.fn(async () => new Map()), lookupAnilistByMal: () => 7, lookupAnilistByKitsu: () => 7 }))
vi.mock('bottleneck/light', () => ({ default: class { schedule = mocks.schedule } }))

import { fetchJikanCatalog } from './jikan'
import { fetchKitsuCatalog } from './kitsu-catalog'

const kitsuAnime = {
  id: '42',
  attributes: { canonicalTitle: 'Example', slug: 'example', status: 'current', subtype: 'movie' },
  relationships: { mappings: { data: [{ id: '1', type: 'mappings' }] } },
}
const kitsuMappings = [{ id: '1', type: 'mappings', attributes: { externalSite: 'anilist/anime', externalId: '7' } }]
const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

beforeEach(() => {
  mocks.http.mockReset()
  mocks.get.mockReset().mockResolvedValue(undefined)
  mocks.set.mockReset().mockResolvedValue(undefined)
  mocks.schedule.mockReset().mockImplementation((_options: unknown, job: () => unknown) => job())
})

const rowPage = (variables: Record<string, unknown>) => ({
  operation: 'RowPage',
  query: 'query RowPage { Page { pageInfo { hasNextPage lastPage } media(isAdult: false) { id } } }',
  variables,
})

describe('backup catalog pages', () => {
  it('Kitsu answers the last page and honours a row preset’s single format and status', async () => {
    mocks.http.mockResolvedValue(reply({ data: [kitsuAnime], included: kitsuMappings, meta: { count: 40 }, links: { next: 'x' } }))
    const response = await fetchKitsuCatalog(rowPage({ page: 1, perPage: 18, format: 'MOVIE', status: 'RELEASING' }))
    const body = await response.json() as { data: { Page: { pageInfo: Record<string, unknown> } } }
    expect(body.data.Page.pageInfo).toMatchObject({ hasNextPage: true, lastPage: 3 })
    const url = new URL(String(mocks.http.mock.calls[0][0]))
    expect(url.searchParams.get('filter[subtype]')).toBe('movie')
    expect(url.searchParams.get('filter[status]')).toBe('current')
  })

  it('Kitsu reports an unknown last page as null, never omits it', async () => {
    mocks.http.mockResolvedValue(reply({ data: [kitsuAnime], included: kitsuMappings, links: {} }))
    const body = await (await fetchKitsuCatalog(rowPage({}))).json() as { data: { Page: { pageInfo: Record<string, unknown> } } }
    expect(body.data.Page.pageInfo).toHaveProperty('lastPage', null)
  })

  it('both read trending as the most-followed titles airing now', async () => {
    mocks.http.mockResolvedValue(reply({ data: [kitsuAnime], included: kitsuMappings, links: {} }))
    await fetchKitsuCatalog(rowPage({ sort: ['TRENDING_DESC'] }))
    const kitsu = new URL(String(mocks.http.mock.calls[0][0]))
    expect([kitsu.searchParams.get('sort'), kitsu.searchParams.get('filter[status]')]).toEqual(['-userCount', 'current'])
    mocks.http.mockReset().mockResolvedValue(reply({ data: [], pagination: {} }))
    await fetchJikanCatalog(rowPage({ sort: ['TRENDING_DESC'] }))
    const jikan = new URL(String(mocks.http.mock.calls[0][0]))
    expect([jikan.searchParams.get('order_by'), jikan.searchParams.get('status')]).toEqual(['members', 'airing'])
  })

  it('leave Search and filtered rows unrestricted', async () => {
    mocks.http.mockReset().mockResolvedValue(reply({ data: [kitsuAnime], included: kitsuMappings, links: {} }))
    await fetchKitsuCatalog({ operation: 'Search', query: 'query Search { Page { media { id } } }', variables: { sort: ['TRENDING_DESC'], seasonYear: 2015 } })
    await fetchKitsuCatalog(rowPage({ sort: ['TRENDING_DESC'], genre: 'Romance' }))
    for (const [url] of mocks.http.mock.calls) expect(new URL(String(url)).searchParams.get('filter[status]')).toBeNull()
  })

  it('Jikan answers the last page', async () => {
    mocks.http.mockResolvedValue(reply({ data: [{ mal_id: 1, title: 'Example' }], pagination: { has_next_page: true, current_page: 1, last_visible_page: 9, items: { total: 200 } } }))
    const body = await (await fetchJikanCatalog(rowPage({ page: 1, perPage: 18 }))).json() as { data: { Page: { pageInfo: Record<string, unknown> } } }
    expect(body.data.Page.pageInfo).toMatchObject({ hasNextPage: true, lastPage: 9 })
  })
})
