import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveCatalogSnapshot, resolveDirectSources, resolveMediaDetails, searchCatalog } from '../../../cloudflare-sync-worker/src/resolver.js'
import { catalogInternals } from '../../../cloudflare-sync-worker/src/catalog.js'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const profile = {
  enabled: true,
  addons: [],
  quality: 'any',
  sort: 'quality',
  audioLang: '',
  connectedDeviceFallback: false,
  debrid: null,
  catalog: {
    screens: ['anilist', 'tmdb'], defaultScreen: 'anilist', showAdult: false,
    hideSpoilers: true, tmdbToken: 'tmdb-read-token',
  },
}

const ani = {
  id: 21,
  format: 'TV',
  title: { userPreferred: 'One Piece' },
  coverImage: { large: 'https://img.example/one-piece.jpg' },
  episodes: 1000,
}

describe('Cloudflare-first companion catalogue', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('materializes an AniList home snapshot without the linked client', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: {
      trending: { media: [ani] }, popular: { media: [ani] }, rated: { media: [ani] },
    } })))

    const snapshot = await resolveCatalogSnapshot(profile, 'anilist')
    expect(snapshot).toMatchObject({
      kind: 'companion-home',
      catalog: { screen: 'anilist' },
      spoilersHidden: true,
      hero: { mediaId: 21, ref: { provider: 'anilist', id: '21' }, title: 'One Piece' },
    })
  })

  it('supports provider-person searches through the Worker', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(init?.body)).toContain('Character(id:$id)')
      return json({ data: { Character: { media: { nodes: [ani] } } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const items = await searchCatalog(profile, 'anilist', 'Monkey D. Luffy', {
      id: '40', provider: 'anilist', credit: 'cast',
    })
    expect(items).toMatchObject([{ mediaId: 21, title: 'One Piece' }])
  })

  it('combines AniList presentation and people with AniZip episodes', async () => {
    const fetcher = vi.fn(async (raw: RequestInfo | URL) => {
      if (String(raw).includes('api.ani.zip')) return json({ episodes: {
        '1': { seasonNumber: 1, episodeNumber: 1, title: { en: 'Romance Dawn' } },
      } })
      return json({ data: { Media: {
        ...ani,
        description: 'Pirate adventure',
        characters: { edges: [{ role: 'MAIN', node: { id: 40, name: { full: 'Monkey D. Luffy' } } }] },
        staff: { edges: [] }, relations: { edges: [] }, recommendations: { nodes: [] },
      } } })
    })

    const details = await resolveMediaDetails(
      { ref: { provider: 'anilist', type: 'anime', id: '21' } }, profile as never, fetcher,
    )
    expect(details).toMatchObject({
      description: 'Pirate adventure',
      episodes: [{ season: 1, episode: 1, title: 'Romance Dawn' }],
      cast: [{ id: '40', provider: 'anilist', name: 'Monkey D. Luffy', credit: 'cast' }],
    })
  })

  it('loads Kitsu episode metadata directly', async () => {
    vi.stubGlobal('fetch', vi.fn(async (raw: RequestInfo | URL) => {
      const url = String(raw)
      if (url.endsWith('/anime/42')) return json({ data: {
        id: '42', attributes: { canonicalTitle: 'Example', episodeLength: 24, episodeCount: 1 },
      } })
      return json({ data: [{ attributes: { number: 1, canonicalTitle: 'Beginning', length: 24 } }], links: {} })
    }))

    const details = await resolveMediaDetails({ ref: { provider: 'kitsu', type: 'anime', id: '42' } }, profile as never)
    expect(details).toMatchObject({ episodes: [{ season: 1, episode: 1, title: 'Beginning' }] })
  })

  it('routes a Worker-created Stremio identity back to its originating add-on', async () => {
    const base = 'https://catalog.example/configured'
    const media = catalogInternals.stremioMedia({ id: 'tt1234567', name: 'Example film' }, base, 'movie')
    if (!media) throw new Error('Expected a valid Stremio catalogue item.')
    const requested: string[] = []
    const fetcher = vi.fn(async (raw: RequestInfo | URL) => {
      const url = String(raw)
      requested.push(url)
      if (url.endsWith('/manifest.json')) return json({ id: 'catalog', name: 'Catalog', version: '1', resources: ['stream'] })
      if (url.includes('/stream/movie/tt1234567.json')) return json({ streams: [{ url: 'https://media.example/movie.mp4' }] })
      return json({}, 404)
    })

    const result = await resolveDirectSources({
      ...profile,
      addons: [base, 'https://unrelated.example'],
    }, { ref: media.ref }, fetcher)

    expect(result.candidates[0]?.url).toBe('https://media.example/movie.mp4')
    expect(requested.some((url) => url.includes('unrelated.example'))).toBe(false)
  })
})
