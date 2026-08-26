import { get } from 'svelte/store'
import { anilist } from './client'
import { LIST_IDS_QUERY } from './lists'
import { getMalAnimeIds } from '$lib/trackers'
import { getKitsuAnimeIds } from '$lib/trackers/kitsu'
import { getSimklAnimeIds } from '$lib/trackers/simkl'
import { localHistory } from '$lib/player/history'
import type { Media } from './types'

// "My shows" = the set the personalized schedule filters/highlights to. Built from three sources so
// it works with a linked tracker OR none at all:
//   - AniList list: CURRENT (watching) + PLANNING (keyed by media.id)
//   - MAL list: watching + plan_to_watch (keyed by idMal — the weekly airings carry media.idMal, so
//     no MAL→AniList id mapping is needed)
//   - Kitsu/Simkl lists (mapped to canonical AniList ids)
//   - Local watch history (keyed by media.id) — covers "something you're watching right now" with no
//     tracker linked.
// Dropped lists are loaded too, but only as a VETO on the local-history source: dropping a show is a
// tracker edit, and local history has no way to learn about it, so a dropped title used to keep
// airing on the schedule forever just because it had been played on this device once.
export type MineKind = 'watching' | 'planning'

export interface MySets {
  aniWatching: Set<number>   // AniList media ids
  aniPlanning: Set<number>
  aniDropped: Set<number>
  malWatching: Set<number>   // MAL idMals
  malPlanning: Set<number>
  malDropped: Set<number>
  local: Set<number>         // media ids from on-device history
}

export const emptyMySets = (): MySets => ({
  aniWatching: new Set(), aniPlanning: new Set(), aniDropped: new Set(),
  malWatching: new Set(), malPlanning: new Set(), malDropped: new Set(),
  local: new Set(),
})

/** Is this title on a tracker's Dropped list? */
export function isDropped(m: Media, s: MySets): boolean {
  return s.aniDropped.has(m.id) || (m.idMal != null && s.malDropped.has(m.idMal))
}

/** How a title relates to the viewer, or null if it isn't one of their shows. Local history counts as
 *  "watching" (you're actively watching it here) unless a tracker says you dropped it. An explicit
 *  Watching/Planning entry always wins over a Dropped one on the OTHER tracker — the drop only vetoes
 *  the implicit local-history signal, so a stale list on one service can't hide a live show. */
export function classifyMine(m: Media, s: MySets): MineKind | null {
  const { id, idMal } = m
  if (s.aniWatching.has(id) || (idMal != null && s.malWatching.has(idMal))) return 'watching'
  if (s.aniPlanning.has(id) || (idMal != null && s.malPlanning.has(idMal))) return 'planning'
  if (s.local.has(id) && !isDropped(m, s)) return 'watching'
  return null
}

export const isMine = (m: Media, s: MySets) => classifyMine(m, s) !== null

/** True if there's any source the personalized view could draw from (so we know to default to it). */
export function hasMySources(s: MySets): boolean {
  return s.aniWatching.size + s.aniPlanning.size + s.malWatching.size + s.malPlanning.size + s.local.size > 0
}

const ANI_STATUSES = ['CURRENT', 'PLANNING', 'DROPPED'] as const
type AniStatus = typeof ANI_STATUSES[number]
type IdColl = {
  MediaListCollection?: { lists?: { entries?: { status?: string; media: { id: number } }[] }[] }
}

export function splitAniListIds(data: IdColl | undefined): Record<AniStatus, Set<number>> {
  const out: Record<AniStatus, Set<number>> = {
    CURRENT: new Set(), PLANNING: new Set(), DROPPED: new Set(),
  }
  for (const entry of (data?.MediaListCollection?.lists ?? []).flatMap((list) => list.entries ?? [])) {
    if (ANI_STATUSES.includes(entry.status as AniStatus)) out[entry.status as AniStatus].add(entry.media.id)
  }
  return out
}

async function aniIds(userName: string | undefined): Promise<Record<AniStatus, Set<number>>> {
  if (!userName) return splitAniListIds(undefined)
  try {
    const r = await anilist.query(LIST_IDS_QUERY, { userName, statuses: ANI_STATUSES }).toPromise()
    return r.error ? splitAniListIds(undefined) : splitAniListIds(r.data as IdColl)
  } catch { return splitAniListIds(undefined) }
}

/** Load every "my shows" source concurrently. Best-effort — a failing/absent source just contributes
 *  an empty set. `userName` is the linked AniList handle (empty ⇒ AniList sources skipped). */
export async function loadMySets(userName: string | undefined): Promise<MySets> {
  const [ani, malW, malP, malD, kitsuW, kitsuP, kitsuD, simklW, simklP, simklD] = await Promise.all([
    aniIds(userName),
    getMalAnimeIds('watching', 500),
    getMalAnimeIds('plan_to_watch', 500),
    getMalAnimeIds('dropped', 500),
    getKitsuAnimeIds('current', 20),
    getKitsuAnimeIds('planned', 20),
    getKitsuAnimeIds('dropped', 20),
    getSimklAnimeIds('watching', 500),
    getSimklAnimeIds('plantowatch', 500),
    getSimklAnimeIds('dropped', 500),
  ])
  const local = new Set(Object.keys(get(localHistory)).map(Number))
  return {
    aniWatching: new Set([...ani.CURRENT, ...kitsuW, ...simklW]),
    aniPlanning: new Set([...ani.PLANNING, ...kitsuP, ...simklP]),
    aniDropped: new Set([...ani.DROPPED, ...kitsuD, ...simklD]),
    malWatching: new Set(malW), malPlanning: new Set(malP), malDropped: new Set(malD),
    local,
  }
}
