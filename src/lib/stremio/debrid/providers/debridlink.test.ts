import { beforeEach, describe, it, expect, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('$lib/net/http', () => ({ invokeNativeHttp: httpFetch }))

import { serveJson, called } from '../../../../test/debrid-http'
import { dlStatus, dlListItem, dlFile, dlFindReady, debridlink } from './debridlink'

const HASH = 'e'.repeat(40)

describe('dlStatus', () => {
  it('100% = ready', () => {
    expect(dlStatus({ downloadPercent: 100 })).toEqual({ stage: 'ready', progress: 100 })
  })
  it('partial downloadPercent = downloading with total/downloaded', () => {
    const r = dlStatus({ downloadPercent: 60, totalSize: 1000, downloaded: 600, peersConnected: 5 })
    expect(r.stage).toBe('downloading')
    expect(r.progress).toBe(60)
    expect(r.total).toBe(1000)
    expect(r.downloaded).toBe(600)
    expect(r.seeders).toBe(5)
  })
  it('0% = queued', () => {
    expect(dlStatus({ downloadPercent: 0 }).stage).toBe('queued')
  })
  it('missing entry = queued', () => {
    expect(dlStatus(undefined).stage).toBe('queued')
  })
})

describe('dlListItem', () => {
  it('maps a finished seedbox item', () => {
    const it_ = dlListItem({ id: 'S1', name: 'Batch', totalSize: 500, downloadPercent: 100, hashString: 'FADE', files: [{}, {}], created: 1000 })
    expect(it_).toMatchObject({ id: 'S1', name: 'Batch', size: 500, status: 'ready', hash: 'fade', fileCount: 2, addedAt: 1000000 })
  })
})

describe('dlFile', () => {
  it('uses downloadUrl as the id and flags videos', () => {
    expect(dlFile({ name: 'ep01.mkv', size: 70, downloadUrl: 'https://dl/ep01.mkv' })).toEqual({ id: 'https://dl/ep01.mkv', name: 'ep01.mkv', size: 70, playable: true })
  })
})

describe('dlFindReady', () => {
  it('finds a complete seedbox entry case-insensitively', () => {
    expect(dlFindReady([{ id: 'S1', hashString: HASH.toUpperCase(), downloadPercent: 100 }], HASH)?.id).toBe('S1')
  })
  it('ignores a partial entry', () => {
    expect(dlFindReady([{ id: 'S1', hashString: HASH, downloadPercent: 60 }], HASH)).toBeUndefined()
  })
  it('ignores another release', () => {
    expect(dlFindReady([{ id: 'S1', hashString: 'f'.repeat(40), downloadPercent: 100 }], HASH)).toBeUndefined()
  })
  it('tolerates a missing list', () => {
    expect(dlFindReady(undefined, HASH)).toBeUndefined()
  })
})

describe('debridlink.resolveHash noAdd', () => {
  beforeEach(() => httpFetch.mockReset())

  it('never adds to the seedbox when the hash is not already on the account', async () => {
    serveJson(httpFetch, [['/seedbox/list', { success: true, value: [] }]])
    await expect(debridlink.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, '/seedbox/add')).toBe(false)
  })

  it('never adds to the seedbox when the list itself fails', async () => {
    serveJson(httpFetch, [])
    await expect(debridlink.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, '/seedbox/add')).toBe(false)
  })

  it('reuses a complete seedbox entry already on the account', async () => {
    const entry = { id: 'S1', hashString: HASH.toUpperCase(), downloadPercent: 100, files: [{ name: 'Show_01.mkv', size: 100, downloadUrl: 'https://dl.debrid-link/Show_01.mkv' }] }
    serveJson(httpFetch, [['/seedbox/list', { success: true, value: [entry] }]])
    await expect(debridlink.resolveHash('key', HASH, { noAdd: true })).resolves.toBe('https://dl.debrid-link/Show_01.mkv')
    expect(called(httpFetch, '/seedbox/add')).toBe(false)
  })

  it('still adds for a normal (user-initiated) resolve', async () => {
    const entry = { id: 'S1', hashString: HASH, downloadPercent: 100, files: [{ name: 'Show_01.mkv', size: 100, downloadUrl: 'https://dl.debrid-link/Show_01.mkv' }] }
    serveJson(httpFetch, [
      ['/seedbox/add', { success: true, value: { id: 'S1' } }],
      ['/seedbox/list', { success: true, value: [entry] }],
    ])
    await expect(debridlink.resolveHash('key', HASH)).resolves.toBe('https://dl.debrid-link/Show_01.mkv')
    expect(called(httpFetch, '/seedbox/add')).toBe(true)
  })

  it('rides out a single 5xx during the poll instead of throwing the download away', async () => {
    // The resolve may be minutes into an uncached download by the time a gateway hiccups; one 502
    // must cost a probe, not the whole thing.
    vi.useFakeTimers()
    const entry = { id: 'S1', hashString: HASH, downloadPercent: 100, files: [{ name: 'Show_01.mkv', size: 100, downloadUrl: 'https://dl.debrid-link/Show_01.mkv' }] }
    let probes = 0
    httpFetch.mockImplementation(async (_command: string, args: { url: string }) => {
      if (!String(args?.url).includes('/seedbox/list')) return { status: 200, body: JSON.stringify({ success: true, value: { id: 'S1' } }) }
      if (++probes === 1) return { status: 502, body: '' }
      return { status: 200, body: JSON.stringify({ success: true, value: [entry] }) }
    })
    const done = expect(debridlink.resolveHash('key', HASH)).resolves.toBe('https://dl.debrid-link/Show_01.mkv')
    await vi.advanceTimersByTimeAsync(5000)
    await done
    vi.useRealTimers()
  })

  it('gives up on a sustained 5xx well short of the poll deadline', async () => {
    vi.useFakeTimers()
    httpFetch.mockImplementation(async (_command: string, args: { url: string }) => (
      String(args?.url).includes('/seedbox/list')
        ? { status: 502, body: '' }
        : { status: 200, body: JSON.stringify({ success: true, value: { id: 'S1' } }) }
    ))
    const onStatus = vi.fn()
    const done = expect(debridlink.resolveHash('key', HASH, { onStatus })).rejects.toThrow(/502/)
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
      if (!String(args?.url).includes('/seedbox/list')) return { status: 200, body: JSON.stringify({ success: true, value: { id: 'S1' } }) }
      probes++
      return { status: 401, body: '' }
    })
    await expect(debridlink.resolveHash('key', HASH)).rejects.toThrow(/access denied/)
    expect(probes).toBe(1) // a wrong key is not going to become right — no retry run
  })
})
