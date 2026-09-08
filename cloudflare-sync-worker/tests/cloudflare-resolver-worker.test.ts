import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultResolverProfile,
  normalizeAddonBase,
  normalizeResolveRequest,
  normalizeResolverProfile,
  publicResolverProfile,
  resolveDirectSources,
  streamRequestPlan,
} from '../src/resolver.js'
import { catalogInternals } from '../src/catalog.js'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

describe('self-hosted Cloudflare source resolver', () => {
  afterEach(() => vi.unstubAllGlobals())
  it.each([
    { type: 'movie', id: 'tt0126029', streamId: 'tt0126029' },
    { type: 'series', id: 'tt10589968', streamId: 'tt10589968:1:1' },
  ])('asks stream add-ons for a global $type ID displayed by a catalogue add-on', async ({ type, id, streamId }) => {
    const catalog = 'https://catalog.example'
    const fetcher = vi.fn(async (raw: RequestInfo | URL) => {
      const url = String(raw)
      if (url === `${catalog}/manifest.json`) return json({ resources: ['catalog', 'meta'] })
      if (url === 'https://streams.example/manifest.json') return json({ resources: ['stream'] })
      if (url === `https://streams.example/stream/${type}/${encodeURIComponent(streamId)}.json`) {
        return json({ streams: [{ url: 'https://media.example/video.mkv' }] })
      }
      return json({}, 404)
    })
    const result = await resolveDirectSources({
      enabled: true, addons: [catalog, 'https://streams.example'],
    }, {
      ref: { provider: 'stremio', type, id: encodeURIComponent(JSON.stringify([catalogInternals.fnv(catalog), type, id])) },
      streamIds: [streamId], ...(type === 'series' ? { season: 1, episode: 1 } : {}),
    }, fetcher)
    expect(result.candidates[0]?.url).toBe('https://media.example/video.mkv')
  })

  it('keeps custom Stremio identifiers scoped to their originating add-on', async () => {
    const base = 'https://custom.example'
    const fetcher = vi.fn(async () => json({ resources: ['stream'], streams: [] }))
    await resolveDirectSources({ enabled: true, addons: [base, 'https://unrelated.example'] }, {
      ref: { provider: 'stremio', type: 'series', id: encodeURIComponent(JSON.stringify([catalogInternals.fnv(base), 'series', 'private:123'])) },
      streamIds: ['private:123'],
    }, fetcher)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('unrelated.example'))).toBe(false)
  })

  it('reports a blocked source without exposing configured URLs or blaming TorBox settings', async () => {
    const fetcher = vi.fn(async (raw: RequestInfo | URL) => String(raw).endsWith('/manifest.json')
      ? json({ resources: ['stream'] }) : new Response('Blocked', { status: 403 }))
    const result = await resolveDirectSources({
      enabled: true, addons: ['https://source.example/secret-addon-key'],
      debrid: { provider: 'torbox', credential: 'secret-torbox-key' },
    }, { ref: { provider: 'tmdb', type: 'movie', id: '808' } }, fetcher)
    expect(result.candidates).toEqual([])
    expect(result.failures).toEqual(['A configured source could not be reached from the cloud (HTTP 403).'])
    expect(JSON.stringify(result.failures)).not.toContain('source.example')
    expect(JSON.stringify(result)).not.toContain('secret-')
  })

  it('explains empty add-on results when TorBox is already configured', async () => {
    const result = await resolveDirectSources({
      enabled: true, addons: ['https://source.example'],
      debrid: { provider: 'torbox', credential: 'configured-key' },
    }, { ref: { provider: 'tmdb', type: 'movie', id: '808' } }, async () => json({ resources: ['stream'], streams: [] }))
    expect(result.failures).toEqual(['Your configured source add-ons returned no playable streams for this title.'])
  })

  it('bounds all stalled add-ons to one source-discovery deadline', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      }))
      let finished = false
      const pending = resolveDirectSources({
        enabled: true, addons: Array.from({ length: 8 }, (_, i) => `https://source${i}.example`),
      }, { ref: { provider: 'kitsu', type: 'anime', id: '42' }, episode: 1 }, fetcher).then(result => { finished = true; return result })
      await vi.advanceTimersByTimeAsync(12_001)
      expect(finished).toBe(true)
      expect((await pending).candidates).toEqual([])
      // 3 concurrent manifest fetches + 2 stream fetches, plus the Kitsu title-evidence lookup
      // that runs beside the fan-out for refinement.
      expect(fetcher).toHaveBeenCalledTimes(7)
    } finally { vi.useRealTimers() }
  })
  it('is disabled with no uploaded add-ons by default', () => {
    expect(defaultResolverProfile()).toEqual({
      enabled: false,
      addons: [],
      quality: 'any',
      sort: 'quality',
      audioLang: '',
      connectedDeviceFallback: false,
      allowPrivateNetworkSources: false,
      debrid: null,
      catalog: {
        screens: ['auto'], defaultScreen: 'auto', showAdult: false, hideSpoilers: false, tmdbToken: '',
      },
    })
  })

  it('accepts public configured add-ons while rejecting local and recursive targets', () => {
    expect(normalizeAddonBase('stremio://addon.example/config/manifest.json'))
      .toBe('https://addon.example/config')
    expect(() => normalizeAddonBase('https://127.0.0.1/config')).toThrow(/public HTTPS/)
    expect(() => normalizeAddonBase('https://worker.example/config', 'https://worker.example')).toThrow(/itself/)
  })

  it('normalizes a bounded opt-in profile', () => {
    expect(normalizeResolverProfile({
      enabled: true,
      addons: ['https://addon.example/a', 'https://addon.example/a'],
      quality: '1080',
      sort: 'quality',
      audioLang: 'ENG',
    })).toEqual({
      enabled: true,
      addons: ['https://addon.example/a'],
      quality: '1080',
      sort: 'quality',
      audioLang: 'eng',
      connectedDeviceFallback: false,
      allowPrivateNetworkSources: false,
      debrid: null,
      catalog: {
        screens: ['auto'], defaultScreen: 'auto', showAdult: false, hideSpoilers: false, tmdbToken: '',
      },
    })
  })

  it('bounds and validates the synced source trust order', () => {
    const profile = normalizeResolverProfile({
      enabled: true,
      addons: ['https://addon.example/a'],
      quality: 'any',
      sort: 'quality',
      audioLang: '',
      sourcePriority: ['00c30d16d735d78a', 'not-a-fingerprint', '00c30d16d735d78a', 42],
      sourcePriorityMode: 'strict',
    })
    expect(profile.sourcePriority).toEqual(['00c30d16d735d78a'])
    expect(profile.sourcePriorityMode).toBe('strict')
    const unset = normalizeResolverProfile({ enabled: true, addons: [], quality: 'any', sort: 'quality', audioLang: '' })
    expect(unset.sourcePriority).toBeUndefined()
    expect(unset.sourcePriorityMode).toBeUndefined()
  })

  it('never echoes the configured debrid credential from an owner profile response', () => {
    const profile = publicResolverProfile({
      enabled: true,
      addons: ['https://addon.example/a'],
      quality: '1080',
      sort: 'quality',
      audioLang: 'jpn',
      connectedDeviceFallback: false,
      debrid: { provider: 'torbox', credential: 'secret-token-value-123456' },
    })
    expect(profile.debrid).toEqual({ provider: 'torbox', configured: true })
    expect(JSON.stringify(profile)).not.toContain('secret-token')
  })

  it('accepts every debrid provider exposed by Izumi’s shared dispatcher', () => {
    const providerIds = [
      'realdebrid', 'alldebrid', 'premiumize', 'torbox', 'debridlink', 'offcloud',
      'easydebrid', 'deepbrid', 'megadebrid',
    ]
    for (const provider of providerIds) {
      expect(normalizeResolverProfile({
        enabled: true,
        addons: [],
        quality: 'any',
        sort: 'quality',
        audioLang: '',
        connectedDeviceFallback: false,
        debrid: { provider, credential: 'configured-key' },
      }).debrid)
        .toEqual({ provider, credential: 'configured-key' })
    }
  })

  it('uses AniZip mappings to build the same Kitsu and IMDb requests as the client', async () => {
    const fetcher = vi.fn(async () => json({
      mappings: { kitsu_id: 42, imdb_id: 'tt1234567', themoviedb_id: '99' },
      episodes: { '7': { seasonNumber: 2, episodeNumber: 3, absoluteEpisodeNumber: 31 } },
    }))
    const request = normalizeResolveRequest({
      ref: { provider: 'anilist', type: 'anime', id: '100' },
      episode: 7,
    })
    const plan = await streamRequestPlan(request, fetcher)
    expect(plan.ids).toEqual(['kitsu:42:7', 'tt1234567:2:3', 'tmdb:99:2:3'])
    expect(plan.want).toEqual({ episode: 7, season: 2, abs: 31 })
  })

  it('maps TMDB identities to IMDb before asking prefix-limited add-ons', async () => {
    const fetcher = vi.fn(async (raw: RequestInfo | URL) => {
      const url = String(raw)
      if (url.includes('/movie/550/external_ids')) return json({ imdb_id: 'tt0137523' })
      if (url.endsWith('/manifest.json')) return json({
        id: 'imdb', name: 'IMDb source', version: '1',
        resources: [{ name: 'stream', types: ['movie'], idPrefixes: ['tt'] }],
      })
      if (url.includes('/stream/movie/tt0137523.json')) return json({
        streams: [{ url: 'https://media.example/movie.mp4', title: 'Movie 1080p' }],
      })
      return json({}, 404)
    })

    const result = await resolveDirectSources({
      enabled: true, addons: ['https://addon.example'], quality: 'any', sort: 'quality',
      audioLang: '', connectedDeviceFallback: false, debrid: null,
      catalog: { screens: ['tmdb'], defaultScreen: 'tmdb', tmdbToken: 'token' },
    }, { ref: { provider: 'tmdb', type: 'movie', id: '550' } }, fetcher)

    expect(result.queriedIds).toEqual(['tt0137523', 'tmdb:550'])
    expect(result.candidates[0]?.url).toBe('https://media.example/movie.mp4')
  })

  it('uses an exact supplied video id on a custom Stremio resource route', async () => {
    const fetcher = vi.fn(async (raw: RequestInfo | URL) => {
      const url = String(raw)
      if (url.endsWith('/manifest.json')) return json({
        id: 'custom', name: 'Custom source', version: '1',
        resources: [{ name: 'stream', types: ['channel'], idPrefixes: ['native'] }],
      })
      if (url.includes('/stream/channel/native%3A5%3A1.json')) return json({
        streams: [{ url: 'https://media.example/custom.mp4' }],
      })
      return json({}, 404)
    })

    const result = await resolveDirectSources({
      enabled: true, addons: ['https://addon.example'], quality: 'any', sort: 'quality',
      audioLang: '', connectedDeviceFallback: false, debrid: null,
    }, {
      ref: { provider: 'stremio', type: 'series', id: 'opaque' },
      episode: 1, season: 5, nativeType: 'channel', streamIds: ['native:5:1'],
    }, fetcher)

    expect(result.queriedIds).toEqual(['native:5:1'])
    expect(result.candidates[0]?.url).toBe('https://media.example/custom.mp4')
  })

  it('returns ranked direct sources while excluding header-bound and torrent-only rows', async () => {
    const fetcher = vi.fn(async (raw: RequestInfo | URL) => {
      const url = String(raw)
      if (url.endsWith('/manifest.json')) return json({
        id: 'test', name: 'Test add-on', version: '1', resources: ['stream'],
      })
      if (url.includes('/stream/series/')) return json({ streams: [
        { url: 'https://media.example/episode-720.mp4', title: 'Show - 01 720p' },
        { url: 'https://media.example/episode-1080.mp4', title: 'Show - 01 1080p' },
        {
          url: 'https://media.example/referer-only-2160.mp4',
          title: 'Show - 01 2160p',
          behaviorHints: { proxyHeaders: { request: { Referer: 'https://addon.example/' } } },
        },
        { infoHash: 'a'.repeat(40), title: 'Show - 01 2160p' },
      ] })
      return json({}, 404)
    })
    const result = await resolveDirectSources({
      enabled: true,
      addons: ['https://addon.example'],
      quality: '1080',
      sort: 'quality',
      audioLang: '',
      connectedDeviceFallback: false,
      debrid: null,
    }, {
      ref: { provider: 'kitsu', type: 'anime', id: '42' },
      episode: 1,
    }, fetcher)
    expect(result.candidates.map((candidate) => candidate.url)).toEqual([
      'https://media.example/episode-1080.mp4',
      'https://media.example/episode-720.mp4',
    ])
    expect(result.selectedId).toBe(result.candidates[0].id)
    expect(result.rejected).toBe(2)
  })

  it('keeps direct debrid URLs that are not browser-ready for Samsung AVPlay', async () => {
    const fetcher = vi.fn(async (raw: RequestInfo | URL) => {
      const url = String(raw)
      if (url.endsWith('/manifest.json')) return json({
        id: 'debrid', name: 'Configured debrid add-on', version: '1', resources: ['stream'],
      })
      if (url.includes('/stream/movie/')) return json({ streams: [{
        url: 'https://debrid-cdn.example/download/opaque-token',
        name: 'Debrid 1080p',
        behaviorHints: { notWebReady: true, filename: 'Movie.1080p.mkv' },
      }] })
      return json({}, 404)
    })
    const result = await resolveDirectSources({
      enabled: true,
      addons: ['https://addon.example/configured-token'],
      quality: '1080',
      sort: 'quality',
      audioLang: '',
      connectedDeviceFallback: false,
      debrid: null,
    }, {
      ref: { provider: 'tmdb', type: 'movie', id: '550' },
    }, fetcher)

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      url: 'https://debrid-cdn.example/download/opaque-token',
      contentType: 'video/x-matroska',
    })
  })

  it('allows an explicitly opted-in LAN source without allowing it by default', async () => {
    const fetcher = vi.fn(async (raw: RequestInfo | URL) => {
      const url = String(raw)
      if (url.endsWith('/manifest.json')) return json({ id: 'lan', name: 'LAN', version: '1', resources: ['stream'] })
      if (url.includes('/stream/series/')) return json({ streams: [{
        url: 'http://192.168.1.40:8096/video.mkv', title: 'Local media server 1080p',
      }] })
      return json({}, 404)
    })
    const request = { ref: { provider: 'kitsu', type: 'anime', id: '42' }, episode: 1 }
    const baseProfile = {
      enabled: true, addons: ['https://addon.example'], quality: '1080', sort: 'quality',
      audioLang: '', connectedDeviceFallback: false, debrid: null,
    }

    expect((await resolveDirectSources(baseProfile, request, fetcher)).candidates).toHaveLength(0)
    expect((await resolveDirectSources({ ...baseProfile, allowPrivateNetworkSources: true }, request, fetcher)).candidates[0])
      .toMatchObject({ url: 'http://192.168.1.40:8096/video.mkv', lan: true, delivery: 'direct' })
  })

  it('carries AniSkip timings alongside Worker-resolved playback', async () => {
    const fetcher = vi.fn(async (raw: RequestInfo | URL) => {
      const url = String(raw)
      if (url.includes('api.ani.zip')) return json({
        mappings: { mal_id: 21, kitsu_id: 42 }, episodes: { '1': { seasonNumber: 1, episodeNumber: 1 } },
      })
      if (url.includes('api.aniskip.com')) return json({
        found: true, results: [{ skipType: 'op', interval: { startTime: 45, endTime: 135 } }],
      })
      if (url.endsWith('/manifest.json')) return json({ id: 'test', name: 'Test', version: '1', resources: ['stream'] })
      if (url.includes('/stream/series/')) return json({ streams: [{ url: 'https://media.example/e1.mp4' }] })
      return json({}, 404)
    })
    const result = await resolveDirectSources({
      enabled: true, addons: ['https://addon.example'], quality: 'any', sort: 'quality',
      audioLang: '', connectedDeviceFallback: false, debrid: null,
    }, { ref: { provider: 'anilist', type: 'anime', id: '100' }, episode: 1 }, fetcher)

    expect(result.skipSegments).toEqual([{ type: 'op', startTime: 45, endTime: 135, label: 'Opening' }])
  })

  it('does not accept arbitrary or JVM media references', () => {
    expect(() => normalizeResolveRequest({ ref: { provider: 'jvm', type: 'anime', id: 'x' } }))
      .toThrow(/cannot be resolved/)
  })

  it('resolves a torrent through the generated copy of Izumi’s debrid provider code', async () => {
    const hash = 'b'.repeat(40)
    let infoCalls = 0
    const fetcher = vi.fn(async (raw: RequestInfo | URL, init?: RequestInit) => {
      const url = String(raw)
      if (url.endsWith('/manifest.json')) return json({
        id: 'torrent', name: 'Torrent add-on', version: '1', resources: ['stream'],
      })
      if (url.includes('/stream/series/')) return json({ streams: [{
        infoHash: hash,
        fileIdx: 1,
        title: 'Show S01E02 1080p',
        sources: ['tracker:https://tracker.example/announce'],
      }] })
      if (url.includes('/torrents?limit=1000&page=1')) return json([])
      if (url.endsWith('/torrents/addMagnet')) {
        expect(init?.body).toContain(`magnet%3A%3Fxt%3Durn%3Abtih%3A${hash}`)
        expect(init?.body).toContain('tracker.example')
        return json({ id: 'torrent-id' }, 201)
      }
      if (url.endsWith('/torrents/selectFiles/torrent-id')) {
        expect(init?.body).toBe('files=1%2C2')
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/torrents/info/torrent-id')) {
        infoCalls += 1
        return json({
          id: 'torrent-id',
          status: infoCalls === 1 ? 'waiting_files_selection' : 'downloaded',
          files: [
            { id: 1, path: '/Show.S01E01.mkv', bytes: 1_000, selected: 0 },
            { id: 2, path: '/Show.S01E02.mkv', bytes: 900, selected: infoCalls === 1 ? 0 : 1 },
          ],
          links: infoCalls === 1 ? [] : ['https://real-debrid.example/restricted'],
        })
      }
      if (url.endsWith('/unrestrict/link')) return json({
        id: 'download-id',
        download: 'https://cdn.real-debrid.example/Show.S01E02.mkv',
        filename: 'Show.S01E02.mkv',
      })
      return json({}, 404)
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await resolveDirectSources({
      enabled: true,
      addons: ['https://addon.example'],
      quality: '1080',
      sort: 'quality',
      audioLang: '',
      connectedDeviceFallback: false,
      debrid: { provider: 'realdebrid', credential: 'R'.repeat(32) },
    }, {
      ref: { provider: 'kitsu', type: 'anime', id: '42' },
      episode: 2,
    }, fetcher)

    expect(result.candidates[0]).toMatchObject({
      url: 'https://cdn.real-debrid.example/Show.S01E02.mkv',
      contentType: 'video/x-matroska',
      source: 'Real-Debrid',
      delivery: 'debrid',
    })
    expect(JSON.stringify(result)).not.toContain('RRRR')
  })

  it('tries the next ranked torrent when the first debrid candidate fails', async () => {
    const failedHash = 'a'.repeat(40)
    const workingHash = 'b'.repeat(40)
    let addCalls = 0
    const fetcher = vi.fn(async (raw: RequestInfo | URL, init?: RequestInit) => {
      const url = String(raw)
      if (url.endsWith('/manifest.json')) return json({
        id: 'torrent', name: 'Torrent add-on', version: '1', resources: ['stream'],
      })
      if (url.includes('/stream/series/')) return json({ streams: [
        { infoHash: failedHash, title: 'Show S01E02 1080p FIRST' },
        { infoHash: workingHash, title: 'Show S01E02 1080p SECOND' },
      ] })
      if (url.includes('/torrents?limit=1000&page=1')) return json([])
      if (url.endsWith('/torrents/addMagnet')) {
        addCalls += 1
        return String(init?.body).includes(failedHash)
          ? json({ error: 'unavailable' }, 503)
          : json({ id: 'working-torrent' }, 201)
      }
      if (url.endsWith('/torrents/selectFiles/working-torrent')) return new Response(null, { status: 204 })
      if (url.endsWith('/torrents/info/working-torrent')) return json({
        id: 'working-torrent', status: 'downloaded',
        files: [{ id: 2, path: '/Show.S01E02.mkv', bytes: 900, selected: 1 }],
        links: ['https://real-debrid.example/restricted'],
      })
      if (url.endsWith('/unrestrict/link')) return json({
        id: 'download-id', download: 'https://cdn.real-debrid.example/Show.S01E02.mkv',
        filename: 'Show.S01E02.mkv',
      })
      return json({}, 404)
    })
    vi.stubGlobal('fetch', fetcher)

    const result = await resolveDirectSources({
      enabled: true, addons: ['https://addon.example'], quality: '1080', sort: 'quality',
      audioLang: '', connectedDeviceFallback: false,
      debrid: { provider: 'realdebrid', credential: 'R'.repeat(32) },
    }, {
      ref: { provider: 'kitsu', type: 'anime', id: '42' }, episode: 2, season: 1,
    }, fetcher)

    expect(addCalls).toBe(2)
    expect(result.candidates[0]?.url).toBe('https://cdn.real-debrid.example/Show.S01E02.mkv')
    expect(result.failures).toHaveLength(1)
  })
})
