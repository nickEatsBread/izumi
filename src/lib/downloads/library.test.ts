import { describe, it, expect } from 'vitest'
import { groupDownloads, seriesTitle } from './library'
import type { DownloadItem } from './state'
import type { Media } from '$lib/anilist/types'

const item = (p: Partial<DownloadItem>): DownloadItem => ({
  id: `${p.mediaId}:${p.episode}`, mediaId: 1, episode: 1, title: 'X — E1',
  bytes: 0, downloaded: 0, status: 'done', addedAt: 0, ...p,
})

describe('seriesTitle', () => {
  it('strips the "— E<n>" episode suffix', () => {
    expect(seriesTitle('Frieren — E12')).toBe('Frieren')
    expect(seriesTitle('Show - E3')).toBe('Show')
    expect(seriesTitle('No Suffix Here')).toBe('No Suffix Here')
  })
})

describe('groupDownloads', () => {
  it('groups done items by mediaId and counts episodes', () => {
    const dl = {
      '1:1': item({ mediaId: 1, episode: 1 }),
      '1:2': item({ mediaId: 1, episode: 2 }),
      '2:1': item({ mediaId: 2, episode: 1, title: 'Other — E1' }),
    }
    const out = groupDownloads(dl, {})
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ mediaId: 1, episodeCount: 2 }) // most episodes first
    expect(out[1]).toMatchObject({ mediaId: 2, episodeCount: 1 })
  })

  it('ignores non-done items', () => {
    const dl = {
      '1:1': item({ mediaId: 1, episode: 1, status: 'downloading' }),
      '1:2': item({ mediaId: 1, episode: 2, status: 'queued' }),
    }
    expect(groupDownloads(dl, {})).toHaveLength(0)
  })

  it('resolves title/poster from DownloadItem when downloadedMedia is absent (source of truth)', () => {
    const dl = { '5:1': item({ mediaId: 5, episode: 1, title: 'Bocchi — E1', poster: 'p.jpg' }) }
    const out = groupDownloads(dl, {})
    expect(out[0].title).toBe('Bocchi')
    expect(out[0].poster).toBe('p.jpg')
  })

  it('prefers the downloadedMedia snapshot for title/poster when present', () => {
    const snap = {
      id: 5, title: { userPreferred: 'Bocchi the Rock!' }, coverImage: { extraLarge: 'cover.jpg' },
    } as Media
    const dl = { '5:1': item({ mediaId: 5, episode: 1, title: 'Bocchi — E1', poster: 'p.jpg' }) }
    const out = groupDownloads(dl, { 5: snap })
    expect(out[0].title).toBe('Bocchi the Rock!')
    expect(out[0].poster).toBe('cover.jpg')
    expect(out[0].media).toBe(snap)
  })
})
