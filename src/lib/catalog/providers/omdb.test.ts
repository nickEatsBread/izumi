import { describe, expect, it } from 'vitest'
import { parseOmdbRatings } from './omdb'

describe('OMDb rating metadata', () => {
  it('maps supported rating scales and IMDb vote counts', () => {
    expect(parseOmdbRatings({
      Response: 'True', imdbID: 'tt1234567', imdbVotes: '1,234,567',
      Ratings: [
        { Source: 'Internet Movie Database', Value: '8.7/10' },
        { Source: 'Rotten Tomatoes', Value: '93%' },
        { Source: 'Metacritic', Value: '82/100' },
      ],
    })).toEqual([
      { source: 'IMDb', score: 8.7, scale: 10, votes: 1_234_567, url: 'https://www.imdb.com/title/tt1234567/' },
      { source: 'Rotten Tomatoes', score: 93, scale: 100, votes: undefined },
      { source: 'Metacritic', score: 82, scale: 100, votes: undefined },
    ])
  })

  it('uses scalar fallbacks and rejects failed payloads', () => {
    expect(parseOmdbRatings({ Response: 'True', imdbRating: '7.2', Metascore: '64' }))
      .toEqual([{ source: 'IMDb', score: 7.2, scale: 10, votes: undefined }, { source: 'Metacritic', score: 64, scale: 100 }])
    expect(parseOmdbRatings({ Response: 'False', Error: 'Invalid API key!' })).toEqual([])
  })
})
