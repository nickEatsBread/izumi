import { describe, expect, it } from 'vitest'
import { mapTmdb, pickTmdbLogo, tmdbDiscoverFilterParams } from './tmdb'

describe('TMDB catalog mapping', () => {
  it('maps movies to a provider-owned identity instead of an AniList id', () => {
    const media = mapTmdb({
      id: 550, title: 'Fight Club', original_title: 'Fight Club',
      release_date: '1999-10-15', poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg',
      vote_average: 8.4,
    }, 'movie')
    expect(media).toMatchObject({
      catalog: { provider: 'tmdb', type: 'movie', id: '550' },
      externalIds: { tmdb: 550 }, type: 'MOVIE', format: 'MOVIE', episodes: 1,
      startDate: { year: 1999 }, averageScore: 84,
    })
    expect(media!.id).toBeLessThan(0)
    expect(media!.coverImage?.extraLarge).toContain('/w780/poster.jpg')
  })

  it('maps TV results as series and filters person results', () => {
    expect(mapTmdb({ id: 1399, name: 'Game of Thrones', first_air_date: '2011-04-17' }, 'tv'))
      .toMatchObject({ catalog: { provider: 'tmdb', type: 'series', id: '1399' }, type: 'SERIES', format: 'TV' })
    expect(mapTmdb({ id: 1, media_type: 'person', name: 'Someone' }, 'tv')).toBeNull()
  })

  it('chooses the best English title logo and falls back to clear text when absent', () => {
    expect(pickTmdbLogo({ logos: [
      { file_path: '/neutral.png', iso_639_1: null, vote_average: 10, width: 1_000 },
      { file_path: '/english-small.png', iso_639_1: 'en', vote_average: 5, width: 500 },
      { file_path: '/english-best.png', iso_639_1: 'en', vote_average: 8, width: 800 },
    ] })).toBe('https://image.tmdb.org/t/p/w500/english-best.png')
    expect(pickTmdbLogo()).toBeUndefined()
  })

  it('maps advanced discovery filters to TMDB parameters and score scale', () => {
    expect(tmdbDiscoverFilterParams('movie', {
      page: 3,
      year: 2024,
      sort: 'rating',
      minScore: 75,
      minVotes: 500,
      language: 'ko',
      country: 'KR',
    }, 18)).toMatchObject({
      page: 3,
      sort_by: 'vote_average.desc',
      with_genres: '18',
      with_original_language: 'ko',
      with_origin_country: 'KR',
      primary_release_year: 2024,
      'vote_average.gte': 7.5,
      'vote_count.gte': 500,
    })
  })

  it('uses TV air dates for recent-series discovery', () => {
    expect(tmdbDiscoverFilterParams('tv', { sort: 'recent' })).toMatchObject({
      sort_by: 'first_air_date.desc',
    })
    expect(tmdbDiscoverFilterParams('tv', { sort: 'oldest' })).toMatchObject({
      sort_by: 'first_air_date.asc',
    })
    expect(tmdbDiscoverFilterParams('movie', { sort: 'title' })).toMatchObject({
      sort_by: 'original_title.asc',
    })
  })
})
