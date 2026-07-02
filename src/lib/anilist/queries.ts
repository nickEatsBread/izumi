import { gql } from '@urql/core'
import { MEDIA_FIELDS } from './fragments'

export function currentSeason(now: Date) {
  const m = now.getMonth()
  const season = m < 3 ? 'WINTER' : m < 6 ? 'SPRING' : m < 9 ? 'SUMMER' : 'FALL'
  return { season, seasonYear: now.getFullYear() }
}

export const PAGE_QUERY = gql`
  query Page($page: Int = 1, $perPage: Int = 20, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $genre: String) {
    Page(page: $page, perPage: $perPage) {
      media(type: ANIME, isAdult: false, sort: $sort, season: $season, seasonYear: $seasonYear, genre: $genre) {
        ...MediaFields
      }
    }
  }
  ${MEDIA_FIELDS}`

// Public home sections (personalized ones deferred to Plan 2b)
export function homeSections(now: Date) {
  const { season, seasonYear } = currentSeason(now)
  return [
    { key: 'season', title: 'Popular This Season', vars: { sort: ['POPULARITY_DESC'], season, seasonYear } },
    { key: 'trending', title: 'Trending Now', vars: { sort: ['TRENDING_DESC'] } },
    { key: 'popular', title: 'All Time Popular', vars: { sort: ['POPULARITY_DESC'] } },
    { key: 'romance', title: 'Romance', vars: { sort: ['TRENDING_DESC'], genre: 'Romance' } },
    { key: 'action', title: 'Action', vars: { sort: ['TRENDING_DESC'], genre: 'Action' } },
    { key: 'fantasy', title: 'Fantasy', vars: { sort: ['TRENDING_DESC'], genre: 'Fantasy' } },
  ]
}
