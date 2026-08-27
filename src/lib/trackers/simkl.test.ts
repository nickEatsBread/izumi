import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ simklFetch: vi.fn() }))
vi.mock('./simkl-auth', () => ({ simklFetch: mocks.simklFetch }))

import {
  clearSimklListCache,
  getSimklAnimeIds,
  getSimklAnimeListEntries,
  invalidateSimklList,
  pushSimkl,
} from './simkl'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

const anime = (anilist: number, simkl = anilist, status = 'watching', slug = `anime-${anilist}`) => ({
  status,
  anime: { ids: { anilist, simkl, slug } },
})

describe('SIMKL activity-gated anime list cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'))
    mocks.simklFetch.mockReset()
    clearSimklListCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates an initial full-list baseline followed by its activity timestamp', async () => {
    mocks.simklFetch.mockImplementation(async (path: string) => path === '/sync/all-items/anime'
      ? json([anime(10)])
      : json({ anime: { all: '2026-08-27T11:55:00Z', removed_from_list: 'removed-1' } }))

    await expect(getSimklAnimeIds('watching')).resolves.toEqual([10])
    expect(mocks.simklFetch.mock.calls.map(([path]) => path)).toEqual([
      '/sync/all-items/anime',
      '/sync/activities',
    ])
  })

  it('accepts the documented bucket response and string external IDs', async () => {
    mocks.simklFetch.mockImplementation(async (path: string) => path === '/sync/all-items/anime'
      ? json({ anime: [{
          status: 'watching',
          watched_episodes_count: 3,
          last_watched_at: '2026-08-27T10:30:00Z',
          show: { ids: { anilist: '10', simkl_id: 1885096, slug: 'anime-10' } },
        }] })
      : json({ anime: { all: 'activity-1' } }))

    await expect(getSimklAnimeListEntries('watching')).resolves.toEqual([{
      anilistId: 10,
      progress: 3,
      updatedAt: 1_787_826_600,
    }])
    await expect(getSimklAnimeIds('watching')).resolves.toEqual([10])
  })

  it('does not misreport a failed SIMKL library request as an empty list', async () => {
    mocks.simklFetch.mockResolvedValue(json({ error: 'temporary' }, 503))
    await expect(getSimklAnimeIds('watching')).rejects.toThrow('HTTP 503')
  })

  it('checks activities after the user-data cache expires and skips an unchanged list pull', async () => {
    mocks.simklFetch.mockImplementation(async (path: string) => path === '/sync/all-items/anime'
      ? json([anime(10)])
      : json({ anime: { all: 'same-timestamp', removed_from_list: 'removed-1' } }))

    await getSimklAnimeIds('watching')
    mocks.simklFetch.mockClear()
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 1)
    await expect(getSimklAnimeIds('watching')).resolves.toEqual([10])
    expect(mocks.simklFetch.mock.calls.map(([path]) => path)).toEqual(['/sync/activities'])
  })

  it('fetches and merges a delta only when anime activity changed', async () => {
    let listVersion = 1
    let activity = 'activity-1'
    mocks.simklFetch.mockImplementation(async (path: string) => {
      if (path === '/sync/activities') return json({ anime: { all: activity } })
      if (path.includes('date_from=')) return json([anime(listVersion * 10, 10)])
      return json([anime(listVersion * 10, 10)])
    })

    await expect(getSimklAnimeIds('watching')).resolves.toEqual([10])
    mocks.simklFetch.mockClear()
    listVersion = 2
    activity = 'activity-2'
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 1)
    await expect(getSimklAnimeIds('watching')).resolves.toEqual([20])
    expect(mocks.simklFetch.mock.calls.map(([path]) => path)).toEqual([
      '/sync/activities',
      '/sync/all-items/anime?date_from=activity-1',
    ])
  })

  it('forces an immediate activity check after Izumi writes to SIMKL', async () => {
    let listVersion = 1
    mocks.simklFetch.mockImplementation(async (path: string) => path === '/sync/all-items/anime'
      ? json([anime(listVersion * 10, 10)])
      : path.includes('date_from=')
        ? json([anime(listVersion * 10, 10)])
      : json({ anime: { all: `activity-${listVersion}` } }))

    await getSimklAnimeIds('watching')
    mocks.simklFetch.mockClear()
    listVersion = 2
    invalidateSimklList()
    await expect(getSimklAnimeIds('watching')).resolves.toEqual([20])
    expect(mocks.simklFetch.mock.calls.map(([path]) => path)).toEqual([
      '/sync/activities',
      '/sync/all-items/anime?date_from=activity-1',
    ])
  })

  it('diffs an ID-only snapshot when SIMKL reports a list removal', async () => {
    let changed = false
    mocks.simklFetch.mockImplementation(async (path: string) => {
      if (path === '/sync/activities') return json({ anime: {
        all: changed ? 'activity-2' : 'activity-1',
        removed_from_list: changed ? 'removed-2' : 'removed-1',
      } })
      if (path.includes('date_from=')) return json([])
      if (path.includes('extended=simkl_ids_only')) return json([anime(20)])
      return json([anime(10), anime(20)])
    })

    await expect(getSimklAnimeIds('watching')).resolves.toEqual([10, 20])
    changed = true
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 1)
    await expect(getSimklAnimeIds('watching')).resolves.toEqual([20])
    expect(mocks.simklFetch.mock.calls.map(([path]) => path).slice(-3)).toEqual([
      '/sync/activities',
      '/sync/all-items/anime?date_from=activity-1',
      '/sync/all-items/anime?extended=simkl_ids_only',
    ])
  })

  it('retries SIMKL’s documented sync-lock 400 through the durable queue policy', async () => {
    mocks.simklFetch.mockResolvedValue(json({ error: 'rate_limit' }, 400))
    await expect(pushSimkl({
      kind: 'status', mediaId: 10, idAniList: 10, status: 'CURRENT',
    })).resolves.toEqual({ ok: false, retryable: true })
  })

  it('combines progress and status in one history write instead of chaining two POSTs', async () => {
    mocks.simklFetch.mockResolvedValue(json({ added: { episodes: 3 } }, 201))
    await expect(pushSimkl({
      kind: 'progress', mediaId: 10, idAniList: 10, progress: 3, status: 'PAUSED',
    })).resolves.toEqual({ ok: true })

    expect(mocks.simklFetch).toHaveBeenCalledTimes(1)
    const [path, init] = mocks.simklFetch.mock.calls[0]
    expect(path).toBe('/sync/history')
    expect(JSON.parse(init.body)).toEqual({ anime: [{
      ids: { anilist: 10 },
      status: 'hold',
      episodes: [{ number: 1 }, { number: 2 }, { number: 3 }],
    }] })
  })

  it('uses the endpoint’s required shows array when removing an anime', async () => {
    mocks.simklFetch.mockResolvedValue(json({ deleted: { shows: 1 } }, 201))
    await expect(pushSimkl({
      kind: 'remove', mediaId: 10, idAniList: 10,
    })).resolves.toEqual({ ok: true })

    const [path, init] = mocks.simklFetch.mock.calls[0]
    expect(path).toBe('/sync/history/remove')
    expect(JSON.parse(init.body)).toEqual({ shows: [{ ids: { anilist: 10 } }] })
  })
})
