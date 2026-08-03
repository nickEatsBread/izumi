import { beforeEach, describe, it, expect, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('$lib/net/http', () => ({ invokeNativeHttp: httpFetch }))

import { serveJson, called } from '../../../../test/debrid-http'
import { mdStatus, megadebrid } from './megadebrid'

const HASH = 'a'.repeat(40)

describe('mdStatus', () => {
  it('ub_link is the ready signal, whatever the status text says', () => {
    expect(mdStatus({ status: 'terminé', ub_link: 'https://dl/ep01.mkv' })).toEqual({
      stage: 'ready', progress: 100, raw: 'terminé',
    })
  })
  it('100% with no link yet stays downloading so the poll waits for the link', () => {
    const r = mdStatus({ status: 'downloading', progress: 100 })
    expect(r.stage).toBe('downloading')
    expect(r.progress).toBe(100)
  })
  it('maps the documented detail fields (progress/speed/peers/size/name)', () => {
    const r = mdStatus({ name: 'Show 01.mkv', size: 1000, status: 'downloading', progress: 42, speed: 2048, peers: 7 })
    expect(r).toEqual({
      stage: 'downloading', progress: 42, speed: 2048, seeders: 7, total: 1000,
      filename: 'Show 01.mkv', raw: 'downloading',
    })
  })
  it('parses string numerics (the API quotes some of them)', () => {
    const r = mdStatus({ status: 'downloading', progress: '55', speed: '1024' })
    expect(r.progress).toBe(55)
    expect(r.speed).toBe(1024)
  })
  it('0% = queued', () => {
    expect(mdStatus({ status: 'in queue', progress: 0 }).stage).toBe('queued')
  })
  it('an error status is an error stage', () => {
    expect(mdStatus({ status: 'error' }).stage).toBe('error')
    expect(mdStatus({ status: 'download failed' }).stage).toBe('error')
  })
  it('a missing torrent is queued, not a crash', () => {
    expect(mdStatus(undefined).stage).toBe('queued')
  })
})

describe('megadebrid.resolveHash noAdd', () => {
  beforeEach(() => httpFetch.mockReset())

  it('never uploads the torrent for a background prefetch', async () => {
    serveJson(httpFetch, [['action=connectUser', { response_code: 'ok', token: 'TOKEN' }]])
    await expect(megadebrid.resolveHash('user:pass', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, 'action=uploadTorrent')).toBe(false)
  })

  it('declines before spending a login round-trip', async () => {
    serveJson(httpFetch, [])
    await expect(megadebrid.resolveHash('user:pass', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it('still uploads for a normal (user-initiated) resolve', async () => {
    serveJson(httpFetch, [
      ['action=connectUser', { response_code: 'ok', token: 'TOKEN' }],
      ['action=uploadTorrent', { response_code: 'ok', newTorrent: { hash: HASH } }],
      ['action=getTorrent', { response_code: 'ok', status: { status: 'ready', ub_link: 'https://cdn.md/ep01.mkv' } }],
    ])
    await expect(megadebrid.resolveHash('user:pass', HASH)).resolves.toBe('https://cdn.md/ep01.mkv')
  })
})
