import { gql } from '@urql/core'
import { get } from 'svelte/store'
import { CARD_MEDIA_FIELDS, HERO_MEDIA_FIELDS } from './fragments'
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
  query Page($page: Int = 1, $perPage: Int = 20, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $genre: String, $withPreview: Boolean = true) {
    Page(page: $page, perPage: $perPage) {
      media(type: ANIME, isAdult: false, sort: $sort, season: $season, seasonYear: $seasonYear, genre: $genre) {
        ...CardMediaFields
      }
    }
  }
  ${CARD_MEDIA_FIELDS}`

const PAGE_QUERY_ALL = gql`
  query PageAll($page: Int = 1, $perPage: Int = 20, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $genre: String, $withPreview: Boolean = true) {
    Page(page: $page, perPage: $perPage) {
      media(type: ANIME, sort: $sort, season: $season, seasonYear: $seasonYear, genre: $genre) {
        ...CardMediaFields
      }
    }
  }
  ${CARD_MEDIA_FIELDS}`

/** Browse query for the current adult setting: SFW excludes adult; "Show 18+" drops
 *  the isAdult filter so AniList returns both. Evaluated at store-creation time. */
export const pageQuery = () => (get(showAdult) ? PAGE_QUERY_ALL : PAGE_QUERY)

// The homepage hero is SEASONAL + QUALITY-RANKED, not globally trending: top-scored titles of the
// season that have actually started airing. Global TRENDING_DESC kept dragging in decade-old
// long-runners (ONE PIECE, BLEACH) and unscored hype, which is not what a "featured" slot means.
// MUSIC is excluded because a music video has no episodes to feature, and NOT_YET_RELEASED because
// the hero's primary action is Watch. Same two-variant adult split as PAGE_QUERY (see above).
const HERO_QUERY = gql`
  query Hero($page: Int = 1, $perPage: Int = 15, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int) {
    Page(page: $page, perPage: $perPage) {
      media(type: ANIME, isAdult: false, format_not: MUSIC, status_not_in: [NOT_YET_RELEASED], sort: $sort, season: $season, seasonYear: $seasonYear) {
        ...HeroMediaFields
      }
    }
  }
  ${HERO_MEDIA_FIELDS}`

const HERO_QUERY_ALL = gql`
  query HeroAll($page: Int = 1, $perPage: Int = 15, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int) {
    Page(page: $page, perPage: $perPage) {
      media(type: ANIME, format_not: MUSIC, status_not_in: [NOT_YET_RELEASED], sort: $sort, season: $season, seasonYear: $seasonYear) {
        ...HeroMediaFields
      }
    }
  }
  ${HERO_MEDIA_FIELDS}`

export const heroQuery = () => (get(showAdult) ? HERO_QUERY_ALL : HERO_QUERY)

/** Latest episode releases, ordered by the schedule event rather than Media.updatedAt (which also
 * changes for harmless metadata edits). The row filters adult media after the response because
 * AniList's Page.airingSchedules field does not expose an isAdult argument. */
export const RECENT_RELEASES_QUERY = gql`
  query RecentReleases($page: Int = 1, $perPage: Int = 50, $after: Int!, $before: Int!, $withPreview: Boolean = false) {
    Page(page: $page, perPage: $perPage) {
      airingSchedules(airingAt_greater: $after, airingAt_lesser: $before, sort: TIME_DESC) {
        episode airingAt
        media { ...CardMediaFields }
      }
    }
  }
  ${CARD_MEDIA_FIELDS}`

/** Variables for the hero pool: this season's highest-scored, already-airing titles. */
export function heroVars(now: Date) {
  const { season, seasonYear } = currentSeason(now)
  return { perPage: 15, sort: ['SCORE_DESC'], season, seasonYear }
}

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

/** Recommendations from the connected user's highest-scored current/completed titles. */
export const PERSONAL_RECOMMENDATIONS_QUERY = gql`
  query PersonalRecommendations($userName: String!, $withPreview: Boolean = true) {
    Page(page: 1, perPage: 8) {
      mediaList(
        userName: $userName
        type: ANIME
        status_in: [CURRENT, COMPLETED]
        sort: SCORE_DESC
      ) {
        media {
          recommendations(perPage: 5, sort: RATING_DESC) {
            nodes {
              rating
              mediaRecommendation { ...CardMediaFields }
            }
          }
        }
      }
    }
  }
  ${CARD_MEDIA_FIELDS}`
