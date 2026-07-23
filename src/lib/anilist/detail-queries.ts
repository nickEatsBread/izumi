import { gql } from '@urql/core'
import { get } from 'svelte/store'
import { MEDIA_FIELDS, SCHEDULE_MEDIA_FIELDS } from './fragments'
import { showAdult } from '$lib/settings/ui'

// Detail page only: pull the viewer's list entry (progress/status) + favourite
// flag. Kept off the shared MediaFields fragment so browse/card queries don't
// over-fetch per-viewer data.
export const MEDIA_BY_ID = gql`
  query MediaById($id: Int!) {
    Media(id: $id, type: ANIME) {
      ...MediaFields
      isFavourite
      mediaListEntry { id progress status score(format: POINT_100) repeat startedAt { year month day } completedAt { year month day } }
      relations { edges { relationType node { ...MediaFields } } }
    }
  }
  ${MEDIA_FIELDS}`

// Shared filter arg lists, kept in ONE place so the SFW / 18+ / count variants can't
// drift. Interpolated as plain strings into the gql templates below (advanced fields —
// tags, source, country, score, episode range — sit alongside the quick-bar ones).
const SEARCH_ARGS = '$page: Int = 1, $perPage: Int = 30, $search: String, $genre_in: [String], $tag_in: [String], $tag_not_in: [String], $minimumTagRank: Int, $season: MediaSeason, $seasonYear: Int, $format_in: [MediaFormat], $status_in: [MediaStatus], $source_in: [MediaSource], $countryOfOrigin: CountryCode, $averageScore_greater: Int, $episodes_greater: Int, $episodes_lesser: Int, $sort: [MediaSort]'
const MEDIA_ARGS = 'search: $search, genre_in: $genre_in, tag_in: $tag_in, tag_not_in: $tag_not_in, minimumTagRank: $minimumTagRank, season: $season, seasonYear: $seasonYear, format_in: $format_in, status_in: $status_in, source_in: $source_in, countryOfOrigin: $countryOfOrigin, averageScore_greater: $averageScore_greater, episodes_greater: $episodes_greater, episodes_lesser: $episodes_lesser, sort: $sort'

// SFW variant (excludes adult). See queries.ts for why we need two variants
// instead of an `isAdult` variable.
export const SEARCH_QUERY = gql`
  query Search(${SEARCH_ARGS}) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage currentPage }
      media(type: ANIME, isAdult: false, ${MEDIA_ARGS}) { ...MediaFields }
    }
  }
  ${MEDIA_FIELDS}`

// "Show 18+" variant — drops the isAdult argument so AniList returns both.
const SEARCH_QUERY_ALL = gql`
  query SearchAll(${SEARCH_ARGS}) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage currentPage }
      media(type: ANIME, ${MEDIA_ARGS}) { ...MediaFields }
    }
  }
  ${MEDIA_FIELDS}`

/** Search query for the current adult setting. Evaluated at store-creation time. */
export const searchQuery = () => (get(showAdult) ? SEARCH_QUERY_ALL : SEARCH_QUERY)

// Count-only queries backing the Advanced modal's live "Apply · N": same filter args,
// but only pageInfo.total. Call with `{ ...searchVariables(draft), perPage: 1 }`. The
// SFW/18+ split matters — adult gating changes the total.
const SEARCH_COUNT = gql`
  query SearchCount(${SEARCH_ARGS}) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total }
      media(type: ANIME, isAdult: false, ${MEDIA_ARGS}) { id }
    }
  }`
const SEARCH_COUNT_ALL = gql`
  query SearchCountAll(${SEARCH_ARGS}) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total }
      media(type: ANIME, ${MEDIA_ARGS}) { id }
    }
  }`
export const searchCountQuery = () => (get(showAdult) ? SEARCH_COUNT_ALL : SEARCH_COUNT)

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

export interface SearchFilters {
  // Quick bar:
  search?: string; genres?: string[]; season?: string; year?: number | null
  formats?: string[]; statuses?: string[]; sort?: string
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
