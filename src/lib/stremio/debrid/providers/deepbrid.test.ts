import { beforeEach, describe, it, expect, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: httpFetch }))

import { serveJson, called } from '../../../../test/debrid-http'
import { dbPick, dbSpeed, dbStatus, deepbrid } from './deepbrid'

const HASH = 'a'.repeat(40)

// Shapes below are the ones in the first-party docs (deepbrid.com/api-docs).
const ONE = { error: 0, message: 'OK', id: '14648', filename: 'show.s01e01.mkv', progress: 100, seeders: 12, speed: '0.00 MB/s', links: ['https://www.deepbrid.com/mytorrents?torrent=14648'] }

describe('dbPick', () => {
  it('single-torrent response (id given) is itself the torrent', () => {
    expect(dbPick(ONE, '14648')?.filename).toBe('show.s01e01.mkv')
  })
  it('no-id response is an ORDINAL-keyed map, not a torrent — pick by id', () => {
    const all = { 1: { ...ONE, id: '14648' }, 2: { ...ONE, id: '99', filename: 'other.mkv' } }
    expect(dbPick(all, '99')?.filename).toBe('other.mkv')
  })
  it('without an id, the highest id wins (the one we just added)', () => {
    const all = { 1: { ...ONE, id: '100' }, 2: { ...ONE, id: '2000', filename: 'newest.mkv' }, 3: { ...ONE, id: '7' } }
    expect(dbPick(all)?.filename).toBe('newest.mkv')
  })
  it('a wanted id that is absent from the map is undefined, not a wrong torrent', () => {
    expect(dbPick({ 1: { ...ONE, id: '1' } }, '404')).toBeUndefined()
  })
  it('legacy {torrent:{…}} nesting still works', () => {
    expect(dbPick({ torrent: ONE })?.id).toBe('14648')
  })
  it('junk is undefined', () => {
    expect(dbPick(undefined)).toBeUndefined()
    expect(dbPick({ error: 2, message: "You aren't a premium user" })).toBeUndefined()
  })
})

describe('dbSpeed', () => {
  it('parses the documented "N.NN MB/s" string to bytes/sec', () => expect(dbSpeed('12.50 MB/s')).toBe(12_500_000))
  it('handles kB/s and a bare B/s', () => {
    expect(dbSpeed('64 kB/s')).toBe(64_000)
    expect(dbSpeed('500 B/s')).toBe(500)
  })
  it('0.00 MB/s and unparseable values are undefined', () => {
    expect(dbSpeed('0.00 MB/s')).toBeUndefined()
    expect(dbSpeed('fast')).toBeUndefined()
    expect(dbSpeed(undefined)).toBeUndefined()
  })
  it('a plain number passes through', () => expect(dbSpeed(2048)).toBe(2048))
})

describe('dbStatus', () => {
  it('100% = ready', () => expect(dbStatus(ONE)).toEqual({ stage: 'ready', progress: 100 }))
  it('partial progress reports seeders/speed/filename', () => {
    const r = dbStatus({ ...ONE, progress: 30, speed: '5.00 MB/s' })
    expect(r).toEqual({ stage: 'downloading', progress: 30, seeders: 12, speed: 5_000_000, filename: 'show.s01e01.mkv' })
  })
  it('0% = queued', () => expect(dbStatus({ ...ONE, progress: 0 }).stage).toBe('queued'))
  it('a missing torrent is queued, not a crash', () => expect(dbStatus(undefined).stage).toBe('queued'))
})

describe('deepbrid.resolveHash noAdd', () => {
  beforeEach(() => httpFetch.mockReset())

  it('never adds the torrent for a background prefetch', async () => {
    serveJson(httpFetch, [])
    await expect(deepbrid.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, '/torrents/add')).toBe(false)
  })
})
