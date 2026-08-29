import { describe, expect, it } from 'vitest'
import { mapTmdb, parseCinemetaRating, pickTmdbLogo, tmdbContentRating, tmdbDiscoverFilterParams, tmdbRegion, tmdbWatchProviders } from './tmdb'

describe('TMDB catalog mapping', () => {
  it('maps movies to a provider-owned identity instead of an AniList id', () => {
    const media = mapTmdb({
      id: 550, title: 'Fight Club', original_title: 'Fight Club',
      release_date: '1999-10-15', poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg',
      vote_average: 8.4, vote_count: 2345, original_language: 'en',
    }, 'movie')
    expect(media).toMatchObject({
      catalog: { provider: 'tmdb', type: 'movie', id: '550' },
      externalIds: { tmdb: 550 }, type: 'MOVIE', format: 'MOVIE', episodes: 1,
      startDate: { year: 1999 }, averageScore: 84,
      ratings: [{ source: 'TMDB', score: 8.4, scale: 10, votes: 2345 }],
      originalLanguage: 'en', releaseDate: '1999-10-15',
    })
    expect(media!.id).toBeLessThan(0)
    expect(media!.coverImage?.extraLarge).toContain('/w780/poster.jpg')
  })

  it('maps TV results as series and filters person results', () => {
    expect(mapTmdb({ id: 1399, name: 'Game of Thrones', first_air_date: '2011-04-17' }, 'tv'))
      .toMatchObject({ catalog: { provider: 'tmdb', type: 'series', id: '1399' }, type: 'SERIES', format: 'TV' })
    expect(mapTmdb({ id: 1, media_type: 'person', name: 'Someone' }, 'tv')).toBeNull()
  })

  it('keeps TMDB anime display names English even with the Romaji preference', () => {
    expect(mapTmdb({
      id: 85937,
      name: 'Demon Slayer: Kimetsu no Yaiba',
      original_name: '鬼滅の刃',
      original_language: 'ja',
    }, 'tv')?.title).toEqual({
      english: 'Demon Slayer: Kimetsu no Yaiba',
      romaji: 'Demon Slayer: Kimetsu no Yaiba',
      native: '鬼滅の刃',
      userPreferred: 'Demon Slayer: Kimetsu no Yaiba',
    })
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

  it('maps regional certification and viewing providers with sensible fallbacks', () => {
    expect(tmdbContentRating({
      release_dates: { results: [{ iso_3166_1: 'GB', release_dates: [
        { certification: '12A', type: 3 },
      ] }] },
    }, 'GB')).toBe('12A')
    expect(tmdbContentRating({
      content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-14' }] },
    }, 'CA')).toBe('TV-14')

    expect(tmdbWatchProviders({ results: { GB: {
      link: 'https://www.themoviedb.org/movie/1/watch?locale=GB',
      flatrate: [{ provider_id: 8, provider_name: 'Example Plus', logo_path: '/logo.jpg' }],
      rent: [{ provider_id: 8, provider_name: 'Example Plus' }, { provider_id: 3, provider_name: 'Example Store' }],
    } } }, 'GB')).toEqual([
      {
        id: 8, name: 'Example Plus', kind: 'subscription',
        logoImage: 'https://image.tmdb.org/t/p/w92/logo.jpg',
        url: 'https://www.themoviedb.org/movie/1/watch?locale=GB',
      },
      {
        id: 3, name: 'Example Store', kind: 'rent', logoImage: undefined,
        url: 'https://www.themoviedb.org/movie/1/watch?locale=GB',
      },
    ])
  })

  it('derives a locale region and validates keyless IMDb ratings', () => {
    expect(tmdbRegion('en-GB')).toBe('GB')
    expect(tmdbRegion('not a locale')).toBe('US')
    expect(parseCinemetaRating({ meta: { imdbRating: '8.7' } })).toEqual({ source: 'IMDb', score: 8.7, scale: 10 })
    expect(parseCinemetaRating({ meta: { imdbRating: 'unrated' } })).toBeUndefined()
  })
})
