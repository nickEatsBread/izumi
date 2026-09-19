import { beforeEach, expect, it, vi } from 'vitest'
const adapters = vi.hoisted(() => ({ resolve: vi.fn(), sidecars: vi.fn() }))
vi.mock('../src/generated/resolver-core/debrid/index.ts', async importOriginal => ({
  ...await importOriginal<object>(), resolveHash: adapters.resolve, resolveSidecars: adapters.sidecars, cacheCheckMode: () => 'none',
}))
import { providers } from '../src/generated/resolver-core/debrid/index.ts'
import { normalizeResolveRequest, publicResolverProfile, resolveDirectSources, streamRequestPlan } from '../src/resolver.js'
import { resolveSubtitleDownload, searchSubtitleServices } from '../src/subtitle-services.js'
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const movie = { ref: { provider: 'tmdb', type: 'movie', id: '123' }, streamType: 'movie', streamIds: ['tt0123456'], title: 'Example Film' }
beforeEach(() => { adapters.resolve.mockReset(); adapters.sidecars.mockReset().mockResolvedValue([]) })
it('resolves the full movie identity instead of an unrelated metadata video hint', async () => {
  const plan = await streamRequestPlan(normalizeResolveRequest({ ...movie, streamIds: ['video:promotional', ...movie.streamIds] }))
  expect(plan.ids).toEqual(movie.streamIds)
})
it('returns multiple converted choices and does not let a subtitle failure discard video', async () => {
  adapters.resolve.mockImplementation(async (_provider, _key, magnet: string) => `https://media.example/${magnet.slice(-40)}.mkv`)
  adapters.sidecars.mockRejectedValue(new Error('Subtitle service unavailable'))
  const result = await resolveDirectSources({ enabled: true, addons: ['https://source.example'], debrid: { provider: providers.keys().next().value, credential: 'private-key' } }, movie,
    async (url: string) => json(url.endsWith('/manifest.json') ? { resources: ['stream'] } : { streams: ['a', 'b', 'c', 'd'].map(char => ({ infoHash: char.repeat(40), title: `Example Film 1080p ${char}` })) }))
  expect(result.candidates).toHaveLength(4)
  expect(new Set(result.candidates.map(item => item.url)).size).toBe(4)
  expect(adapters.resolve).toHaveBeenCalledTimes(4)
  expect(JSON.stringify(result)).not.toContain('private-key')
})
it('filters preview and unsupported video before ranking while keeping valid alternatives', async () => {
  const result = await resolveDirectSources({ enabled: true, addons: ['https://source.example'] }, movie,
    async (url: string) => json(url.endsWith('/manifest.json') ? { resources: ['stream'] } : { streams: [
      { title: 'Example Film Prologue 2160p', url: 'https://media.example/preview.mkv' },
      { title: 'Example Film DV 2160p', url: 'https://media.example/unsupported.mkv' },
      { title: 'Example Film 1080p', url: 'https://media.example/full.mkv' },
    ] }))
  expect(result.candidates.map(item => item.url)).toEqual(['https://media.example/full.mkv'])
})

it('keeps manual alternatives when only one release advertises the preferred audio', async () => {
  const result = await resolveDirectSources({ enabled: true, audioLang: 'eng', addons: ['https://source.example'] }, movie,
    async (url: string) => json(url.endsWith('/manifest.json') ? { resources: ['stream'] } : { streams: [
      { title: 'Example 1080p English', url: 'https://media.example/en.mkv' },
      { title: 'Example 1080p French', url: 'https://media.example/fr.mkv' },
      { title: 'Example 1080p German', url: 'https://media.example/de.mkv' },
    ] }))
  expect(result.candidates).toHaveLength(3)
  expect(result.candidates[0].url).toBe('https://media.example/en.mkv')
})

it('skips previously offered releases when the TV asks for more choices', async () => {
  const profile = { enabled: true, addons: ['https://source.example'] }
  const fetcher = async (url: string) => json(url.endsWith('/manifest.json') ? { resources: ['stream'] } : { streams: [
    { title: 'Example 1080p', url: 'https://media.example/one.mkv' },
    { title: 'Example 720p', url: 'https://media.example/two.mkv' },
  ] })
  const initial = await resolveDirectSources(profile, movie, fetcher)
  const next = await resolveDirectSources(profile, { ...movie, excludeCandidateIds: [initial.candidates[0].id] }, fetcher)
  expect(next.candidates).toHaveLength(1)
  expect(next.candidates[0].url).toBe('https://media.example/two.mkv')
})

it('continues past failed conversions instead of exposing one success from three attempts', async () => {
  let attempt = 0
  adapters.resolve.mockImplementation(async () => {
    if (++attempt <= 2) throw new Error('Release unavailable')
    return `https://media.example/release-${attempt}.mkv`
  })
  const result = await resolveDirectSources({ enabled: true, addons: ['https://source.example'], debrid: { provider: providers.keys().next().value, credential: 'private-key' } }, movie,
    async (url: string) => json(url.endsWith('/manifest.json') ? { resources: ['stream'] } : { streams: ['a', 'b', 'c', 'd', 'e'].map(char => ({ infoHash: char.repeat(40), title: `Example 1080p ${char}` })) }))
  expect(result.candidates).toHaveLength(3)
  expect(adapters.resolve).toHaveBeenCalledTimes(5)
})
it('queries subtitle-only add-ons and preserves descriptive track names and language preferences', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url === 'https://captions.example/manifest.json') return json({ resources: [{ name: 'subtitles', types: ['movie'], idPrefixes: ['tt'] }] })
    if (url.includes('/manifest.json')) return json({ resources: ['stream'] })
    if (url.includes('/subtitles/movie/tt0123456.json')) return json({ subtitles: [{ url: 'https://subs.example/en.srt', lang: 'eng', title: 'English SDH' }] })
    return json({ streams: [{ url: 'https://media.example/full.mp4' }] })
  })
  const result = await resolveDirectSources({ enabled: true, subtitleLang: 'eng', addons: ['https://source.example', 'https://captions.example'] }, movie, fetcher)
  expect(result.trackPreferences.subtitle).toEqual({ language: 'eng' })
  expect(result.candidates[0].subtitles).toContainEqual({ url: 'https://subs.example/en.srt', title: 'English SDH', lang: 'eng' })
  expect(fetcher.mock.calls.some(([url]) => url.startsWith('https://captions.example/stream/'))).toBe(false)
})
it('bounds each candidate subtitle list so channel messages stay deliverable', async () => {
  const subtitles = Array.from({ length: 32 }, (_, index) => (
    { url: `https://subs.example/${'segment/'.repeat(50)}track-${index}.srt`, lang: 'eng', title: `English release variant ${index}` }
  ))
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('captions')) {
      if (url.endsWith('/manifest.json')) return json({ resources: [{ name: 'subtitles', types: ['movie'], idPrefixes: ['tt'] }] })
      return json({ subtitles })
    }
    if (url.endsWith('/manifest.json')) return json({ resources: ['stream'] })
    return json({ streams: [{ url: 'https://media.example/full.mp4', title: 'Example Film 1080p' }] })
  })
  const result = await resolveDirectSources({ enabled: true, addons: ['https://source.example', 'https://captions-a.example', 'https://captions-b.example'] }, movie, fetcher)
  const encoded = new TextEncoder().encode(JSON.stringify(result.candidates[0].subtitles)).length
  expect(result.candidates[0].subtitles.length).toBeGreaterThan(0)
  expect(encoded).toBeLessThan(9_000)
})
it('searches exact episode identity without spending download quota or exposing keys', async () => {
  const services = [{ kind: 'rest-v1', base: 'https://captions.example', apiKey: 'private-search-key' }]
  const fetcher = vi.fn(async () => json({ data: [{ attributes: { language: 'en', files: [{ file_id: 42, file_name: 'English dialogue' }] } }] }))
  const tracks = await searchSubtitleServices({ subtitleServices: services, subtitleLang: 'eng' }, { streamType: 'series' }, { ids: ['tt0123456:2:7'] }, fetcher)
  expect(String(fetcher.mock.calls[0][0])).toContain('episode_number=7&languages=en&parent_imdb_id=123456&season_number=2')
  expect(tracks[0]).toEqual({ title: 'English dialogue', lang: 'en', download: { serviceIndex: 0, fileId: 42 } })
  expect(JSON.stringify(tracks)).not.toContain('private-search-key')
  const download = vi.fn(async () => json({ link: 'https://subs.example/selected.srt' }))
  expect(await resolveSubtitleDownload(tracks[0].download, services, download)).toBe('https://subs.example/selected.srt')
  expect(JSON.parse(download.mock.calls[0][1].body)).toEqual({ file_id: 42, sub_format: 'srt' })
  const visible = publicResolverProfile({ addons: [], subtitleServices: services })
  expect(JSON.stringify(visible)).not.toContain('private-search-key')
})

it('uses only an unexpired private subtitle session and redacts it from public settings', async () => {
  const service = { kind: 'rest-v1', base: 'https://captions.example', apiKey: 'private-key', token: 'private-session', expires: Date.now() + 60_000 }
  const fetcher = vi.fn(async () => json({ link: 'https://subs.example/selected.srt' }))
  await resolveSubtitleDownload({ serviceIndex: 0, fileId: 42 }, [service], fetcher)
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer private-session')
  await resolveSubtitleDownload({ serviceIndex: 0, fileId: 42 }, [{ ...service, expires: Date.now() - 1 }], fetcher)
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBeUndefined()
  expect(JSON.stringify(publicResolverProfile({ addons: [], subtitleServices: [service] }))).not.toContain('private-session')
})

it('ignores malformed subtitle capabilities without losing playable streams', async () => {
  const result = await resolveDirectSources({ enabled: true, addons: ['https://source.example'] }, movie,
    async (url: string) => json(url.endsWith('/manifest.json') ? { resources: [null, { name: 'subtitles', idPrefixes: [null] }, 'stream'] } : { streams: [{ url: 'https://media.example/full.mp4' }] }))
  expect(result.candidates[0].url).toBe('https://media.example/full.mp4')
})

it('refines a same-id different production out of movie playback like the desktop picker', async () => {
  const result = await resolveDirectSources({ enabled: true, addons: ['https://source.example'] },
    { ...movie, title: 'The Odyssey (2026)' },
    async (url: string) => json(url.endsWith('/manifest.json') ? { resources: ['stream'] } : { streams: [
      { title: 'The.Odyssey.1997.DVDRip.XviD', url: 'https://media.example/miniseries.avi' },
      { title: '2001.A.Space.Odyssey.1968.REMASTERED.2160p', url: 'https://media.example/kubrick.mkv' },
      { title: 'The.Odyssey.2026.1080p.WEB-DL', url: 'https://media.example/feature.mkv' },
    ] }))
  expect(result.candidates.map(item => item.url)).toEqual(['https://media.example/feature.mkv'])
  expect(result.selectedId).toBe(result.candidates[0].id)
  expect(result.rejected).toBe(2)
})

it('falls back to the unrefined pool instead of blanking the picker when evidence rejects everything', async () => {
  const result = await resolveDirectSources({ enabled: true, addons: ['https://source.example'] },
    { ...movie, title: 'The Odyssey (2026)' },
    async (url: string) => json(url.endsWith('/manifest.json') ? { resources: ['stream'] } : { streams: [
      { title: 'The.Odyssey.1997.DVDRip.XviD', url: 'https://media.example/miniseries.avi' },
    ] }))
  expect(result.candidates.map(item => item.url)).toEqual(['https://media.example/miniseries.avi'])
  expect(result.rejected).toBe(0)
})

it('keeps valid resolver add-ons when one entry is unusable instead of rejecting the profile', () => {
  const addons = Array.from({ length: 20 }, (_, index) => `https://source-${index}.example`)
  const profile = publicResolverProfile({ addons: ['http://insecure.example', 'https://192.168.1.7/private', ...addons] })
  expect(profile.addons).toHaveLength(16)
  expect(profile.addons[0]).toBe('https://source-0.example')
  expect(profile.addons).not.toContain('http://insecure.example')
})
