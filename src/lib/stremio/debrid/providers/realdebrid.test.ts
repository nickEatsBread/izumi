import { describe, it, expect } from 'vitest'
import { rdStatus, rdListItem, rdFile } from './realdebrid'

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

describe('rdListItem', () => {
  it('maps a downloaded torrent to a ready DebridItem', () => {
    const it_ = rdListItem({ id: 'AB', filename: 'Show S01', hash: 'DEAD', bytes: 100, progress: 100, status: 'downloaded', added: '2026-07-01T00:00:00.000Z' })
    expect(it_).toMatchObject({ id: 'AB', name: 'Show S01', size: 100, status: 'ready', hash: 'dead' })
    expect(it_.addedAt).toBe(Date.parse('2026-07-01T00:00:00.000Z'))
  })
  it('maps a downloading torrent', () => {
    expect(rdListItem({ id: 'X', filename: 'f', hash: 'H', bytes: 1, progress: 40, status: 'downloading' }).status).toBe('downloading')
  })
})

describe('rdFile', () => {
  it('takes the basename and flags a video as playable', () => {
    expect(rdFile({ id: 3, path: '/Season 1/ep01.mkv', bytes: 50 })).toEqual({ id: '3', name: 'ep01.mkv', size: 50, playable: true })
  })
  it('flags a non-video / sample as not playable', () => {
    expect(rdFile({ id: 4, path: 'sample.mkv', bytes: 1 }).playable).toBe(false)
    expect(rdFile({ id: 5, path: 'readme.txt', bytes: 1 }).playable).toBe(false)
  })
})
