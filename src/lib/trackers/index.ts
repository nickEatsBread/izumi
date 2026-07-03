import { get } from 'svelte/store'
import { anilist } from '$lib/anilist/client'
import { gql } from '@urql/core'
import { anilistToken, malToken } from './config'
import { malFetch } from './mal-auth'
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
      const r = await malFetch(`https://api.myanimelist.net/v2/anime/${media.idMal}/my_list_status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status: malStatus(status), num_watched_episodes: String(progress) }).toString(),
      })
      if (r?.ok) results.push('MAL')
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
      const r = await malFetch(`https://api.myanimelist.net/v2/anime/${media.idMal}/my_list_status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status: malStatus(status) }).toString(),
      })
      if (r?.ok) results.push('MAL')
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

// Read the viewer's watched-episode count + list status for a title FROM MAL
// (v2 API). We already push to MAL in `updateProgress`; this is the read-back so
// progress shows even when the user tracks on MAL rather than AniList (AniList's
// `mediaListEntry` is null then). Returns null if MAL isn't connected, there's no
// idMal, the token is stale, or the title isn't on the user's list.
export async function getMalProgress(idMal?: number): Promise<{ progress: number; status: string } | null> {
  if (!get(malToken) || !idMal) return null
  try {
    const r = await malFetch(`https://api.myanimelist.net/v2/anime/${idMal}?fields=my_list_status`)
    if (!r?.ok) return null
    const j = await r.json() as { my_list_status?: { num_episodes_watched?: number; status?: string } }
    const s = j.my_list_status
    if (!s) return null
    return { progress: s.num_episodes_watched ?? 0, status: s.status ?? '' }
  }
  catch { return null }
}

// Fetch the viewer's MAL anime-list ids for a status (e.g. 'watching',
// 'plan_to_watch'), most-recently-updated first, so the home rows can show the
// MAL library for MAL-primary users. Returns [] if MAL isn't connected. Map these
// ids to AniList media via MEDIA_BY_MAL_QUERY to render cards.
export async function getMalAnimeIds(status: string, limit = 20): Promise<number[]> {
  if (!get(malToken)) return []
  try {
    const r = await malFetch(`https://api.myanimelist.net/v2/users/@me/animelist?status=${status}&sort=list_updated_at&limit=${limit}&fields=list_status`)
    if (!r?.ok) return []
    const j = await r.json() as { data?: { node?: { id?: number } }[] }
    return (j.data ?? []).map((d) => d.node?.id).filter((n): n is number => typeof n === 'number')
  }
  catch { return [] }
}

export const anyTrackerConnected = () => !!(get(anilistToken) || get(malToken))
