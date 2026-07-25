import { describe, it, expect } from 'vitest'
import { rdStatus, rdListItem, rdFile, rdSelectFileIds } from './realdebrid'

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

const MB = 1024 * 1024

describe('rdSelectFileIds', () => {
  it('selects only the video ids so RD is not asked to pack the torrent', () => {
    const files = [
      { id: 1, path: 'ENG/Show_01_[rerip][85EDD0D6].eng_HH.ass', bytes: 9_657 },
      { id: 2, path: 'CHI/Show_01_[rerip][85EDD0D6].chi_Maho.sub.ass', bytes: 13_632 },
      { id: 3, path: 'Show_01_[rerip][85EDD0D6].mkv', bytes: 116 * MB },
      { id: 4, path: 'Show_02_[rerip][0460306D].mkv', bytes: 142 * MB },
    ]
    expect(rdSelectFileIds(files)).toBe('3,4')
  })

  it('drops samples and extras', () => {
    const files = [
      { id: 1, path: 'sample.mkv', bytes: 20 * MB },
      { id: 2, path: 'Show_01.mkv', bytes: 100 * MB },
    ]
    expect(rdSelectFileIds(files)).toBe('2')
  })

  it('drops videos under the 5 MB floor', () => {
    const files = [
      { id: 1, path: 'trailerclip.mkv', bytes: 2 * MB },
      { id: 2, path: 'Show_01.mkv', bytes: 100 * MB },
    ]
    expect(rdSelectFileIds(files)).toBe('2')
  })

  it('selects every file when the torrent carries no usable video', () => {
    const files = [
      { id: 7, path: 'readme.txt', bytes: 10 },
      { id: 8, path: 'cover.jpg', bytes: 20 },
    ]
    expect(rdSelectFileIds(files)).toBe('7,8')
  })

  it('falls back to the all keyword when there is nothing to name', () => {
    expect(rdSelectFileIds([])).toBe('all')
  })
})
