import { describe, it, expect } from 'vitest'
import { toProviderMedia, atorrentToResult } from './torrentProvider'
import type { Media } from '$lib/anilist/types'

const media = {
  id: 5, idMal: 9, status: 'FINISHED', format: 'TV',
  title: { romaji: 'Romaji Title', english: 'English Title', userPreferred: 'Romaji Title' },
  episodes: 12, synonyms: ['Alt'], isAdult: false, startDate: { year: 2024 },
} as unknown as Media

describe('toProviderMedia', () => {
  it('maps every field the SDK expects', () => {
    expect(toProviderMedia(media)).toEqual({
      id: 5, idMal: 9, status: 'FINISHED', format: 'TV',
      englishTitle: 'English Title', romajiTitle: 'Romaji Title', episodeCount: 12,
      synonyms: ['Alt'], isAdult: false, startDate: { year: 2024 },
    })
  })
  it('applies defaults when fields are missing', () => {
    const m = { id: 1, title: {} } as unknown as Media
    const p = toProviderMedia(m)
    expect(p).toMatchObject({ status: 'NOT_YET_RELEASED', format: 'TV', romajiTitle: '', episodeCount: -1, synonyms: [], isAdult: false })
  })
})

describe('atorrentToResult', () => {
  const H = 'a'.repeat(40)
  it('maps an inline-hash torrent, preferring the magnet link', () => {
    const r = atorrentToResult({ name: 'Rel', size: 100, seeders: 5, magnetLink: 'magnet:?x', infoHash: H.toUpperCase(), isBatch: false }, H.toUpperCase())
    expect(r).toEqual({ title: 'Rel', link: 'magnet:?x', hash: H, seeders: 5, leechers: undefined, downloads: undefined, size: 100, type: 'best' })
  })
  it('tags batches', () => {
    expect(atorrentToResult({ name: 'Pack', isBatch: true }, H)?.type).toBe('batch')
  })
  it('drops a torrent with no valid 40-hex infohash', () => {
    expect(atorrentToResult({ name: 'x' }, '')).toBeNull()
    expect(atorrentToResult({ name: 'x' }, 'nothex')).toBeNull()
  })
})
