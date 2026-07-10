import { describe, it, expect } from 'vitest'
import { tbStatus } from './torbox'

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
