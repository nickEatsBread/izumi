import { fetch as httpFetch } from '@tauri-apps/plugin-http'
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
export async function getIndex(): Promise<Index> {
  if (cached) return cached
  const ts = (await get<number>(TS)) ?? 0
  let data = await get<MapEntry[]>(KEY)
  if (!data || Date.now() - ts > 7 * 864e5) {
    try { data = await (await httpFetch(URL)).json(); await set(KEY, data); await set(TS, Date.now()) }
    catch { data = data ?? [] }
  }
  cached = buildIndex(data!); return cached
}
