import { describe, expect, it, vi } from 'vitest'
import {
  defaultResolverProfile,
  normalizeAddonBase,
  normalizeResolveRequest,
  normalizeResolverProfile,
  publicResolverProfile,
  resolveDirectSources,
  streamRequestPlan,
} from '../../../cloudflare-sync-worker/src/resolver.js'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

describe('self-hosted Cloudflare source resolver', () => {
  it('is disabled with no uploaded add-ons by default', () => {
    expect(defaultResolverProfile()).toEqual({
      enabled: false,
      addons: [],
      quality: 'any',
      sort: 'quality',
      audioLang: '',
      connectedDeviceFallback: false,
      debrid: null,
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
      debrid: null,
    })
  })

  it('never echoes the configured debrid token from an owner profile response', () => {
    const profile = publicResolverProfile({
      enabled: true,
      addons: ['https://addon.example/a'],
      quality: '1080',
      sort: 'quality',
      audioLang: 'jpn',
      connectedDeviceFallback: false,
      debrid: { provider: 'realdebrid', token: 'secret-token-value-123456', transcode: true },
    })
    expect(profile.debrid).toEqual({ provider: 'realdebrid', configured: true, transcode: true })
    expect(JSON.stringify(profile)).not.toContain('secret-token')
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

  it('does not accept arbitrary or JVM media references', () => {
    expect(() => normalizeResolveRequest({ ref: { provider: 'jvm', type: 'anime', id: 'x' } }))
      .toThrow(/cannot be resolved/)
  })

  it('resolves a torrent through Real-Debrid and prefers its TV-compatible HLS variant', async () => {
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
      if (url.endsWith('/torrents/addMagnet')) {
        expect(init?.body).toContain(`magnet%3A%3Fxt%3Durn%3Abtih%3A${hash}`)
        expect(init?.body).toContain('tracker.example')
        return json({ id: 'torrent-id' }, 201)
      }
      if (url.endsWith('/torrents/selectFiles/torrent-id')) {
        expect(init?.body).toBe('files=2')
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
      if (url.endsWith('/streaming/transcode/download-id')) return json({
        apple: { '1080p': 'https://stream.real-debrid.example/1080/master.m3u8' },
        dash: { '1080p': 'https://stream.real-debrid.example/1080/manifest.mpd' },
      })
      return json({}, 404)
    })
    const result = await resolveDirectSources({
      enabled: true,
      addons: ['https://addon.example'],
      quality: '1080',
      sort: 'quality',
      audioLang: '',
      connectedDeviceFallback: false,
      debrid: { provider: 'realdebrid', token: 'R'.repeat(32), transcode: true },
    }, {
      ref: { provider: 'kitsu', type: 'anime', id: '42' },
      episode: 2,
      capabilities: { hls: true, dash: true },
    }, fetcher)

    expect(result.candidates[0]).toMatchObject({
      url: 'https://stream.real-debrid.example/1080/master.m3u8',
      contentType: 'application/vnd.apple.mpegurl',
      delivery: 'debrid-transcode',
    })
    expect(result.candidates.some((candidate) => candidate.delivery === 'debrid')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('RRRR')
  })
})
