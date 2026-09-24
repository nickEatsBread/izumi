import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readable, writable } from 'svelte/store'
import { clearProviderCache } from './online-cache'

// Same harness as onlinestream.incremental.test.ts: only the runtime and the settings stores are
// mocked, so the hops the wave issues are directly observable on the provider's call list.
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

// Mirrors encodeJvmIdentity / videosOf in catalog/providers/jvm.ts: the catalog id is the
// [sourceId, url, title, cover] tuple and each video id is the source's own episode {url, name}.
const identity = encodeURIComponent(JSON.stringify(['src-1', '/anime/frieren', 'Sousou no Frieren', '']))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const media: any = {
  id: -1,
  title: { romaji: 'Sousou no Frieren', english: 'Sousou no Frieren' },
  synonyms: [],
  catalog: { provider: 'jvm', type: 'anime', id: identity },
  videos: [{
    id: JSON.stringify({ url: '/ep-1', name: 'Episode 1' }),
    number: 1, episode: 1, title: 'Episode 1', filler: true, group: 'Fansub',
    released: new Date(1_700_000_000_000).toISOString(),
  }],
}

/** A JVM-shaped provider (mixed audio, one server) whose every hop is recorded. The search path
 *  is fully answered so a test can tell "skipped" apart from "failed". */
function jvmProvider(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = vi.fn(async (method: string, ...args: unknown[]): Promise<any> => {
    if (method === 'getSettings') return { episodeServers: ['default'], returnsMixedAudio: true }
    if (method === 'search') return [{ id: JSON.stringify({ url: '/anime/frieren', title: 'Sousou no Frieren' }), title: 'Sousou no Frieren' }]
    if (method === 'findEpisodes') {
      return [1, 2].map((n) => ({
        id: JSON.stringify({ url: `/ep-${n}`, name: `Episode ${n}`, episode_number: n }),
        number: n, title: `Episode ${n}`, sourceTitle: 'Sousou no Frieren',
      }))
    }
    if (method === 'findEpisodeServer') {
      return { server: 'Src', headers: {}, videoSources: [{ url: `https://cdn/${id}.m3u8`, type: 'm3u8', quality: '1080p' }] }
    }
    void args
    return null
  })
  return { ext: { id, name: 'Src', lang: 'en', call }, call }
}

const methods = (call: ReturnType<typeof vi.fn>) => call.mock.calls.map((c) => c[0])

beforeEach(() => { runningStreamExtensions.mockReset(); clearProviderCache(); providerLanguages.set([]); providerAudio.set('both') })

describe('JVM catalog episode shortcut', () => {
  it('goes straight to findEpisodeServer with the episode the catalog already holds', async () => {
    const { ext, call } = jvmProvider('src-1')
    runningStreamExtensions.mockResolvedValue([ext])

    const rows = await resolveOnlineStreams(media, 1)
    expect(rows.map((row) => row.url)).toEqual(['https://cdn/src-1.m3u8'])
    expect(methods(call)).not.toContain('search')
    expect(methods(call)).not.toContain('findEpisodes')
    const [, episode, server] = call.mock.calls.find(([method]) => method === 'findEpisodeServer') as [string, { id: string }, string]
    expect(server).toBe('default')
    // The bridge re-parses this into the SEpisode getVideoList wants, annotations included.
    expect(JSON.parse(episode.id)).toEqual({
      url: '/ep-1', name: 'Episode 1', episode_number: 1, scanlator: 'Fansub', date_upload: 1_700_000_000_000, fillermark: true,
    })
    expect(rows[0].__sourceTitle).toBe('Sousou no Frieren')
    expect(rows[0].behaviorHints?.filename).toBe('Sousou no Frieren — Episode 1')
  })

  it('still searches when the provider is not the source the title came from', async () => {
    const { ext, call } = jvmProvider('src-2')
    runningStreamExtensions.mockResolvedValue([ext])

    const rows = await resolveOnlineStreams(media, 1)
    expect(methods(call)).toContain('search')
    expect(methods(call)).toContain('findEpisodes')
    expect(rows).toHaveLength(1)
  })

  it('falls back to the provider for an episode the cached detail does not list yet', async () => {
    const { ext, call } = jvmProvider('src-1')
    runningStreamExtensions.mockResolvedValue([ext])

    const rows = await resolveOnlineStreams(media, 2)
    expect(methods(call)).toEqual(expect.arrayContaining(['search', 'findEpisodes', 'findEpisodeServer']))
    expect(rows).toHaveLength(1)
  })
})
