import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDirectSources } from '../src/resolver.js'
import { resolveHash, checkCached } from '../src/generated/resolver-core/debrid/index.ts'

vi.mock('../src/generated/resolver-core/debrid/index.ts', async importOriginal => ({
  ...await importOriginal<any>(),
  resolveHash: vi.fn(async () => 'https://media.example/prepared.mp4'),
  resolveSidecars: vi.fn(async () => []),
  checkCached: vi.fn(async (_provider, _credential, hashes: string[]) => new Map(hashes.map(hash => [hash, 'cached']))),
}))
vi.mock('../src/tv-source-lookup.js', async importOriginal => ({
  ...await importOriginal<any>(),
  tvSourceRequests: (base: string) => base === 'https://blocked.example' ? [{ id: 'source', url: 'https://source.example/public.json' }] : [],
}))
const input = { title: 'Example Movie', ref: { provider: 'tmdb', type: 'movie', id: '808' }, streamType: 'movie', streamIds: ['tt0126029'] }
const profile = { enabled: true, addons: ['https://fast.example', 'https://slow.example'] }
const response = (value: unknown, status = 200) => Response.json(value, { status })
function fetchFixture(first: unknown = { streams: [{ url: 'https://media.example/fast.mp4', title: 'Example Movie 1080p' }] }) {
  let release!: () => void
  const slow = new Promise<void>(resolve => { release = resolve })
  const fetcher = vi.fn(async (raw: any) => {
    const url = String(raw)
    if (url.endsWith('/manifest.json')) return response({ resources: ['stream'] })
    if (url.includes('blocked.example/stream')) return response({}, 403)
    if (url.includes('fast.example/stream')) return response(first)
    if (url.includes('slow.example/stream')) {
      await slow
      return response({ streams: [{ url: 'https://media.example/slow.mp4', title: 'Example Movie 720p' }] })
    }
    return response({}, 404)
  })
  return { fetcher, release }
}
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('progressive source resolution', () => {
  it('publishes a usable source before slow discovery finishes and preserves final HTTP ordering', async () => {
    const { fetcher, release } = fetchFixture()
    const onProgress = vi.fn()
    let finished = false
    const resolving = resolveDirectSources(profile, input, fetcher, { onProgress }).then(value => { finished = true; return value })
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalled())
    expect(finished).toBe(false)
    expect(onProgress.mock.calls[0][0].candidates[0].url).toContain('/fast.mp4')
    release()
    const streamed = await resolving
    const http = await resolveDirectSources(profile, input, fetcher)
    expect(streamed.candidates).toEqual(http.candidates)
    expect(streamed.selectedId).toBe(http.selectedId)
  })
  it('publishes add-on and service subtitle tracks to progress listeners before completion', async () => {
    const { fetcher: base, release } = fetchFixture()
    const fetcher = vi.fn(async (raw: any) => {
      const url = String(raw)
      if (url === 'https://captions.example/manifest.json') return response({ resources: [{ name: 'subtitles', types: ['movie'], idPrefixes: ['tt'] }] })
      if (url.includes('captions.example/subtitles/')) return response({ subtitles: [{ url: 'https://subs.example/en.srt', lang: 'eng', title: 'English SDH' }] })
      return base(raw)
    })
    const onProgress = vi.fn()
    const resolving = resolveDirectSources({ ...profile, addons: ['https://fast.example', 'https://captions.example', 'https://slow.example'] }, input, fetcher, { onProgress })
    try {
      // A TV that keeps only the latest progress snapshot (channel drop, timeout) must still
      // receive every discovered subtitle track, not just per-release sidecars.
      await vi.waitFor(() => expect(onProgress.mock.calls.some(([value]) =>
        value.candidates[0]?.subtitles?.some((track: any) => track.url === 'https://subs.example/en.srt'))).toBe(true))
    } finally { release() }
    const result = await resolving
    expect(result.candidates[0].subtitles).toContainEqual({ url: 'https://subs.example/en.srt', title: 'English SDH', lang: 'eng' })
  })
  it('delegates a blocked fetch and prepares its result before unrelated discovery finishes', async () => {
    const { fetcher, release } = fetchFixture()
    const fetchSource = vi.fn(async () => [{ infoHash: 'a'.repeat(40), title: 'Example Movie 1080p', behaviorHints: { filename: 'Example.Movie.mkv' } }])
    const onProgress = vi.fn()
    const resolving = resolveDirectSources({ ...profile, addons: ['https://blocked.example', 'https://slow.example'],
      debrid: { provider: 'torbox', credential: 'private-key' } }, input, fetcher, { onProgress, fetchSource })
    await vi.waitFor(() => expect(onProgress.mock.calls.some(([value]) => value.candidates.some((c: any) => c.delivery === 'debrid'))).toBe(true))
    expect(fetchSource).toHaveBeenCalledTimes(1)
    expect(checkCached).toHaveBeenCalledTimes(1)
    expect(resolveHash).toHaveBeenCalledTimes(1)
    release()
    const value = await resolving
    expect(value).not.toHaveProperty('tvSourceLookup')
    expect(value.candidates.some((c: any) => c.delivery === 'debrid')).toBe(true)
    expect(resolveHash).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(onProgress.mock.calls)).not.toContain('private-key')
  })
  it('honors cancellation and exclusion before further release preparation', async () => {
    const { fetcher, release } = fetchFixture()
    const controller = new AbortController()
    const onProgress = vi.fn(() => controller.abort())
    const resolving = resolveDirectSources(profile, input, fetcher, { onProgress, signal: controller.signal })
    const rejected = expect(resolving).rejects.toThrow()
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalled())
    release(); await rejected
    expect(resolveHash).not.toHaveBeenCalled()
    const all = await resolveDirectSources(profile, input, fetcher)
    const excluded = await resolveDirectSources(profile, { ...input, excludeCandidateIds: [all.candidates[0].id] }, fetcher, { onProgress: vi.fn() })
    expect(excluded.candidates.map((c: any) => c.id)).not.toContain(all.candidates[0].id)
  })
})
