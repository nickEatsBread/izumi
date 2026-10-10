import { describe, it, expect } from 'vitest'
import { buildIndex, lookupAnilistByKitsu, lookupAnilistByMal, lookupImdb, lookupKitsu, lookupMal, lookupTvdbSeason } from './idmap'
const FIX = [ { anilist_id: 1, kitsu_id: 11, mal_id: 21 }, { anilist_id: 5, mal_id: 30 } ]
describe('idmap', () => {
  const idx = buildIndex(FIX as any)
  it('maps anilist -> kitsu', () => expect(lookupKitsu(idx, 1)).toBe(11))
  it('returns undefined when no kitsu mapping', () => expect(lookupKitsu(idx, 5)).toBeUndefined())
  it('returns undefined for unknown id', () => expect(lookupKitsu(idx, 999)).toBeUndefined())
  it('maps MAL ids back to canonical AniList ids', () => {
    expect(lookupAnilistByMal(idx, 21)).toBe(1)
    expect(lookupAnilistByMal(idx, 30)).toBe(5)
    expect(lookupAnilistByMal(idx, 999)).toBeUndefined()
  })
  it('maps Kitsu ids back to canonical AniList ids', () => {
    expect(lookupAnilistByKitsu(idx, 11)).toBe(1)
    expect(lookupAnilistByKitsu(idx, 999)).toBeUndefined()
  })
  it('maps AniList ids to MAL for providers whose own mapping table lags', () => {
    expect(lookupMal(idx, 1)).toBe(21)
    expect(lookupMal(idx, 5)).toBe(30)
    expect(lookupMal(idx, 999)).toBeUndefined()
  })
})
describe('idmap IMDb ids', () => {
  const idx = buildIndex([
    { anilist_id: 186541, imdb_id: ['tt41298100'] },
    { anilist_id: 2, imdb_id: 'tt0000002' },
    { anilist_id: 3, imdb_id: ['tt0000003', 'tt0000033'] },
    { anilist_id: 4, imdb_id: ['not-an-id'] },
    { anilist_id: 5 },
  ] as any)
  it('names the IMDb title the list maps an AniList id to', () => {
    expect(lookupImdb(idx, 186541)).toBe('tt41298100')
    expect(lookupImdb(idx, 2)).toBe('tt0000002')
  })
  it('refuses to choose between several titles or a malformed one', () => {
    expect(lookupImdb(idx, 3)).toBeUndefined()
    expect(lookupImdb(idx, 4)).toBeUndefined()
    expect(lookupImdb(idx, 5)).toBeUndefined()
    expect(lookupImdb(idx, 999)).toBeUndefined()
  })
})
describe('idmap TVDB seasons', () => {
  const idx = buildIndex([
    { anilist_id: 10, tvdb_id: 900, season: { tvdb: 1 } },
    { anilist_id: 11, tvdb_id: 901, season: { tvdb: 2 } },
    // A split cour: two entries share one TVDB season, so the second does not start at its episode 1.
    { anilist_id: 12, tvdb_id: 902, season: { tvdb: 1 } },
    { anilist_id: 13, tvdb_id: 902, season: { tvdb: 1 } },
    { anilist_id: 14, tvdb_id: 903 },
    { anilist_id: 15, season: { tvdb: 1 } },
  ] as any)
  it('names the TVDB season an entry has to itself', () => {
    expect(lookupTvdbSeason(idx, 10)).toBe(1)
    expect(lookupTvdbSeason(idx, 11)).toBe(2)
  })
  it('refuses a season several entries share, or one without a show id', () => {
    expect(lookupTvdbSeason(idx, 12)).toBeUndefined()
    expect(lookupTvdbSeason(idx, 13)).toBeUndefined()
    expect(lookupTvdbSeason(idx, 14)).toBeUndefined()
    expect(lookupTvdbSeason(idx, 15)).toBeUndefined()
    expect(lookupTvdbSeason(idx, 999)).toBeUndefined()
  })
})
