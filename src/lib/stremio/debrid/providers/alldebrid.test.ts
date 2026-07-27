import { beforeEach, describe, it, expect, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: httpFetch }))

import { serveJson, called } from '../../../../test/debrid-http'
import { adStatus, adListItem, adFiles, adFindReady, alldebrid } from './alldebrid'

const HASH = 'a'.repeat(40)

describe('adStatus', () => {
  it('statusCode 4 = ready', () => {
    expect(adStatus({ statusCode: 4, status: 'Ready' })).toEqual({ stage: 'ready', progress: 100, raw: 'Ready' })
  })
  it('statusCode >= 5 = error', () => {
    expect(adStatus({ statusCode: 5, status: 'Upload fail' }).stage).toBe('error')
  })
  it('downloading maps bytes -> progress + seeders + speed', () => {
    const r = adStatus({ statusCode: 1, status: 'Downloading', downloaded: 500, size: 1000, seeders: 12, downloadSpeed: 2048 })
    expect(r.stage).toBe('downloading')
    expect(r.progress).toBe(50)
    expect(r.seeders).toBe(12)
    expect(r.speed).toBe(2048)
    expect(r.downloaded).toBe(500)
    expect(r.total).toBe(1000)
  })
  it('statusCode 0 = queued', () => {
    expect(adStatus({ statusCode: 0, status: 'In queue' }).stage).toBe('queued')
  })
})

describe('adListItem', () => {
  it('maps a ready magnet (statusCode 4)', () => {
    const it_ = adListItem({ id: 7, filename: 'Anime S01', size: 200, status: 'Ready', statusCode: 4, hash: 'BEEF', uploadDate: 1000 })
    expect(it_).toMatchObject({ id: '7', name: 'Anime S01', size: 200, status: 'ready', hash: 'beef', addedAt: 1000000 })
  })
  it('maps a downloading magnet', () => {
    expect(adListItem({ id: 1, filename: 'f', size: 10, status: 'DL', statusCode: 1, downloaded: 5 }).status).toBe('downloading')
  })
})

describe('adFiles', () => {
  it('flattens the nested tree and flags videos', () => {
    const files = adFiles([{ n: 'folder', e: [{ n: 'ep01.mkv', s: 50, l: 'LINK1' }] }, { n: 'sample.mkv', s: 1, l: 'LINK2' }])
    expect(files).toEqual([
      { id: 'LINK1', name: 'ep01.mkv', size: 50, playable: true },
      { id: 'LINK2', name: 'sample.mkv', size: 1, playable: false },
    ])
  })
})

describe('adFindReady', () => {
  it('finds a ready magnet case-insensitively', () => {
    expect(adFindReady([{ id: 42, hash: HASH.toUpperCase(), statusCode: 4 }], HASH)).toBe('42')
  })
  it('accepts the bare-object shape the status call can answer with', () => {
    expect(adFindReady({ id: 7, hash: HASH, statusCode: 4 }, HASH)).toBe('7')
  })
  it('ignores a magnet that is still downloading', () => {
    expect(adFindReady([{ id: 42, hash: HASH, statusCode: 1 }], HASH)).toBeUndefined()
  })
  it('ignores another release', () => {
    expect(adFindReady([{ id: 42, hash: 'b'.repeat(40), statusCode: 4 }], HASH)).toBeUndefined()
  })
  it('tolerates a missing/empty list', () => {
    expect(adFindReady(undefined, HASH)).toBeUndefined()
  })
})

describe('alldebrid.resolveHash noAdd', () => {
  beforeEach(() => httpFetch.mockReset())

  it('never uploads the magnet when the hash is not already on the account', async () => {
    serveJson(httpFetch, [['/v4.1/magnet/status', { status: 'success', data: { magnets: [] } }]])
    await expect(alldebrid.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, '/v4/magnet/upload')).toBe(false)
  })

  it('never uploads the magnet when the account list itself fails', async () => {
    serveJson(httpFetch, [])
    await expect(alldebrid.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, '/v4/magnet/upload')).toBe(false)
  })

  it('reuses a ready magnet already on the account', async () => {
    serveJson(httpFetch, [
      ['/v4.1/magnet/status', { status: 'success', data: { magnets: [{ id: 42, hash: HASH.toUpperCase(), statusCode: 4, status: 'Ready' }] } }],
      ['/v4/magnet/files', { status: 'success', data: { magnets: [{ files: [{ n: 'Show_01.mkv', s: 100, l: 'FILELINK' }] }] } }],
      ['/v4/link/unlock', { status: 'success', data: { link: 'https://cdn.alldebrid/Show_01.mkv' } }],
    ])
    await expect(alldebrid.resolveHash('key', HASH, { noAdd: true })).resolves.toBe('https://cdn.alldebrid/Show_01.mkv')
    expect(called(httpFetch, '/v4/magnet/upload')).toBe(false)
  })

  it('still uploads for a normal (user-initiated) resolve', async () => {
    serveJson(httpFetch, [
      ['/v4/magnet/upload', { status: 'success', data: { magnets: [{ id: 42, hash: HASH }] } }],
      ['/v4.1/magnet/status', { status: 'success', data: { magnets: [{ id: 42, hash: HASH, statusCode: 4, status: 'Ready' }] } }],
      ['/v4/magnet/files', { status: 'success', data: { magnets: [{ files: [{ n: 'Show_01.mkv', s: 100, l: 'FILELINK' }] }] } }],
      ['/v4/link/unlock', { status: 'success', data: { link: 'https://cdn.alldebrid/Show_01.mkv' } }],
    ])
    await expect(alldebrid.resolveHash('key', HASH)).resolves.toBe('https://cdn.alldebrid/Show_01.mkv')
    expect(called(httpFetch, '/v4/magnet/upload')).toBe(true)
  })
})
