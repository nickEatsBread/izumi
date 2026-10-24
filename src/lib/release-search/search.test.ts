import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  extensions: [] as Array<Record<string, unknown>>,
  providers: [] as Array<Record<string, unknown>>,
  trackers: [] as Array<Record<string, unknown>>,
  queries: [] as unknown[],
}))
vi.mock('$lib/platform', async () => ({ isAndroid: (await import('svelte/store')).readable(false) }))
vi.mock('$lib/extensions/manager', () => ({
  queryExtensions: async (query: unknown, onBatch: (rows: unknown[]) => void) => { state.queries.push(query); onBatch(state.extensions); return state.extensions },
}))
vi.mock('$lib/extensions/torrentProvider', () => ({
  toProviderMedia: (media: unknown) => media,
  queryTorrentProviders: async (_query: unknown, _media: unknown, onBatch: (rows: unknown[]) => void) => { onBatch(state.providers); return state.providers },
}))
vi.mock('$lib/extensions/tracker-feeds', () => ({
  queryTrackerFeeds: async (_query: unknown, onBatch: (rows: unknown[]) => void) => { onBatch(state.trackers); return state.trackers },
}))
import { searchReleases } from './search'

const hash = 'ab'.repeat(20)

describe('searchReleases', () => {
  beforeEach(() => { state.extensions = []; state.providers = []; state.trackers = []; state.queries = [] })

  it('sends the typed text as the only title, with no ids or episode', async () => {
    await searchReleases('  quiet harbor 05  ', () => {})
    expect(state.queries).toEqual([{ titles: ['quiet harbor 05'], isAndroid: false }])
  })

  it('keeps one row per infohash across sources, the better-seeded copy winning', async () => {
    state.extensions = [{ title: 'Quiet Harbor 05', hash, seeders: 3, provider: 'Extension A' }]
    state.trackers = [{ title: 'Quiet Harbor 05', hash: hash.toUpperCase(), seeders: 9, provider: 'Feed B' }]
    state.providers = [{ title: 'Quiet Harbor 06', hash: 'cd'.repeat(20), provider: 'Provider C' }]
    const seen: number[] = []
    const rows = await searchReleases('quiet harbor', (next) => seen.push(next.length))
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.title?.startsWith('Quiet Harbor 05'))).toMatchObject({ __seeders: 9, __addonName: 'Feed B' })
    expect(seen[seen.length - 1]).toBe(2)
  })

  it('does nothing for an empty box', async () => {
    expect(await searchReleases('   ', () => {})).toEqual([])
    expect(state.queries).toEqual([])
  })

  it('reports nothing once aborted', async () => {
    state.extensions = [{ title: 'Quiet Harbor 05', hash, provider: 'Extension A' }]
    const controller = new AbortController()
    controller.abort()
    const onRows = vi.fn()
    expect(await searchReleases('quiet harbor', onRows, controller.signal)).toEqual([])
    expect(onRows).not.toHaveBeenCalled()
  })
})
