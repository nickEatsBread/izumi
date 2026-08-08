import { beforeEach, describe, it, expect, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('$lib/net/http', () => ({ invokeNativeHttp: httpFetch }))

import { serveJson, called } from '../../../../test/debrid-http'
import { tbStatus, tbListItem, tbFile, tbFindReady, tbCacheMap, torbox } from './torbox'

const HASH = 'c'.repeat(40)

describe('tbStatus', () => {
  it('download_finished = ready', () => {
    expect(tbStatus({ download_finished: true }).stage).toBe('ready')
  })
  it('download_present = ready', () => {
    expect(tbStatus({ download_present: true }).stage).toBe('ready')
  })
  it('error state', () => {
    expect(tbStatus({ download_state: 'error' }).stage).toBe('error')
  })
  it('active downloading maps progress/speed/seeds/size', () => {
    const r = tbStatus({ active: true, progress: 0.25, download_speed: 4096, seeds: 8, size: 4000, download_state: 'downloading' })
    expect(r.stage).toBe('downloading')
    expect(r.progress).toBe(25)
    expect(r.speed).toBe(4096)
    expect(r.seeders).toBe(8)
    expect(r.total).toBe(4000)
  })
  it('inactive = queued', () => {
    expect(tbStatus({ active: false, progress: 0 }).stage).toBe('queued')
  })
})

describe('tbListItem', () => {
  it('maps a finished torrent to ready with fileCount', () => {
    const it_ = tbListItem({ id: 9, name: 'Show', hash: 'CAFE', size: 300, files: [{ id: 0 }, { id: 1 }], download_finished: true, created_at: '2026-07-02T00:00:00.000Z' })
    expect(it_).toMatchObject({ id: '9', name: 'Show', size: 300, status: 'ready', hash: 'cafe', fileCount: 2 })
    expect(it_.addedAt).toBe(Date.parse('2026-07-02T00:00:00.000Z'))
  })
})

describe('tbFile', () => {
  it('prefers short_name and flags videos', () => {
    expect(tbFile({ id: 2, short_name: 'ep02.mkv', name: 'long/ep02.mkv', size: 40 })).toEqual({ id: '2', name: 'ep02.mkv', size: 40, playable: true })
  })
})

describe('tbFindReady', () => {
  it('finds a finished torrent case-insensitively', () => {
    expect(tbFindReady([{ id: 9, hash: HASH.toUpperCase(), download_finished: true }], HASH)).toBe('9')
  })
  it('accepts the bare-object shape the by-id call answers with', () => {
    expect(tbFindReady({ id: 9, hash: HASH, download_present: true }, HASH)).toBe('9')
  })
  it('ignores a torrent that is still downloading', () => {
    expect(tbFindReady([{ id: 9, hash: HASH, active: true, progress: 0.5 }], HASH)).toBeUndefined()
  })
  it('ignores another release', () => {
    expect(tbFindReady([{ id: 9, hash: 'd'.repeat(40), download_finished: true }], HASH)).toBeUndefined()
  })
})

describe('torbox.resolveHash noAdd', () => {
  beforeEach(() => httpFetch.mockReset())

  it('never creates the torrent when the hash is not already on the account', async () => {
    serveJson(httpFetch, [['/torrents/mylist', { success: true, data: [] }]])
    await expect(torbox.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, '/torrents/createtorrent')).toBe(false)
  })

  it('never creates the torrent when the account list itself fails', async () => {
    serveJson(httpFetch, [])
    await expect(torbox.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, '/torrents/createtorrent')).toBe(false)
  })

  it('reuses a finished torrent already on the account', async () => {
    serveJson(httpFetch, [
      ['/torrents/requestdl', { success: true, data: 'https://cdn.torbox/Show_01.mkv' }],
      ['/torrents/mylist', { success: true, data: [{ id: 9, hash: HASH.toUpperCase(), download_finished: true, files: [{ id: 0, name: 'Show_01.mkv', size: 100 }] }] }],
    ])
    await expect(torbox.resolveHash('key', HASH, { noAdd: true })).resolves.toBe('https://cdn.torbox/Show_01.mkv')
    expect(called(httpFetch, '/torrents/createtorrent')).toBe(false)
  })

  it('still creates the torrent for a normal (user-initiated) resolve', async () => {
    serveJson(httpFetch, [
      ['/torrents/createtorrent', { success: true, data: { torrent_id: 9 } }],
      ['/torrents/requestdl', { success: true, data: 'https://cdn.torbox/Show_01.mkv' }],
      ['/torrents/mylist', { success: true, data: [{ id: 9, hash: HASH, download_finished: true, files: [{ id: 0, name: 'Show_01.mkv', size: 100 }] }] }],
    ])
    await expect(torbox.resolveHash('key', HASH)).resolves.toBe('https://cdn.torbox/Show_01.mkv')
    expect(called(httpFetch, '/torrents/createtorrent')).toBe(true)
  })

  it('rides out a single 5xx during the poll instead of throwing the download away', async () => {
    // The resolve may be minutes into an uncached download by the time a gateway hiccups; one 502
    // must cost a probe, not the whole thing.
    vi.useFakeTimers()
    let probes = 0
    httpFetch.mockImplementation(async (_command: string, args: { url: string }) => {
      const url = String(args?.url)
      if (url.includes('/torrents/createtorrent')) return { status: 200, body: JSON.stringify({ success: true, data: { torrent_id: 9 } }) }
      if (url.includes('/torrents/requestdl')) return { status: 200, body: JSON.stringify({ success: true, data: 'https://cdn.torbox/Show_01.mkv' }) }
      if (++probes === 1) return { status: 502, body: '' }
      return { status: 200, body: JSON.stringify({ success: true, data: [{ id: 9, hash: HASH, download_finished: true, files: [{ id: 0, name: 'Show_01.mkv', size: 100 }] }] }) }
    })
    const done = expect(torbox.resolveHash('key', HASH)).resolves.toBe('https://cdn.torbox/Show_01.mkv')
    await vi.advanceTimersByTimeAsync(5000)
    await done
    vi.useRealTimers()
  })

  it('gives up on a sustained 5xx well short of the poll deadline', async () => {
    vi.useFakeTimers()
    httpFetch.mockImplementation(async (_command: string, args: { url: string }) => (
      String(args?.url).includes('/torrents/mylist')
        ? { status: 502, body: '' }
        : { status: 200, body: JSON.stringify({ success: true, data: { torrent_id: 9 } }) }
    ))
    const onStatus = vi.fn()
    const done = expect(torbox.resolveHash('key', HASH, { onStatus })).rejects.toThrow(/502/)
    // Settles inside a minute — the whole point is not reaching the 600s deadline.
    await vi.advanceTimersByTimeAsync(60_000)
    await done
    // Never reported a stage either: every probe threw, so the caching overlay is never raised.
    expect(onStatus).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('a 401 during the poll fails immediately with the access-denied message', async () => {
    let probes = 0
    httpFetch.mockImplementation(async (_command: string, args: { url: string }) => {
      if (!String(args?.url).includes('/torrents/mylist')) return { status: 200, body: JSON.stringify({ success: true, data: { torrent_id: 9 } }) }
      probes++
      return { status: 401, body: '' }
    })
    await expect(torbox.resolveHash('key', HASH)).rejects.toThrow(/access denied/)
    expect(probes).toBe(1) // a wrong key is not going to become right — no retry run
  })
})

describe('tbCacheMap', () => {
  const asked = ['aaa', 'bbb', 'ccc']

  it('marks returned hashes cached and asked-but-absent hashes uncached', () => {
    const m = tbCacheMap({ aaa: { name: 'x' } }, asked)
    expect(m.get('aaa')).toBe('cached')
    expect(m.get('bbb')).toBe('uncached')
    expect(m.get('ccc')).toBe('uncached')
  })
  it('lower-cases hashes on both sides', () => {
    const m = tbCacheMap({ AAA: { name: 'x' } }, ['AAA'])
    expect(m.get('aaa')).toBe('cached')
  })
  it('returns an empty map when data is not an object', () => {
    expect(tbCacheMap(null, asked).size).toBe(0)
    expect(tbCacheMap([], asked).size).toBe(0)
    expect(tbCacheMap('nope', asked).size).toBe(0)
  })
  it('ignores hashes that were never asked about', () => {
    const m = tbCacheMap({ zzz: { name: 'x' } }, asked)
    expect(m.has('zzz')).toBe(false)
    expect(m.get('aaa')).toBe('uncached')
  })
})
