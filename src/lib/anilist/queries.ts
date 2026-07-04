import { gql } from '@urql/core'
import { get } from 'svelte/store'
import { MEDIA_FIELDS } from './fragments'
import { showAdult } from '$lib/settings/ui'

export function currentSeason(now: Date) {
  const m = now.getMonth()
  const season = m < 3 ? 'WINTER' : m < 6 ? 'SPRING' : m < 9 ? 'SUMMER' : 'FALL'
  return { season, seasonYear: now.getFullYear() }
}

// AniList: `isAdult: false` excludes adult, but the argument must be OMITTED to
// INCLUDE it (passing `isAdult: null` matches media whose isAdult IS null — none —
// so returns EMPTY). A GraphQL variable can't omit an argument, so we keep two
// query variants and pick per the setting.
export const PAGE_QUERY = gql`
  query Page($page: Int = 1, $perPage: Int = 20, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $genre: String) {
    Page(page: $page, perPage: $perPage) {
      media(type: ANIME, isAdult: false, sort: $sort, season: $season, seasonYear: $seasonYear, genre: $genre) {
        ...MediaFields
      }
    }
  }
  ${MEDIA_FIELDS}`

const PAGE_QUERY_ALL = gql`
  query PageAll($page: Int = 1, $perPage: Int = 20, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $genre: String) {
    Page(page: $page, perPage: $perPage) {
      media(type: ANIME, sort: $sort, season: $season, seasonYear: $seasonYear, genre: $genre) {
        ...MediaFields
      }
    }
  }
  ${MEDIA_FIELDS}`

/** Browse query for the current adult setting: SFW excludes adult; "Show 18+" drops
 *  the isAdult filter so AniList returns both. Evaluated at store-creation time. */
export const pageQuery = () => (get(showAdult) ? PAGE_QUERY_ALL : PAGE_QUERY)

// Public home sections (personalized ones deferred to Plan 2b). The adult filter
// is baked into the query variant (pageQuery()), not the vars.
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
