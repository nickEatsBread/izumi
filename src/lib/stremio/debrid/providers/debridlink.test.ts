import { describe, it, expect } from 'vitest'
import { dlStatus, dlListItem, dlFile } from './debridlink'

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
