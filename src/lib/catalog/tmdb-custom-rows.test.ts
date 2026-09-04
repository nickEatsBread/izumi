import { describe, expect, it } from 'vitest'
import {
  normalizeTmdbCustomHomeRow,
  tmdbCustomHomeRequest,
  tmdbCustomHomeRowOption,
  validTmdbCustomHomeRows,
  type TmdbCustomHomeRow,
} from './tmdb-custom-rows'

const row: TmdbCustomHomeRow = {
  id: 'custom-scifi',
  title: 'Short sci-fi films',
  mediaType: 'movie',
  sort: 'rating',
  genreId: 878,
  genreLabel: 'Science Fiction',
  minimumScore: 7.5,
  runtimeMax: 100,
  streamingOnly: true,
}

describe('TMDB custom Home rows', () => {
  it('normalizes persisted recipes and rejects unknown media types', () => {
    expect(normalizeTmdbCustomHomeRow({ ...row, title: '  Short   sci-fi films  ' })).toMatchObject({
      title: 'Short sci-fi films',
      genreId: 878,
      genreLabel: 'Science Fiction',
    })
    expect(normalizeTmdbCustomHomeRow({ ...row, mediaType: 'person' })).toBeNull()
    expect(validTmdbCustomHomeRows([row, row])).toHaveLength(1)
  })

  it('builds a bounded Discover request with regional streaming availability', () => {
    expect(tmdbCustomHomeRequest(row, 'GB', new Date('2026-09-04T12:00:00Z'))).toEqual({
      id: 'custom-scifi',
      path: '/discover/movie',
      kind: 'movie',
      params: {
        sort_by: 'vote_average.desc',
        with_genres: 878,
        primary_release_year: undefined,
        'vote_average.gte': 7.5,
        'vote_count.gte': 100,
        'with_runtime.lte': 100,
        watch_region: 'GB',
        region: 'GB',
        with_watch_monetization_types: 'flatrate|free|ads',
      },
      more: {
        type: 'movie',
        sort: 'rating',
        genre: 'Science Fiction',
        year: undefined,
        minScore: 75,
        runtimeMax: 100,
      },
    })
  })

  it('describes a recipe clearly in the existing row editor', () => {
    expect(tmdbCustomHomeRowOption(row)).toMatchObject({
      title: 'Short sci-fi films',
      group: 'Your TMDB rows',
      defaultEnabled: true,
    })
    expect(tmdbCustomHomeRowOption(row).description).toContain('Highest rated'.toLowerCase())
    expect(tmdbCustomHomeRowOption(row).description).toContain('streaming in your region')
  })
})
