import { describe, it, expect } from 'vitest'
import { dlStatus } from './debridlink'

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
