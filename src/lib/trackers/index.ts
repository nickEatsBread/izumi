import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { get } from 'svelte/store'
import { anilist } from '$lib/anilist/client'
import { gql } from '@urql/core'
import { anilistToken, malToken } from './config'
import type { Media } from '$lib/anilist/types'

export type AniStatus = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'REPEATING'
export function malStatus(s: AniStatus): string {
  return ({ CURRENT: 'watching', PLANNING: 'plan_to_watch', COMPLETED: 'completed', PAUSED: 'on_hold', DROPPED: 'dropped', REPEATING: 'watching' } as const)[s]
}

const SAVE = gql`mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress) { id progress status }
}`

const SET_STATUS = gql`mutation ($mediaId: Int, $status: MediaListStatus) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status) { id status }
}`

const TOGGLE_FAVOURITE = gql`mutation ($animeId: Int) {
  ToggleFavourite(animeId: $animeId) { anime { nodes { id } } }
}`

// Push progress+status to every connected tracker. Best-effort; never throws.
export async function updateProgress(media: Media, progress: number, status: AniStatus = 'CURRENT') {
  const results: string[] = []
  if (get(anilistToken)) {
    try { await anilist.mutation(SAVE, { mediaId: media.id, progress, status }).toPromise(); results.push('AniList') } catch { /* ignore */ }
  }
  if (get(malToken) && media.idMal) {
    try {
      await httpFetch(`https://api.myanimelist.net/v2/anime/${media.idMal}/my_list_status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${get(malToken)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status: malStatus(status), num_watched_episodes: String(progress) }).toString(),
      })
      results.push('MAL')
    } catch { /* ignore */ }
  }
  return results // which trackers were updated
}
// Set the list status (e.g. PLANNING to bookmark) on every connected tracker.
// Best-effort; never throws. Returns which trackers were updated.
export async function setStatus(media: Media, status: AniStatus) {
  const results: string[] = []
  if (get(anilistToken)) {
    try { await anilist.mutation(SET_STATUS, { mediaId: media.id, status }).toPromise(); results.push('AniList') } catch { /* ignore */ }
  }
  if (get(malToken) && media.idMal) {
    try {
      await httpFetch(`https://api.myanimelist.net/v2/anime/${media.idMal}/my_list_status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${get(malToken)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status: malStatus(status) }).toString(),
      })
      results.push('MAL')
    } catch { /* ignore */ }
  }
  return results
}

// Toggle the AniList favourite flag for a title (AniList only; MAL has no
// favourite endpoint). Requires an AniList token. Throws on failure so the UI
// can surface it / not flip its optimistic state.
export async function toggleFavourite(media: Media) {
  if (!get(anilistToken)) throw new Error('AniList not connected')
  await anilist.mutation(TOGGLE_FAVOURITE, { animeId: media.id }).toPromise()
}

export const anyTrackerConnected = () => !!(get(anilistToken) || get(malToken))
