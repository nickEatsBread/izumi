import { gql } from '@urql/core'
import { get } from 'svelte/store'
import { CARD_MEDIA_FIELDS, MEDIA_FIELDS, READING_MEDIA_FIELDS, SCHEDULE_MEDIA_FIELDS } from './fragments'
import { showAdult } from '$lib/settings/ui'

// Detail page only: pull the viewer's list entry (progress/status) + favourite
// flag. Kept off the shared MediaFields fragment so browse/card queries don't
// over-fetch per-viewer data.
export const MEDIA_BY_ID = gql`
  query MediaById($id: Int!, $withPreview: Boolean = true) {
    Media(id: $id, type: ANIME) {
      ...MediaFields
      isFavourite
      source countryOfOrigin
      tags { name rank isGeneralSpoiler isMediaSpoiler }
      mediaListEntry { id progress status score(format: POINT_100) repeat startedAt { year month day } completedAt { year month day } }
      relations { edges { relationType node { ...CardMediaFields } } }
      characters(perPage: 12, sort: [ROLE, RELEVANCE]) {
        edges {
          role
          node { id name { full native } image { large } }
          voiceActors(language: JAPANESE, sort: [RELEVANCE]) {
            id name { full native } image { large }
          }
        }
      }
      staff(perPage: 12, sort: [RELEVANCE]) {
        edges { role node { id name { full native } image { large } } }
      }
      recommendations(perPage: 12, sort: [RATING_DESC]) {
        nodes { rating mediaRecommendation { ...CardMediaFields } }
      }
    }
  }
  ${MEDIA_FIELDS}
  ${CARD_MEDIA_FIELDS}`

// Information-only detail query for manga and light novels. It intentionally has no playback
// fields or mutation-facing list entry: reading media can be browsed from tracker libraries, but
// Izumi remains an anime player.
export const READING_MEDIA_BY_ID = gql`
  query ReadingMediaById($id: Int!) {
    Media(id: $id, type: MANGA) {
      ...ReadingMediaFields
      tags { name rank isGeneralSpoiler isMediaSpoiler }
      relations {
        edges { relationType node { ...ReadingMediaFields } }
      }
      characters(perPage: 12, sort: [ROLE, RELEVANCE]) {
        edges {
          role
          node { id name { full native } image { large } }
        }
      }
      staff(perPage: 12, sort: [RELEVANCE]) {
        edges { role node { id name { full native } image { large } } }
      }
      recommendations(perPage: 12, sort: [RATING_DESC]) {
        nodes { rating mediaRecommendation { ...ReadingMediaFields } }
      }
    }
  }
  ${READING_MEDIA_FIELDS}`

// Shared filter arg lists, kept in ONE place so the SFW / 18+ variants can't drift.
// Interpolated as plain strings into the gql templates below (advanced fields —
// tags, source, country, score, episode range — sit alongside the quick-bar ones).
const SEARCH_ARGS = '$page: Int = 1, $perPage: Int = 30, $search: String, $genre_in: [String], $tag_in: [String], $tag_not_in: [String], $minimumTagRank: Int, $season: MediaSeason, $seasonYear: Int, $format_in: [MediaFormat], $status_in: [MediaStatus], $source_in: [MediaSource], $countryOfOrigin: CountryCode, $averageScore_greater: Int, $episodes_greater: Int, $episodes_lesser: Int, $sort: [MediaSort], $withPreview: Boolean = true'
const MEDIA_ARGS = 'search: $search, genre_in: $genre_in, tag_in: $tag_in, tag_not_in: $tag_not_in, minimumTagRank: $minimumTagRank, season: $season, seasonYear: $seasonYear, format_in: $format_in, status_in: $status_in, source_in: $source_in, countryOfOrigin: $countryOfOrigin, averageScore_greater: $averageScore_greater, episodes_greater: $episodes_greater, episodes_lesser: $episodes_lesser, sort: $sort'

// SFW variant (excludes adult). See queries.ts for why we need two variants
// instead of an `isAdult` variable.
export const SEARCH_QUERY = gql`
  query Search(${SEARCH_ARGS}) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage currentPage }
      media(type: ANIME, isAdult: false, ${MEDIA_ARGS}) { ...CardMediaFields }
    }
  }
  ${CARD_MEDIA_FIELDS}`

// "Show 18+" variant — drops the isAdult argument so AniList returns both.
const SEARCH_QUERY_ALL = gql`
  query SearchAll(${SEARCH_ARGS}) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage currentPage }
      media(type: ANIME, ${MEDIA_ARGS}) { ...CardMediaFields }
    }
  }
  ${CARD_MEDIA_FIELDS}`

/** Search query for the current adult setting. Evaluated at store-creation time. */
export const searchQuery = () => (get(showAdult) ? SEARCH_QUERY_ALL : SEARCH_QUERY)

export const STUDIO_MEDIA_QUERY = gql`
  query StudioMedia($id: Int!, $page: Int = 1, $withPreview: Boolean = true) {
    Studio(id: $id) {
      name
      media(page: $page, perPage: 30, sort: POPULARITY_DESC, type: ANIME) {
        pageInfo { hasNextPage }
        nodes { ...CardMediaFields }
      }
    }
  }
  ${CARD_MEDIA_FIELDS}`

export const STAFF_MEDIA_QUERY = gql`
  query StaffMedia($id: Int!, $page: Int = 1, $withPreview: Boolean = true) {
    Staff(id: $id) {
      name { full }
      staffMedia(page: $page, perPage: 30, sort: POPULARITY_DESC, type: ANIME) {
        pageInfo { hasNextPage }
        nodes { ...CardMediaFields }
      }
      characterMedia(page: $page, perPage: 30, sort: POPULARITY_DESC) {
        pageInfo { hasNextPage }
        edges { node { ...CardMediaFields } }
      }
    }
  }
  ${CARD_MEDIA_FIELDS}`

/** The full, authoritative list of AniList genres (so the filter isn't a stale
 *  hardcoded subset). Returns a plain string[]. */
export const GENRE_COLLECTION = gql`query GenreCollection { GenreCollection }`

/** The full AniList tag collection (name/category/rank + spoiler/adult flags),
 *  fetched once and urql-cached — mirrors GENRE_COLLECTION. Feeds the tag picker. */
export const MEDIA_TAG_COLLECTION = gql`
  query MediaTagCollection {
    MediaTagCollection { name category rank isAdult isGeneralSpoiler isMediaSpoiler }
  }`

/** Source-material enum values AniList's `source_in` accepts. */
export const MEDIA_SOURCES = ['ORIGINAL', 'MANGA', 'LIGHT_NOVEL', 'VISUAL_NOVEL', 'VIDEO_GAME', 'NOVEL', 'DOUJINSHI', 'ANIME', 'WEB_NOVEL', 'LIVE_ACTION', 'GAME', 'COMIC', 'MULTIMEDIA_PROJECT', 'PICTURE_BOOK', 'OTHER']

/** Countries of origin AniList exposes (single-select — `countryOfOrigin` takes one value). */
export const COUNTRIES = [
  { code: 'JP', label: 'Japan' },
  { code: 'KR', label: 'South Korea' },
  { code: 'CN', label: 'China' },
  { code: 'TW', label: 'Taiwan' },
]

export const SCHEDULE_QUERY = gql`
  query Schedule($start: Int!, $end: Int!, $page: Int = 1) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
        airingAt episode
        media { ...ScheduleMediaFields }
      }
    }
  }
  ${SCHEDULE_MEDIA_FIELDS}`

/** One HTTP round trip for the normal weekly timetable. AniList caps every Page at 50, but GraphQL
 * aliases let us request seven independent day Pages in one operation. schedule-cache follows up
 * only the exceptional day whose Page reports hasNextPage instead of serially paging the whole
 * week before anything can render. */
export const SCHEDULE_WEEK_QUERY = gql`
  query ScheduleWeek(
    $d0Start: Int!, $d0End: Int!, $d1Start: Int!, $d1End: Int!,
    $d2Start: Int!, $d2End: Int!, $d3Start: Int!, $d3End: Int!,
    $d4Start: Int!, $d4End: Int!, $d5Start: Int!, $d5End: Int!,
    $d6Start: Int!, $d6End: Int!
  ) {
    d0: Page(page: 1, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $d0Start, airingAt_lesser: $d0End, sort: TIME) {
        airingAt episode media { ...ScheduleMediaFields }
      }
    }
    d1: Page(page: 1, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $d1Start, airingAt_lesser: $d1End, sort: TIME) {
        airingAt episode media { ...ScheduleMediaFields }
      }
    }
    d2: Page(page: 1, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $d2Start, airingAt_lesser: $d2End, sort: TIME) {
        airingAt episode media { ...ScheduleMediaFields }
      }
    }
    d3: Page(page: 1, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $d3Start, airingAt_lesser: $d3End, sort: TIME) {
        airingAt episode media { ...ScheduleMediaFields }
      }
    }
    d4: Page(page: 1, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $d4Start, airingAt_lesser: $d4End, sort: TIME) {
        airingAt episode media { ...ScheduleMediaFields }
      }
    }
    d5: Page(page: 1, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $d5Start, airingAt_lesser: $d5End, sort: TIME) {
        airingAt episode media { ...ScheduleMediaFields }
      }
    }
    d6: Page(page: 1, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $d6Start, airingAt_lesser: $d6End, sort: TIME) {
        airingAt episode media { ...ScheduleMediaFields }
      }
    }
  }
  ${SCHEDULE_MEDIA_FIELDS}`

export interface SearchFilters {
  // Quick bar:
  search?: string; genres?: string[]; season?: string; year?: number | null
  formats?: string[]; statuses?: string[]; sort?: string
  studioId?: number
  staffId?: number
  exploreName?: string
  // Advanced modal:
  tagsIn?: string[]       // tag names to include
  tagsNotIn?: string[]    // tag names to exclude
  minTagRank?: number     // 0–100 (minimum % rank a tag must have on a title)
  sources?: string[]      // MediaSource enum values
  country?: string        // 'JP' | 'KR' | 'CN' | 'TW'
  minScore?: number       // 0–100 (inclusive lower bound in the UI)
  epMin?: number          // inclusive
  epMax?: number          // inclusive
}
export function searchVariables(f: SearchFilters): Record<string, unknown> {
  const v: Record<string, unknown> = {}
  if (f.search) v.search = f.search
  if (f.genres?.length) v.genre_in = f.genres
  if (f.season) v.season = f.season
  if (f.year) v.seasonYear = f.year
  if (f.formats?.length) v.format_in = f.formats
  if (f.statuses?.length) v.status_in = f.statuses
  // Advanced. AniList's `_greater`/`_lesser` are STRICT, so translate the inclusive UI
  // bounds by ±1.
  if (f.tagsIn?.length) v.tag_in = f.tagsIn
  if (f.tagsNotIn?.length) v.tag_not_in = f.tagsNotIn
  if (f.minTagRank) v.minimumTagRank = f.minTagRank
  if (f.sources?.length) v.source_in = f.sources
  if (f.country) v.countryOfOrigin = f.country
  if (f.minScore) v.averageScore_greater = f.minScore - 1
  if (f.epMin != null) v.episodes_greater = f.epMin - 1
  if (f.epMax != null) v.episodes_lesser = f.epMax + 1
  v.sort = [f.sort || (f.search ? 'SEARCH_MATCH' : 'TRENDING_DESC')]
  return v
}
