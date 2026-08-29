import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import {
  communityRatingKey,
  parseKitsuCommunityRating,
  parseMalCommunityRating,
  parseSimklCommunityRating,
  providerRatingOnMedia,
} from './community-rating'

const media = (value: Partial<Media> = {}): Media => ({
  id: 21,
  idMal: 21,
  type: 'ANIME',
  title: { userPreferred: 'One Piece' },
  averageScore: 88,
  ...value,
})

describe('linked tracker community ratings', () => {
  it('parses each provider without changing its native scale', () => {
    expect(parseMalCommunityRating({ mean: 8.73, num_scoring_users: 1234 })).toEqual({
      source: 'MyAnimeList', score: 8.73, scale: 10, votes: 1234,
    })
    expect(parseKitsuCommunityRating({ data: { attributes: {
      averageRating: '82.4', ratingFrequencies: { '18': '40', '20': '60' },
    } } })).toEqual({ source: 'Kitsu', score: 82.4, scale: 100, votes: 100 })
    expect(parseSimklCommunityRating({ simkl: { rating: 8.1, votes: 456 } })).toEqual({
      source: 'Simkl', score: 8.1, scale: 10, votes: 456,
    })
  })

  it('uses only embedded ratings that belong to the requested provider', () => {
    const title = media({ ratings: [{ source: 'MyAnimeList', score: 8.7, scale: 10 }] })
    expect(providerRatingOnMedia(title, 'mal')?.source).toBe('MyAnimeList')
    expect(providerRatingOnMedia(title, 'anilist')).toBeUndefined()
    expect(providerRatingOnMedia(media(), 'anilist')).toEqual({ source: 'AniList', score: 88, scale: 100 })
  })

  it('addresses provider lookups with real cross-database ids', () => {
    const title = media({ externalIds: { anilist: 21, mal: 21, kitsu: 12 } })
    expect(communityRatingKey(title, 'mal')).toBe('mal:21')
    expect(communityRatingKey(title, 'kitsu')).toBe('kitsu:kitsu:12')
    expect(communityRatingKey(title, 'simkl')).toBe('simkl:mal:21')
  })
})
