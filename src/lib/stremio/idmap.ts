import { phttp } from '$lib/net/http'
import { get, set } from 'idb-keyval'
export interface MapEntry { anilist_id?: number; kitsu_id?: number; mal_id?: number }
export type Index = Map<number, MapEntry>
export function buildIndex(entries: MapEntry[]): Index {
  const m: Index = new Map()
  for (const e of entries) if (e.anilist_id != null) m.set(e.anilist_id, e)
  return m
}
export function lookupKitsu(idx: Index, anilistId: number): number | undefined {
  return idx.get(anilistId)?.kitsu_id
}
const URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json'
const KEY = 'anime-id-map-v1', TS = 'anime-id-map-ts'
let cached: Index | null = null
// Coalesce concurrent callers. The map is a multi-megabyte download, and a play click landing
// while the boot pre-warm is still in flight started a SECOND full one — neither could see the
// other because the memo is only written at the end.
let inflight: Promise<Index> | null = null
export function getIndex(): Promise<Index> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) inflight = loadIndex().finally(() => { inflight = null })
  return inflight
}

async function loadIndex(): Promise<Index> {
  const ts = (await get<number>(TS)) ?? 0
  let data = await get<MapEntry[]>(KEY)
  if (!data || Date.now() - ts > 7 * 864e5) {
    try { data = await (await phttp(URL)).json() as MapEntry[]; await set(KEY, data); await set(TS, Date.now()) }
    catch { data = data ?? [] }
  }
  // Only memoize a NON-EMPTY index. The catch above falls back to `[]` on a cold cache, and
  // caching that pinned an empty map for the rest of the session: every resolveKitsu then took two
  // extra round-trips per play click, and titles that only Fribb maps hard-failed with "No addon
  // mapping for this title" until restart. Leaving `cached` null lets the next call retry.
  const idx = buildIndex(data!)
  if (idx.size) cached = idx
  return idx
}
