import { gql } from '@urql/core'
import { MEDIA_FIELDS } from './fragments'

// Detail page only: pull the viewer's list entry (progress/status) + favourite
// flag. Kept off the shared MediaFields fragment so browse/card queries don't
// over-fetch per-viewer data.
export const MEDIA_BY_ID = gql`
  query MediaById($id: Int!) {
    Media(id: $id, type: ANIME) {
      ...MediaFields
      isFavourite
      mediaListEntry { progress status }
      relations { edges { relationType node { ...MediaFields } } }
    }
  }
  ${MEDIA_FIELDS}`

export const SEARCH_QUERY = gql`
  query Search($page: Int = 1, $perPage: Int = 30, $search: String, $genre_in: [String], $season: MediaSeason, $seasonYear: Int, $format_in: [MediaFormat], $status_in: [MediaStatus], $sort: [MediaSort]) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage currentPage }
      media(type: ANIME, isAdult: false, search: $search, genre_in: $genre_in, season: $season, seasonYear: $seasonYear, format_in: $format_in, status_in: $status_in, sort: $sort) { ...MediaFields }
    }
  }
  ${MEDIA_FIELDS}`

export const SCHEDULE_QUERY = gql`
  query Schedule($start: Int!, $end: Int!, $page: Int = 1) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
        airingAt episode
        media { ...MediaFields }
      }
    }
  }
  ${MEDIA_FIELDS}`

export interface SearchFilters { search?: string; genres?: string[]; season?: string; year?: number | null; formats?: string[]; statuses?: string[]; sort?: string }
export function searchVariables(f: SearchFilters): Record<string, unknown> {
  const v: Record<string, unknown> = {}
  if (f.search) v.search = f.search
  if (f.genres?.length) v.genre_in = f.genres
  if (f.season) v.season = f.season
  if (f.year) v.seasonYear = f.year
  if (f.formats?.length) v.format_in = f.formats
  if (f.statuses?.length) v.status_in = f.statuses
  v.sort = [f.sort || (f.search ? 'SEARCH_MATCH' : 'TRENDING_DESC')]
  return v
}
