import { describe, it, expect } from 'vitest'
import { rdStatus } from './realdebrid'

describe('rdStatus', () => {
  it('maps a finished torrent to ready', () => {
    expect(rdStatus({ status: 'downloaded', progress: 100 })).toEqual({ stage: 'ready', progress: 100, raw: 'downloaded' })
  })
  it('maps an error status', () => {
    expect(rdStatus({ status: 'virus' }).stage).toBe('error')
  })
  it('maps downloading with seeders + speed', () => {
    const r = rdStatus({ status: 'downloading', progress: 42, seeders: 30, speed: 1048576, bytes: 2000 })
    expect(r).toEqual({ stage: 'downloading', progress: 42, seeders: 30, speed: 1048576, total: 2000, raw: 'downloading' })
  })
  it('maps queued/waiting states', () => {
    expect(rdStatus({ status: 'queued' }).stage).toBe('queued')
    expect(rdStatus({ status: 'waiting_files_selection' }).stage).toBe('queued')
  })
})
