import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readable, writable } from 'svelte/store'
import { clearProviderCache } from './online-cache'

// Same harness as onlinestream.incremental.test.ts: mock the extension runtime and settings stores
// so the wave's outbound calls can be observed directly.
const runningStreamExtensions = vi.fn()
vi.mock('$lib/extensions/manager', () => ({ runningStreamExtensions: (...a: unknown[]) => runningStreamExtensions(...a) }))
const providerLanguages = writable<string[]>([])
const providerAudio = writable<'both' | 'sub' | 'dub'>('both')
vi.mock('$lib/settings/ui', () => ({
  preferredAudioLang: readable('jpn'),
  preferredSubLang: readable('eng'),
  providerLanguages: { subscribe: (fn: (v: string[]) => void) => providerLanguages.subscribe(fn) },
  providerAudio: { subscribe: (fn: (v: string) => void) => providerAudio.subscribe(fn) },
}))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock('$lib/anilist/media', () => ({ title: (m: any) => m.title.romaji }))

const { resolveOnlineStreams } = await import('./onlinestream')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const media: any = { title: { romaji: 'Frieren', english: 'Frieren' }, synonyms: [], seasonYear: 2023 }

/** One healthy provider whose every call is recorded, so "did the wave issue a hop?" is a direct
 *  assertion on the call list. */
function spyingProvider(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = vi.fn(async (method: string, ...args: unknown[]): Promise<any> => {
    if (method === 'getSettings') return { episodeServers: ['srv'] }
    if (method === 'search') return [{ id: `${id}-x`, title: 'Frieren' }]
    if (method === 'findEpisodes') return [{ id: `${id}-ep1`, number: 1, title: 'Episode 1' }]
    if (method === 'findEpisodeServer') {
      return { server: 'srv', headers: {}, videoSources: [{ url: `https://cdn/${id}.m3u8`, type: 'm3u8', quality: '1080p' }] }
    }
    void args
    return null
  })
  return { ext: { id, name: id, lang: undefined, call }, call }
}

beforeEach(() => { runningStreamExtensions.mockReset(); clearProviderCache(); providerLanguages.set([]); providerAudio.set('both') })

describe('resolveOnlineStreams abort', () => {
  it('issues no search/server hops and resolves [] when the signal is already aborted', async () => {
    const { ext, call } = spyingProvider('a')
    runningStreamExtensions.mockResolvedValue([ext])
    const controller = new AbortController()
    controller.abort()

    const rows = await resolveOnlineStreams(media, 1, undefined, undefined, controller.signal)
    expect(rows).toEqual([])
    // A pre-aborted resolve must not reach the provider at all — every call is a hop that
    // competes with the playback path the abort exists to protect (settings included).
    expect(call.mock.calls).toEqual([])
  })

  it('sanity: without a signal the same harness produces rows via search', async () => {
    const { ext, call } = spyingProvider('b')
    runningStreamExtensions.mockResolvedValue([ext])

    const rows = await resolveOnlineStreams(media, 1)
    expect(rows.map((s) => s.url)).toEqual(['https://cdn/b.m3u8'])
    expect(call.mock.calls.map((c) => c[0])).toContain('search')
  })
})
