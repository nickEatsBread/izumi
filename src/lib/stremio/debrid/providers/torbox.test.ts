import { describe, it, expect } from 'vitest'
import { tbStatus, tbListItem, tbFile } from './torbox'

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
