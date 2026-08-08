import { beforeEach, describe, it, expect, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('$lib/net/http', () => ({ invokeNativeHttp: httpFetch }))

import { serveJson, called } from '../../../../test/debrid-http'
import { ocFiles, ocStatus, offcloud } from './offcloud'

const HASH = 'a'.repeat(40)
// Both routes a poll probe can take: history (current API) then the legacy per-request status.
const STATUS_ROUTE = /\/cloud\/(?:history|status)/

describe('ocStatus', () => {
  it('downloaded = ready', () => expect(ocStatus('downloaded')).toEqual({ stage: 'ready', progress: 100, raw: 'downloaded' }))
  it('created/queued = queued', () => {
    expect(ocStatus('created').stage).toBe('queued')
    expect(ocStatus('queued').stage).toBe('queued')
  })
  it('downloading = downloading', () => expect(ocStatus('downloading').stage).toBe('downloading'))
  it('error and canceled both end the poll', () => {
    expect(ocStatus('error').stage).toBe('error')
    expect(ocStatus('canceled').stage).toBe('error')
  })
  it('an unknown status keeps polling rather than failing', () => expect(ocStatus(undefined).stage).toBe('downloading'))
})

describe('ocFiles', () => {
  it('parses the current detailed shape, keeping real sizes for the episode picker', () => {
    const r = ocFiles({ files: [
      { id: 'a', name: 'ep01.mkv', size: 700, path: 'Show S01/ep01.mkv', url: 'https://x.offcloud.com/cloud/download/r/0/ep01.mkv' },
      { id: 'b', name: 'ep02.mkv', size: 800, path: 'Show S01/ep02.mkv', url: 'https://x.offcloud.com/cloud/download/r/1/ep02.mkv' },
    ] })
    expect(r).toEqual([
      { name: 'ep01.mkv', bytes: 700, url: 'https://x.offcloud.com/cloud/download/r/0/ep01.mkv' },
      { name: 'ep02.mkv', bytes: 800, url: 'https://x.offcloud.com/cloud/download/r/1/ep02.mkv' },
    ])
  })
  it('parses the legacy bare-URL array (names decoded, sizes unknown)', () => {
    expect(ocFiles(['https://x.offcloud.com/cloud/download/r/0/Show%20-%2001.mkv'])).toEqual([
      { name: 'Show - 01.mkv', bytes: 0, url: 'https://x.offcloud.com/cloud/download/r/0/Show%20-%2001.mkv' },
    ])
  })
  it('drops entries with no URL', () => {
    expect(ocFiles({ files: [{ name: 'ep01.mkv', size: 1, path: 'ep01.mkv' }] })).toEqual([])
  })
  it('an error envelope yields no files instead of throwing', () => {
    expect(ocFiles({ error: 'NOAUTH' })).toEqual([])
    expect(ocFiles(undefined)).toEqual([])
  })
})

describe('offcloud.resolveHash noAdd', () => {
  beforeEach(() => httpFetch.mockReset())

  it('never posts the magnet to the cloud for a background prefetch', async () => {
    serveJson(httpFetch, [])
    await expect(offcloud.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, '/cloud')).toBe(false)
  })

  it('still adds for a normal (user-initiated) resolve', async () => {
    serveJson(httpFetch, [
      ['/cloud/explore/', { files: [{ name: 'Show_01.mkv', size: 100, url: 'https://cdn.oc/Show_01.mkv' }] }],
      ['/cloud', { requestId: 'RID', status: 'downloaded' }],
    ])
    await expect(offcloud.resolveHash('key', HASH)).resolves.toBe('https://cdn.oc/Show_01.mkv')
  })

  it('rides out a single 5xx from both status routes instead of throwing the download away', async () => {
    // Offcloud probes history first and falls back to the legacy per-request status route, so one
    // bad second is TWO failed calls — it still has to cost only a probe, not the whole resolve.
    vi.useFakeTimers()
    let rounds = 0
    httpFetch.mockImplementation(async (_command: string, args: { url: string }) => {
      const url = String(args?.url)
      if (url.includes('/cloud/explore/')) return { status: 200, body: JSON.stringify({ files: [{ name: 'Show_01.mkv', size: 100, url: 'https://cdn.oc/Show_01.mkv' }] }) }
      if (!STATUS_ROUTE.test(url)) return { status: 200, body: JSON.stringify({ requestId: 'RID' }) }
      if (url.includes('/cloud/history')) rounds++
      return rounds === 1 ? { status: 502, body: '' } : { status: 200, body: JSON.stringify([{ requestId: 'RID', status: 'downloaded' }]) }
    })
    const done = expect(offcloud.resolveHash('key', HASH)).resolves.toBe('https://cdn.oc/Show_01.mkv')
    await vi.advanceTimersByTimeAsync(5000)
    await done
    vi.useRealTimers()
  })

  it('gives up on a sustained 5xx well short of the poll deadline', async () => {
    vi.useFakeTimers()
    httpFetch.mockImplementation(async (_command: string, args: { url: string }) => (
      STATUS_ROUTE.test(String(args?.url))
        ? { status: 502, body: '' }
        : { status: 200, body: JSON.stringify({ requestId: 'RID' }) }
    ))
    const onStatus = vi.fn()
    const done = expect(offcloud.resolveHash('key', HASH, { onStatus })).rejects.toThrow(/502/)
    // Settles inside a minute — the whole point is not reaching the 600s deadline.
    await vi.advanceTimersByTimeAsync(60_000)
    await done
    // Never reported a stage either: every probe threw, so the caching overlay is never raised.
    expect(onStatus).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('a 401 during the poll fails immediately with the access-denied message', async () => {
    let statusCalls = 0
    httpFetch.mockImplementation(async (_command: string, args: { url: string }) => {
      if (!STATUS_ROUTE.test(String(args?.url))) return { status: 200, body: JSON.stringify({ requestId: 'RID' }) }
      statusCalls++
      return { status: 401, body: JSON.stringify({ error: 'NOAUTH' }) }
    })
    await expect(offcloud.resolveHash('key', HASH)).rejects.toThrow(/access denied/)
    // One history + one legacy-status attempt and done: a wrong key is not going to become right.
    expect(statusCalls).toBe(2)
  })
})
