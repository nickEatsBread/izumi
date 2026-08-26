import { describe, expect, it } from 'vitest'
import { mapTmdb } from './tmdb'

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
})
