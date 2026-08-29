import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { compactRatingLabel, compactVotes, ratingLabel, ratingsFor } from './media-metadata'

const media = (patch: Partial<Media>): Media => ({ id: 1, title: { userPreferred: 'Test' }, ...patch })

describe('provider-neutral media ratings', () => {
  it('labels legacy normalized scores by their owning catalog', () => {
    expect(ratingsFor(media({ catalog: { provider: 'tmdb', type: 'movie', id: '1' }, averageScore: 83 })))
      .toEqual([{ source: 'TMDB', score: 83, scale: 100 }])
    expect(ratingsFor(media({ averageScore: 91 }))[0].source).toBe('AniList')
  })

  it('preserves multiple native score scales and filters invalid entries', () => {
    const ratings = ratingsFor(media({ ratings: [
      { source: 'IMDb', score: 8.6, scale: 10, votes: 1234567 },
      { source: 'Broken', score: 101, scale: 100 },
    ] }))
    expect(ratings).toHaveLength(1)
    expect(ratingLabel(ratings[0])).toBe('8.6')
    expect(compactRatingLabel(ratings[0])).toBe('8.6')
    expect(compactVotes(ratings[0].votes)).toBe('1.2M')
  })

  it('accepts a parsed source score when structured ratings are unavailable', () => {
    expect(ratingsFor(media({}), 7.4)).toEqual([{ source: 'Source', score: 74, scale: 100 }])
  })
})
