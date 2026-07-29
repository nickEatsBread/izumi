import { describe, it, expect } from 'vitest'
import { flattenEntries, matchesLibraryKind } from './lists'
const COLL = { MediaListCollection: { lists: [
  { entries: [ { progress: 3, media: { id: 1, title: {} } }, { progress: 0, media: { id: 2, title: {} } } ] },
  { entries: [ { progress: 12, media: { id: 3, title: {} } } ] },
] } }
describe('flattenEntries', () => {
  it('flattens list entries to {media, progress}[]', () => {
    const r = flattenEntries(COLL as any)
    expect(r.length).toBe(3); expect(r[0].media.id).toBe(1); expect(r[0].progress).toBe(3)
  })
  it('returns [] for missing data', () => expect(flattenEntries(undefined as any)).toEqual([]))
})

describe('matchesLibraryKind', () => {
  const anime = { id: 1, type: 'ANIME', format: 'TV', title: {} } as any
  const manga = { id: 2, type: 'MANGA', format: 'MANGA', title: {} } as any
  const novel = { id: 3, type: 'MANGA', format: 'NOVEL', title: {} } as any

  it('keeps reading formats out of anime and novels out of manga', () => {
    expect(matchesLibraryKind(anime, 'anime')).toBe(true)
    expect(matchesLibraryKind(manga, 'anime')).toBe(false)
    expect(matchesLibraryKind(anime, 'manga')).toBe(false)
    expect(matchesLibraryKind(manga, 'manga')).toBe(true)
    expect(matchesLibraryKind(novel, 'manga')).toBe(false)
    expect(matchesLibraryKind(novel, 'novel')).toBe(true)
  })
})
