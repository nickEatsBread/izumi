import { gql } from '@urql/core'
import { CARD_MEDIA_FIELDS, CONTINUE_MEDIA_FIELDS, READING_MEDIA_FIELDS } from './fragments'
import type { Media } from './types'

export const LIST_QUERY = gql`
  query Lists($userName: String!, $status: MediaListStatus) {
    MediaListCollection(userName: $userName, type: ANIME, status: $status, sort: UPDATED_TIME_DESC) {
      lists { entries { status progress updatedAt media { ...ContinueMediaFields } } }
    }
  }
  ${CONTINUE_MEDIA_FIELDS}`

// A carousel is an overview, not a complete library export. AniList explicitly recommends the
// paginated MediaList field for this use; the previous MediaListCollection downloaded an account's
// entire status list and then rendered only the first thirty entries.
export const LIST_PREVIEW_QUERY = gql`
  query ListPreview($userName: String!, $status: MediaListStatus!, $withPreview: Boolean = true) {
    Page(page: 1, perPage: 30) {
      mediaList(userName: $userName, type: ANIME, status: $status, sort: UPDATED_TIME_DESC) {
        status progress updatedAt media { ...CardMediaFields }
      }
    }
  }
  ${CARD_MEDIA_FIELDS}`

// One collection can filter and return multiple statuses, already grouped and with each entry's
// authoritative status attached. Used by the Schedule Watchlist instead of two full-list requests.
export const LIST_STATUSES_QUERY = gql`
  query ListStatuses($userName: String!, $statuses: [MediaListStatus]) {
    MediaListCollection(userName: $userName, type: ANIME, status_in: $statuses, sort: UPDATED_TIME_DESC) {
      lists { entries { status progress updatedAt media { ...ContinueMediaFields } } }
    }
  }
  ${CONTINUE_MEDIA_FIELDS}`

export const READING_LIST_QUERY = gql`
  query ReadingLists($userName: String!, $status: MediaListStatus) {
    MediaListCollection(userName: $userName, type: MANGA, status: $status, sort: UPDATED_TIME_DESC) {
      lists { entries { progress updatedAt media { ...ReadingMediaFields } } }
    }
  }
  ${READING_MEDIA_FIELDS}`

// Mostly-id-only projection for the schedule's My Shows highlighting. The second collection adds
// a deliberately tiny card projection for CURRENT entries only: when an episode is postponed,
// AniList moves it out of this week's global schedule and this is the only media record left from
// which the schedule can restore a labelled placeholder. Planning/dropped lists stay id-only.
export const LIST_IDS_QUERY = gql`
  query ListIds($userName: String!, $statuses: [MediaListStatus]) {
    MediaListCollection(userName: $userName, type: ANIME, status_in: $statuses) {
      lists { entries { status media { id idMal } } }
    }
    current: MediaListCollection(userName: $userName, type: ANIME, status: CURRENT) {
      lists { entries { media {
        id idMal status
        title { romaji english native userPreferred }
        coverImage { extraLarge large medium color }
        nextAiringEpisode { episode airingAt timeUntilAiring }
      } } }
    }
  }`

// `updatedAt` is AniList's list-entry edit time in EPOCH SECONDS (×1000 for ms); used to order the
// Continue-Watching row across trackers + local history. Optional so older callers/mocks stay valid.
export interface Entry { media: Media; progress: number; updatedAt?: number; status?: string }
interface Coll { MediaListCollection?: { lists?: { entries?: Entry[] }[] } }
export function flattenEntries(data: Coll | undefined): Entry[] {
  const byId = new Map<number, Entry>()
  for (const entry of (data?.MediaListCollection?.lists ?? []).flatMap((list) => list.entries ?? [])) {
    const previous = byId.get(entry.media.id)
    if (!previous || (entry.updatedAt ?? 0) > (previous.updatedAt ?? 0)) byId.set(entry.media.id, entry)
  }
  return [...byId.values()]
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
