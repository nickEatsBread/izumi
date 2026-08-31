import { describe, expect, it, vi } from 'vitest'
import {
  defaultResolverProfile,
  normalizeAddonBase,
  normalizeResolveRequest,
  normalizeResolverProfile,
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
    })
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

  it('does not accept arbitrary or JVM media references', () => {
    expect(() => normalizeResolveRequest({ ref: { provider: 'jvm', type: 'anime', id: 'x' } }))
      .toThrow(/cannot be resolved/)
  })
})
