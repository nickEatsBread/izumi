import { beforeEach, describe, it, expect, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('$lib/net/http', () => ({ invokeNativeHttp: httpFetch }))

import { serveJson, called } from '../../../../test/debrid-http'
import { ocFiles, ocStatus, offcloud } from './offcloud'

const HASH = 'a'.repeat(40)

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
})
