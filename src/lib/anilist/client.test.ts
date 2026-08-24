import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const mocks = vi.hoisted(() => ({
  post: vi.fn(), get: vi.fn(), getIndex: vi.fn(), lookupMal: vi.fn(), lookupKitsu: vi.fn(),
}))

vi.mock('$lib/net/http', () => ({ invokeNativeHttp: mocks.post, phttp: mocks.get }))
vi.mock('$lib/stremio/idmap', () => ({
  getIndex: mocks.getIndex,
  lookupAnilistByMal: mocks.lookupMal,
  lookupAnilistByKitsu: mocks.lookupKitsu,
}))

import { gql } from '@urql/core'
import { anilistToken } from './auth'
import { anilist, anilistFetch, anilistRequestPriority, parseRateLimitHeaders } from './client'
import { anilistDegraded, clearAniListDegraded } from './degraded'
import { PAGE_QUERY } from './queries'
import { MEDIA_BY_ID } from './detail-queries'

const QUERY = gql`query ($id: Int!) { Media(id: $id) { id mediaListEntry { id progress } } }`

type Entry = { Media: { mediaListEntry: { progress: number } } }

// Minimal AniList-shaped reply. __typename is required: graphcache normalizes by it.
const reply = (progress: number) => ({
  status: 200,
  headers: {},
  body: JSON.stringify({
    data: {
      Media: {
        __typename: 'Media', id: 1,
        mediaListEntry: { __typename: 'MediaList', id: 9, progress },
      },
    },
  }),
})

describe('anilist client', () => {
  beforeEach(() => {
    mocks.post.mockReset()
    mocks.get.mockReset()
    mocks.getIndex.mockReset()
    mocks.lookupMal.mockReset()
    mocks.lookupKitsu.mockReset()
    clearAniListDegraded()
  })

  it('never serves the previous account\'s list entry after a token change', async () => {
    anilistToken.set('token-a')
    mocks.post.mockResolvedValue(reply(5))
    const a = await anilist.query<Entry>(QUERY, { id: 1 }).toPromise()
    expect(a.data?.Media.mediaListEntry.progress).toBe(5)
    expect(mocks.post).toHaveBeenCalledTimes(1)

    // Same account: cache-first answers from the normalized cache, no second request.
    await anilist.query<Entry>(QUERY, { id: 1 }).toPromise()
    expect(mocks.post).toHaveBeenCalledTimes(1)

    // Switching accounts must drop that cache, so the viewer-scoped entry is re-fetched.
    anilistToken.set('token-b')
    mocks.post.mockResolvedValue(reply(0))
    const b = await anilist.query<Entry>(QUERY, { id: 1 }).toPromise()
    expect(mocks.post).toHaveBeenCalledTimes(2)
    expect(b.data?.Media.mediaListEntry.progress).toBe(0)
  })

  it('keeps the cache when the token store re-emits an unchanged value', async () => {
    anilistToken.set('token-same')
    mocks.post.mockResolvedValue(reply(7))
    await anilist.query<Entry>(QUERY, { id: 1 }).toPromise()
    anilistToken.set('token-same')
    await anilist.query<Entry>(QUERY, { id: 1 }).toPromise()
    expect(mocks.post).toHaveBeenCalledTimes(1)
  })

  it('serves a public catalog query from Jikan when AniList reports its stability shutdown', async () => {
    const query = gql`query Hero($perPage: Int) {
      Page(perPage: $perPage) { media { id idMal title { userPreferred } coverImage { extraLarge } } }
    }`
    const message = 'The AniList API has been temporarily disabled due to severe stability issues.'
    mocks.post.mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({ errors: [{ message }] }),
    })
    mocks.get.mockResolvedValue({
      ok: false, status: 404, json: async () => ({}),
    }).mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          data: [{
            mal_id: 52991,
            title: 'Sousou no Frieren',
            title_english: "Frieren: Beyond Journey's End",
            images: { webp: { large_image_url: 'https://img.test/frieren.webp' } },
            score: 9.3,
          }],
          pagination: { has_next_page: false, current_page: 1, items: { total: 1 } },
        }),
      })
    mocks.getIndex.mockResolvedValue(new Map())
    mocks.lookupMal.mockReturnValue(154587)

    const result = await anilist.query<{ Page: { media: { id: number; idMal: number }[] } }>(
      query, { perPage: 15 }, { requestPolicy: 'network-only' },
    ).toPromise()

    expect(result.error).toBeUndefined()
    expect(result.data?.Page.media[0]).toMatchObject({ id: 154587, idMal: 52991 })
    expect(mocks.get.mock.calls[1][0]).toContain('api.jikan.moe/v4/anime')
    expect(get(anilistDegraded)?.error).toBe(`[GraphQL] ${message}`)
    expect(get(anilistDegraded)?.fallbackError).toBeUndefined()
  })

  it('records when the Jikan backup catalog is unavailable too', async () => {
    const query = gql`query PageAll($page: Int) { Page(page: $page) { media { id } } }`
    const message = 'The AniList API has been temporarily disabled due to severe stability issues.'
    mocks.post.mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({ errors: [{ message }] }),
    })
    mocks.get.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })

    const result = await anilist.query(query, { page: 991 }, { requestPolicy: 'network-only' }).toPromise()

    expect(result.error).toBeDefined()
    expect(get(anilistDegraded)).toMatchObject({
      error: `[GraphQL] ${message}`,
      fallbackError: 'Kitsu: Kitsu returned HTTP 404\nJikan: Jikan returned HTTP 404',
    })
  })

  it('uses Kitsu when both AniList and Jikan are unavailable', async () => {
    const query = gql`query Search($search: String) { Page { media(search: $search) { id title { userPreferred } } } }`
    const message = 'The AniList API has been temporarily disabled due to severe stability issues.'
    mocks.post.mockResolvedValue({ status: 200, headers: {}, body: JSON.stringify({ errors: [{ message }] }) })
    mocks.get.mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          data: [{ id: '42', attributes: { canonicalTitle: 'Backup Anime', titles: { en: 'Backup Anime' } } }],
          links: { next: null }, meta: { count: 1 },
        }),
      })
    mocks.getIndex.mockResolvedValue(new Map())
    mocks.lookupKitsu.mockReturnValue(9001)

    const result = await anilist.query<{ Page: { media: { id: number }[] } }>(
      query, { search: 'backup' }, { requestPolicy: 'network-only' },
    ).toPromise()

    expect(result.error).toBeUndefined()
    expect(result.data?.Page.media[0].id).toBe(9001)
    expect(mocks.get.mock.calls[0][0]).toContain('kitsu.io/api/edge/anime')
    expect(get(anilistDegraded)?.provider).toBe('Kitsu')
    expect(get(anilistDegraded)?.fallbackError).toBeUndefined()
  })

  it('uses Kitsu embedded AniList mappings without the cached Fribb index', async () => {
    const query = gql`query SearchAll($search: String) { Page { media(search: $search) { id title { userPreferred } } } }`
    const message = 'The AniList API has been temporarily disabled due to severe stability issues.'
    mocks.post.mockResolvedValue({ status: 200, headers: {}, body: JSON.stringify({ errors: [{ message }] }) })
    mocks.get.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({
        data: [{
          id: '7442', attributes: { canonicalTitle: 'Attack on Titan' },
          relationships: { mappings: { data: [{ type: 'mappings', id: '254628' }] } },
        }],
        included: [{
          type: 'mappings', id: '254628',
          attributes: { externalSite: 'anilist/anime', externalId: '16498' },
        }],
        links: { next: null }, meta: { count: 1 },
      }),
    })

    const result = await anilist.query<{ Page: { media: { id: number }[] } }>(
      query, { search: 'attack on titan' }, { requestPolicy: 'network-only' },
    ).toPromise()

    expect(result.data?.Page.media).toMatchObject([{ id: 16498 }])
    expect(mocks.getIndex).not.toHaveBeenCalled()
    expect(mocks.get.mock.calls[0][0]).toContain('include=mappings')
  })

  it('hydrates a complete Home row from Kitsu through graphcache', async () => {
    const message = 'The AniList API has been temporarily disabled due to severe stability issues.'
    mocks.post.mockResolvedValue({ status: 200, headers: {}, body: JSON.stringify({ errors: [{ message }] }) })
    mocks.get.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({
        data: [{
          id: '7442',
          attributes: {
            canonicalTitle: 'Attack on Titan', titles: { en: 'Attack on Titan' },
            posterImage: { large: 'https://img.test/aot.jpg' }, averageRating: '82.4',
          },
          relationships: { mappings: { data: [{ type: 'mappings', id: '254628' }] } },
        }],
        included: [{
          type: 'mappings', id: '254628',
          attributes: { externalSite: 'anilist/anime', externalId: '16498' },
        }],
        links: { next: null }, meta: { count: 1 },
      }),
    })

    const result = await anilist.query<{ Page: { media: { id: number; title: { userPreferred: string }; coverImage: { large: string } }[] } }>(
      PAGE_QUERY, { perPage: 20, sort: ['POPULARITY_DESC'], season: 'SUMMER', seasonYear: 2026 },
      { requestPolicy: 'network-only' },
    ).toPromise()

    expect(result.error).toBeUndefined()
    expect(result.data?.Page.media).toEqual([expect.objectContaining({
      id: 16498, title: expect.objectContaining({ userPreferred: 'Attack on Titan' }),
      coverImage: expect.objectContaining({ large: 'https://img.test/aot.jpg' }),
    })])
  })

  it('hydrates the anime detail page from Kitsu when AniList is unavailable', async () => {
    const message = 'The AniList API has been temporarily disabled due to severe stability issues.'
    mocks.post.mockResolvedValue({ status: 200, headers: {}, body: JSON.stringify({ errors: [{ message }] }) })
    mocks.get
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ data: [{ relationships: { item: { data: { type: 'anime', id: '7442' } } } }] }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          data: {
            id: '7442',
            attributes: {
              canonicalTitle: 'Attack on Titan', titles: { en: 'Attack on Titan' },
              synopsis: 'Humanity fights for survival.', episodeCount: 25,
              posterImage: { large: 'https://img.test/aot.jpg' },
            },
            relationships: { categories: { data: [{ type: 'categories', id: '1' }] } },
          },
          included: [
            { type: 'mappings', id: '2', attributes: { externalSite: 'myanimelist/anime', externalId: '16498' } },
            { type: 'categories', id: '1', attributes: { title: 'Action', nsfw: false } },
          ],
        }),
      })

    const result = await anilist.query<{ Media: { id: number; idMal: number; genres: string[]; relations: { edges: unknown[] } } }>(
      MEDIA_BY_ID, { id: 16498 }, { requestPolicy: 'network-only' },
    ).toPromise()

    expect(result.error).toBeUndefined()
    expect(result.data?.Media).toMatchObject({
      id: 16498, idMal: 16498, genres: ['Action'], relations: { edges: [] },
      title: { userPreferred: 'Attack on Titan' }, episodes: 25,
    })
    expect(mocks.get.mock.calls.map((call) => call[0])).toEqual([
      expect.stringMatching(/\/mappings\?.*include=item/),
      expect.stringContaining('/anime/7442?include=mappings%2Ccategories'),
    ])
  })

  it('does not mask an unsupported non-catalog AniList failure with a backup', async () => {
    const query = gql`query MediaTagCollection { MediaTagCollection { name } }`
    mocks.post.mockResolvedValue({
      status: 503,
      headers: {},
      body: JSON.stringify({ errors: [{ message: 'Unavailable' }] }),
    })
    const result = await anilist.query(query, {}, { requestPolicy: 'network-only' }).toPromise()
    expect(result.error).toBeDefined()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(get(anilistDegraded)).toBeNull()
  })

  it('does not turn navigation cancellation into backup-provider traffic', async () => {
    const controller = new AbortController()
    controller.abort()
    const body = JSON.stringify({
      query: 'query Page { Page { media { id } } }',
      variables: { page: 987 },
    })

    await expect(anilistFetch('https://graphql.anilist.co', {
      method: 'POST', body, signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.post).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(get(anilistDegraded)).toBeNull()
  })

  it('hands a catalog 429 to the backup immediately instead of sleeping and retrying', async () => {
    const query = gql`query HeroAll($perPage: Int) {
      Page(perPage: $perPage) { media { id title { userPreferred } } }
    }`
    mocks.post.mockResolvedValue({
      status: 429,
      headers: { 'retry-after': '60', 'x-ratelimit-remaining': '0' },
      body: JSON.stringify({ data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] }),
    })
    mocks.get.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({
        data: [{ id: '42', attributes: { canonicalTitle: 'Backup Anime' } }],
        included: [{
          type: 'mappings', id: 'm1',
          attributes: { externalSite: 'anilist/anime', externalId: '9001' },
        }],
        links: { next: null }, meta: { count: 1 },
      }),
    })
    mocks.getIndex.mockResolvedValue(new Map())
    mocks.lookupKitsu.mockReturnValue(9001)

    const result = await anilist.query<{ Page: { media: { id: number }[] } }>(
      query, { perPage: 1 }, { requestPolicy: 'network-only' },
    ).toPromise()

    expect(result.error).toBeUndefined()
    expect(result.data?.Page.media).toMatchObject([{ id: 9001 }])
    expect(mocks.post).toHaveBeenCalledTimes(1)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })
})

describe('AniList rate-limit headers', () => {
  it('reads the shared-IP remainder and reset without inventing absent values', () => {
    expect(parseRateLimitHeaders(new Headers())).toEqual({
      limit: undefined,
      remaining: undefined,
      resetAtMs: undefined,
    })
    expect(parseRateLimitHeaders(new Headers({
      'x-ratelimit-limit': '30',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '2000000000',
    }))).toEqual({ limit: 30, remaining: 0, resetAtMs: 2_000_000_000_000 })
  })

  it('puts interactive navigation ahead of lazy home rows without bypassing the quota', () => {
    const body = (query: string) => JSON.stringify({ query })
    expect(anilistRequestPriority(body('mutation Save { SaveMediaListEntry { id } }'))).toBe(0)
    expect(anilistRequestPriority(body('query MediaById { Media { id } }'))).toBe(1)
    expect(anilistRequestPriority(body('query Schedule { Page { pageInfo { lastPage } } }'))).toBe(1)
    expect(anilistRequestPriority(body('query ScheduleWeek { d0: Page { pageInfo { hasNextPage } } }'))).toBe(1)
    expect(anilistRequestPriority(body('query Hero { Page { media { id } } }'))).toBe(2)
    expect(anilistRequestPriority(body('query Lists { MediaListCollection { lists { name } } }'))).toBe(4)
    expect(anilistRequestPriority(body('query Page { Page { media { id } } }'))).toBe(7)
    expect(anilistRequestPriority('not-json')).toBe(3)
  })
})
