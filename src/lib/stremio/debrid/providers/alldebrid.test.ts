import { describe, it, expect } from 'vitest'
import { adStatus, adListItem, adFiles } from './alldebrid'

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
