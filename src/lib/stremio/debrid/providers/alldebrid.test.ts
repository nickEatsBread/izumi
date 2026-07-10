import { describe, it, expect } from 'vitest'
import { adStatus } from './alldebrid'

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
