import { beforeEach, describe, it, expect, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: httpFetch }))

import { serveJson, called } from '../../../../test/debrid-http'
import { tbStatus, tbListItem, tbFile, tbFindReady, torbox } from './torbox'

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
})
