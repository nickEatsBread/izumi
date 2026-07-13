import { get } from 'svelte/store'
import { anilist } from './client'
import { LIST_QUERY, flattenEntries } from './lists'
import { getMalAnimeIds } from '$lib/trackers'
import { localHistory } from '$lib/player/history'
import type { Media } from './types'

// "My shows" = the set the personalized schedule filters/highlights to. Built from three sources so
// it works with a linked tracker OR none at all:
//   - AniList list: CURRENT (watching) + PLANNING (keyed by media.id)
//   - MAL list: watching + plan_to_watch (keyed by idMal — the weekly airings carry media.idMal, so
//     no MAL→AniList id mapping is needed)
//   - Local watch history (keyed by media.id) — covers "something you're watching right now" with no
//     tracker linked.
export type MineKind = 'watching' | 'planning'

export interface MySets {
  aniWatching: Set<number>   // AniList media ids
  aniPlanning: Set<number>
  malWatching: Set<number>   // MAL idMals
  malPlanning: Set<number>
  local: Set<number>         // media ids from on-device history
}

export const emptyMySets = (): MySets => ({
  aniWatching: new Set(), aniPlanning: new Set(), malWatching: new Set(), malPlanning: new Set(), local: new Set(),
})

/** How a title relates to the viewer, or null if it isn't one of their shows. Local history counts as
 *  "watching" (you're actively watching it here). */
export function classifyMine(m: Media, s: MySets): MineKind | null {
  const { id, idMal } = m
  if (s.aniWatching.has(id) || s.local.has(id) || (idMal != null && s.malWatching.has(idMal))) return 'watching'
  if (s.aniPlanning.has(id) || (idMal != null && s.malPlanning.has(idMal))) return 'planning'
  return null
}

export const isMine = (m: Media, s: MySets) => classifyMine(m, s) !== null

/** True if there's any source the personalized view could draw from (so we know to default to it). */
export function hasMySources(s: MySets): boolean {
  return s.aniWatching.size + s.aniPlanning.size + s.malWatching.size + s.malPlanning.size + s.local.size > 0
}

async function aniIds(userName: string | undefined, status: string): Promise<Set<number>> {
  if (!userName) return new Set()
  try {
    const r = await anilist.query(LIST_QUERY, { userName, status }).toPromise()
    if (r.error) return new Set()
    return new Set(flattenEntries(r.data).map((e) => e.media.id))
  } catch { return new Set() }
}

/** Load every "my shows" source concurrently. Best-effort — a failing/absent source just contributes
 *  an empty set. `userName` is the linked AniList handle (empty ⇒ AniList sources skipped). */
export async function loadMySets(userName: string | undefined): Promise<MySets> {
  const [aniWatching, aniPlanning, malW, malP] = await Promise.all([
    aniIds(userName, 'CURRENT'),
    aniIds(userName, 'PLANNING'),
    getMalAnimeIds('watching', 500),
    getMalAnimeIds('plan_to_watch', 500),
  ])
  const local = new Set(Object.keys(get(localHistory)).map(Number))
  return { aniWatching, aniPlanning, malWatching: new Set(malW), malPlanning: new Set(malP), local }
}
