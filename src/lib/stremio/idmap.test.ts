import { describe, it, expect } from 'vitest'
import { buildIndex, lookupAnilistByKitsu, lookupAnilistByMal, lookupKitsu } from './idmap'
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
})
