import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readable, writable } from 'svelte/store'
import { clearProviderCache } from './online-cache'

// resolveOnlineStreams reaches for the extension runtime, the settings stores and the title helper.
// Mock those so the wave's TIMING can be asserted directly.
const runningStreamExtensions = vi.fn()
vi.mock('$lib/extensions/manager', () => ({ runningStreamExtensions: (...a: unknown[]) => runningStreamExtensions(...a) }))
// Writable so individual tests can change the filters mid-suite.
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

/** A provider whose findEpisodeServer resolves only when `release()` is called.
 *  `supportsDub` mirrors the SDK's getSettings flag; `dubOnly`/`subOnly` model a site that only
 *  carries one flavour, so the other search pass finds nothing. */
function provider(
  id: string,
  name: string,
  opts: { lang?: string; gate?: Promise<void>; supportsDub?: boolean; has?: ('sub' | 'dub')[] } = {},
) {
  const has = opts.has ?? ['sub', 'dub']
  return {
    id,
    name,
    lang: opts.lang,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call: async (method: string, ...args: unknown[]): Promise<any> => {
      if (method === 'search') {
        const dub = !!(args[0] as { dub?: boolean } | undefined)?.dub
        if (!has.includes(dub ? 'dub' : 'sub')) return []
        return [{ id: `${id}-${dub ? 'dub' : 'sub'}`, title: 'Frieren' }]
      }
      if (method === 'findEpisodes') {
        const flavour = String(args[0]).endsWith('-dub') ? 'dub' : 'sub'
        // A real show has many episodes; the list is the same regardless of which one is wanted,
        // which is exactly why it is memoized.
        return [1, 2, 3].map((n) => ({ id: `${id}-${flavour}-ep${n}`, number: n, title: `Episode ${n}` }))
      }
      if (method === 'getSettings') return { episodeServers: ['srv'], supportsDub: opts.supportsDub }
      if (method === 'findEpisodeServer') {
        if (opts.gate) await opts.gate
        const flavour = String((args[0] as { id?: string } | undefined)?.id ?? '').includes('-dub') ? 'dub' : 'sub'
        return { server: 'srv', headers: {}, videoSources: [{ url: `https://cdn/${id}-${flavour}.m3u8`, type: 'm3u8', quality: '1080p' }] }
      }
      void args
      return null
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => { runningStreamExtensions.mockReset(); clearProviderCache(); providerLanguages.set([]); providerAudio.set('both') })

describe('resolveOnlineStreams incremental delivery', () => {
  it('emits a fast provider\'s rows while a slow one is still pending', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    runningStreamExtensions.mockResolvedValue([provider('fast', 'FastProvider'), provider('slow', 'SlowProvider', { gate })])

    const batches: (string | undefined)[][] = []
    const done = resolveOnlineStreams(media, 1, undefined, (rs) => batches.push(rs.map((s) => s.url)))

    // Let the fast provider run to completion. The slow one is still blocked on its gate.
    for (let i = 0; i < 10; i++) await tick()
    // The regression: previously nothing surfaced until BOTH providers had settled.
    expect(batches).toEqual([['https://cdn/fast-sub.m3u8']])

    release()
    const all = await done
    expect(batches).toEqual([['https://cdn/fast-sub.m3u8'], ['https://cdn/slow-sub.m3u8']])
    expect(all.map((s) => s.url).sort()).toEqual(['https://cdn/fast-sub.m3u8', 'https://cdn/slow-sub.m3u8'])
  })

  it('still returns every row when no callback is passed', async () => {
    runningStreamExtensions.mockResolvedValue([provider('a', 'A'), provider('b', 'B')])
    const all = await resolveOnlineStreams(media, 1)
    expect(all.map((s) => s.url).sort()).toEqual(['https://cdn/a-sub.m3u8', 'https://cdn/b-sub.m3u8'])
  })

  it('does not fire the callback for a provider that returns nothing', async () => {
    const empty = { id: 'e', name: 'Empty', lang: undefined, call: async () => null }
    runningStreamExtensions.mockResolvedValue([empty, provider('ok', 'Ok')])
    const batches: (string | undefined)[][] = []
    const all = await resolveOnlineStreams(media, 1, undefined, (rs) => batches.push(rs.map((s) => s.url)))
    expect(batches).toEqual([['https://cdn/ok-sub.m3u8']])
    expect(all).toHaveLength(1)
  })

  it('emits nothing and returns [] when no extensions are configured', async () => {
    runningStreamExtensions.mockResolvedValue([])
    const batches: unknown[] = []
    expect(await resolveOnlineStreams(media, 1, undefined, (rs) => batches.push(rs))).toEqual([])
    expect(batches).toEqual([])
  })
})

describe('resolve cost', () => {
  /** Counts every worker call so the number of round trips per episode is directly observable. */
  function counting(id: string, supportsDub?: boolean) {
    const counts: Record<string, number> = {}
    const p = provider(id, id, { supportsDub })
    return {
      counts,
      ext: {
        ...p,
        call: (m: string, ...a: unknown[]) => { counts[m] = (counts[m] ?? 0) + 1; return p.call(m, ...a) },
      },
    }
  }

  it('does not repeat search/findEpisodes/getSettings for a second episode', async () => {
    // The binge case: opening the picker on episode 2 previously re-ran the whole chain even
    // though only findEpisodeServer depends on the episode.
    const c = counting('p')
    runningStreamExtensions.mockResolvedValue([c.ext])
    await resolveOnlineStreams(media, 1)
    const afterFirst = { ...c.counts }
    await resolveOnlineStreams(media, 2)

    expect(c.counts.search).toBe(afterFirst.search)
    expect(c.counts.findEpisodes).toBe(afterFirst.findEpisodes)
    expect(c.counts.getSettings).toBe(afterFirst.getSettings)
    // Only the episode-specific hop runs again — those URLs are tokenized and must not be reused.
    expect(c.counts.findEpisodeServer).toBe((afterFirst.findEpisodeServer ?? 0) + 1)
  })

  it('shares one getSettings across the dub and sub passes', async () => {
    const c = counting('p', true)
    runningStreamExtensions.mockResolvedValue([c.ext])
    await resolveOnlineStreams(media, 1)
    expect(c.counts.getSettings).toBe(1)
    expect(c.counts.search).toBe(2) // one per audio flavour — the dub flag changes the query
  })
})

describe('user filters', () => {
  /** Counts calls so "was this provider queried at all?" is directly observable. */
  function spy(id: string, opts: Parameters<typeof provider>[2] = {}) {
    const calls: string[] = []
    const p = provider(id, id, opts)
    return { calls, ext: { ...p, call: (m: string, ...a: unknown[]) => { calls.push(m); return p.call(m, ...a) } } }
  }

  it('never queries a provider whose language is not selected', async () => {
    // The point of filtering by language is that the skipped provider costs nothing — a filter
    // applied to the RESULTS would still pay for every request.
    const en = spy('en', { lang: 'en' })
    const it = spy('it', { lang: 'it' })
    runningStreamExtensions.mockResolvedValue([en.ext, it.ext])
    providerLanguages.set(['en'])

    const all = await resolveOnlineStreams(media, 1)
    expect(it.calls).toEqual([])
    expect(en.calls.length).toBeGreaterThan(0)
    expect(all.map((s) => s.__addonName)).toEqual(['en'])
  })

  it('keeps an undeclared-language provider under any allowlist', async () => {
    const unknown = spy('u', {})
    runningStreamExtensions.mockResolvedValue([unknown.ext])
    providerLanguages.set(['en'])
    expect(await resolveOnlineStreams(media, 1)).toHaveLength(1)
  })

  it('queries every language when the allowlist is empty', async () => {
    const it = spy('it', { lang: 'it' })
    runningStreamExtensions.mockResolvedValue([it.ext])
    providerLanguages.set([])
    expect(await resolveOnlineStreams(media, 1)).toHaveLength(1)
  })

  it('requests only the dub pass under "Dubbed only"', async () => {
    const p = spy('p', { supportsDub: true })
    runningStreamExtensions.mockResolvedValue([p.ext])
    providerAudio.set('dub')
    const all = await resolveOnlineStreams(media, 1)
    expect(all.map((s) => s.__audio)).toEqual(['dub'])
    expect(p.calls.filter((c) => c === 'search')).toHaveLength(1)
  })

  it('skips a sub-only provider entirely under "Dubbed only"', async () => {
    const p = spy('p', { supportsDub: false })
    runningStreamExtensions.mockResolvedValue([p.ext])
    providerAudio.set('dub')
    expect(await resolveOnlineStreams(media, 1)).toEqual([])
    // getSettings is what reveals it has no dub; nothing beyond that should run.
    expect(p.calls).toEqual(['getSettings'])
  })

  it('requests only the sub pass under "Subbed only"', async () => {
    const p = spy('p', { supportsDub: true })
    runningStreamExtensions.mockResolvedValue([p.ext])
    providerAudio.set('sub')
    const all = await resolveOnlineStreams(media, 1)
    expect(all.map((s) => s.__audio)).toEqual(['sub'])
  })
})

describe('dub and sub resolution', () => {
  const audioOf = (s: { __audio?: string }[]) => s.map((x) => x.__audio)

  it('offers BOTH flavours when the provider declares dub support', async () => {
    // The default audio setting is Japanese, so before this a dub was unreachable no matter what
    // the provider carried — the dub pass never ran.
    runningStreamExtensions.mockResolvedValue([provider('p', 'P', { supportsDub: true })])
    const all = await resolveOnlineStreams(media, 1)
    expect(all.map((s) => s.url)).toEqual(['https://cdn/p-sub.m3u8', 'https://cdn/p-dub.m3u8'])
    // Preferred flavour first, and each row carries its real audio type for the DUB/SUB badge.
    expect(audioOf(all)).toEqual(['sub', 'dub'])
  })

  it('never queries a dub pass for a provider that declares none', async () => {
    const calls: string[] = []
    const p = provider('p', 'P', { supportsDub: false })
    const spy = { ...p, call: (m: string, ...a: unknown[]) => { if (m === 'search') calls.push(JSON.stringify(a[0])) ; return p.call(m, ...a) } }
    runningStreamExtensions.mockResolvedValue([spy])
    const all = await resolveOnlineStreams(media, 1)
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0]).dub).toBe(false)
    expect(audioOf(all)).toEqual(['sub'])
  })

  it('does not duplicate a row when a provider ignores the dub flag', async () => {
    // Such a provider returns the same URL for both passes; the row must appear once, labelled
    // with the preferred flavour, not twice with contradictory badges.
    const same = {
      id: 's', name: 'S', lang: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      call: async (method: string): Promise<any> => {
        if (method === 'search') return [{ id: 'x', title: 'Frieren' }]
        if (method === 'findEpisodes') return [{ id: 'x-ep1', number: 1 }]
        if (method === 'getSettings') return { episodeServers: ['srv'], supportsDub: true }
        if (method === 'findEpisodeServer') return { server: 'srv', headers: {}, videoSources: [{ url: 'https://cdn/same.m3u8', type: 'm3u8', quality: '720p' }] }
        return null
      },
    }
    runningStreamExtensions.mockResolvedValue([same])
    const all = await resolveOnlineStreams(media, 1)
    expect(all).toHaveLength(1)
    expect(all[0].__audio).toBe('sub')
  })

  it('still returns the sub when a declared dub does not actually exist for this title', async () => {
    runningStreamExtensions.mockResolvedValue([provider('p', 'P', { supportsDub: true, has: ['sub'] })])
    const all = await resolveOnlineStreams(media, 1)
    expect(audioOf(all)).toEqual(['sub'])
  })

  it('returns a dub-only title even though sub is the preferred flavour', async () => {
    runningStreamExtensions.mockResolvedValue([provider('p', 'P', { supportsDub: true, has: ['dub'] })])
    const all = await resolveOnlineStreams(media, 1)
    expect(audioOf(all)).toEqual(['dub'])
    expect(all[0].url).toBe('https://cdn/p-dub.m3u8')
  })
})
