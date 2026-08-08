import { gql } from '@urql/core'
import { CONTINUE_MEDIA_FIELDS, MEDIA_FIELDS, READING_MEDIA_FIELDS } from './fragments'
import type { Media } from './types'

export const LIST_QUERY = gql`
  query Lists($userName: String!, $status: MediaListStatus) {
    MediaListCollection(userName: $userName, type: ANIME, status: $status, sort: UPDATED_TIME_DESC) {
      lists { entries { progress updatedAt media { ...MediaFields } } }
    }
  }
  ${MEDIA_FIELDS}`

export const READING_LIST_QUERY = gql`
  query ReadingLists($userName: String!, $status: MediaListStatus) {
    MediaListCollection(userName: $userName, type: MANGA, status: $status, sort: UPDATED_TIME_DESC) {
      lists { entries { progress updatedAt media { ...ReadingMediaFields } } }
    }
  }
  ${READING_MEDIA_FIELDS}`

// Id-only list projection for callers that just need the SET of ids on a list (e.g. the
// schedule's "my shows" highlighting), not card data. LIST_QUERY drags full MediaFields —
// incl. a 100-node airingSchedule + synopsis — per entry, which is pure waste when the result
// is reduced to `new Set(ids)`. This keeps a heavy planning list to a tiny payload.
export const LIST_IDS_QUERY = gql`
  query ListIds($userName: String!, $status: MediaListStatus) {
    MediaListCollection(userName: $userName, type: ANIME, status: $status) {
      lists { entries { media { id idMal } } }
    }
  }`

// `updatedAt` is AniList's list-entry edit time in EPOCH SECONDS (×1000 for ms); used to order the
// Continue-Watching row across trackers + local history. Optional so older callers/mocks stay valid.
export interface Entry { media: Media; progress: number; updatedAt?: number }
interface Coll { MediaListCollection?: { lists?: { entries?: Entry[] }[] } }
export function flattenEntries(data: Coll | undefined): Entry[] {
  return (data?.MediaListCollection?.lists ?? []).flatMap((l) => l.entries ?? [])
}

export type LibraryKind = 'anime' | 'manga' | 'novel'
export function matchesLibraryKind(media: Media, kind: LibraryKind): boolean {
  if (kind === 'anime') return media.type !== 'MANGA'
  if (media.type !== 'MANGA') return false
  return kind === 'novel' ? media.format === 'NOVEL' : media.format !== 'NOVEL'
}

// Look up AniList media by a batch of MAL ids (for the Continue Watching row's MAL-sourced entries).
// AniList supports `idMal_in`, so this is one request. Results come back in AniList's own order —
// callers re-sort into the MAL list order. Uses the slim ContinueMediaFields projection — see its
// comment in fragments.ts for why.
export const MEDIA_BY_MAL_QUERY = gql`
  query MediaByMal($ids: [Int]) {
    Page(perPage: 50) { media(idMal_in: $ids, type: ANIME) { ...ContinueMediaFields } }
  }
  ${CONTINUE_MEDIA_FIELDS}`

export const READING_MEDIA_BY_MAL_QUERY = gql`
  query ReadingMediaByMal($ids: [Int]) {
    Page(perPage: 50) { media(idMal_in: $ids, type: MANGA) { ...ReadingMediaFields } }
  }
  ${READING_MEDIA_FIELDS}`

// Refresh locally-saved history snapshots in one request. In particular, nextAiringEpisode must be
// current so Continue Watching can hide a caught-up show and bring it back when a new episode airs.
// Uses the slim ContinueMediaFields projection — see its comment in fragments.ts for why.
export const MEDIA_BY_IDS_QUERY = gql`
  query MediaByIds($ids: [Int]) {
    Page(perPage: 50) { media(id_in: $ids, type: ANIME) { ...ContinueMediaFields } }
  }
  ${CONTINUE_MEDIA_FIELDS}`
