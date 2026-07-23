import { gql } from '@urql/core'
import { MEDIA_FIELDS } from './fragments'
import type { Media } from './types'

export const LIST_QUERY = gql`
  query Lists($userName: String!, $status: MediaListStatus) {
    MediaListCollection(userName: $userName, type: ANIME, status: $status, sort: UPDATED_TIME_DESC) {
      lists { entries { progress updatedAt media { ...MediaFields } } }
    }
  }
  ${MEDIA_FIELDS}`

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

// Look up AniList media by a batch of MAL ids (for MAL-sourced home rows). AniList
// supports `idMal_in`, so this is one request. Results come back in AniList's own
// order — callers re-sort into the MAL list order.
export const MEDIA_BY_MAL_QUERY = gql`
  query MediaByMal($ids: [Int]) {
    Page(perPage: 50) { media(idMal_in: $ids, type: ANIME) { ...MediaFields } }
  }
  ${MEDIA_FIELDS}`

// Refresh locally-saved history snapshots in one request. In particular, nextAiringEpisode must be
// current so Continue Watching can hide a caught-up show and bring it back when a new episode airs.
export const MEDIA_BY_IDS_QUERY = gql`
  query MediaByIds($ids: [Int]) {
    Page(perPage: 50) { media(id_in: $ids, type: ANIME) { ...MediaFields } }
  }
  ${MEDIA_FIELDS}`
