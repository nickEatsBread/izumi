import { phttp } from '$lib/net/http'
import { get, set } from 'idb-keyval'
export interface MapEntry { anilist_id?: number; kitsu_id?: number; mal_id?: number; imdb_id?: string | string[]; tvdb_id?: number; season?: { tvdb?: number } }
export type Index = Map<number, MapEntry>
const seasonShares = new WeakMap<Index, Map<string, number>>()
const seasonKey = (e: MapEntry) => e.tvdb_id != null && e.season?.tvdb != null ? `${e.tvdb_id}:${e.season.tvdb}` : undefined
export function buildIndex(entries: MapEntry[]): Index {
  const m: Index = new Map()
  const shares = new Map<string, number>()
  for (const e of entries) {
    if (e.anilist_id != null) m.set(e.anilist_id, e)
    const key = seasonKey(e)
    if (key) shares.set(key, (shares.get(key) ?? 0) + 1)
  }
  seasonShares.set(m, shares)
  return m
}
export function lookupKitsu(idx: Index, anilistId: number): number | undefined {
  return idx.get(anilistId)?.kitsu_id
}
/** MAL id for a canonical AniList id. Kitsu's own mapping table lags new seasons by weeks, and a
 *  record without its MAL id is invisible to a MAL-tracked viewer (no list status, no watched
 *  marks, no "My Shows" membership), so every Kitsu-derived record fills this gap from here. */
export function lookupMal(idx: Index, anilistId: number): number | undefined {
  return idx.get(anilistId)?.mal_id
}
/** IMDb title for a canonical AniList id, when the list names exactly one. AniZip leaves it out for
 *  most airing shows, so IMDb-indexed add-ons were never asked for them; this list usually carries
 *  it weeks earlier. Several titles (a compilation, a split production) are not guessed between. */
export function lookupImdb(idx: Index, anilistId: number): string | undefined {
  const listed = idx.get(anilistId)?.imdb_id
  const ids = (Array.isArray(listed) ? listed : listed ? [listed] : []).filter((id) => /^tt\d+$/.test(id))
  return ids.length === 1 ? ids[0] : undefined
}
/** The TVDB season an entry has to itself. AniZip has no TVDB mapping for a brand-new show, so no
 *  episode of it carries a season; when no other entry lists the same TVDB season, that season
 *  starts at this entry's episode 1. A shared season (a split cour) is not guessed into. */
export function lookupTvdbSeason(idx: Index, anilistId: number): number | undefined {
  const entry = idx.get(anilistId)
  const key = entry && seasonKey(entry)
  return key && seasonShares.get(idx)?.get(key) === 1 ? entry?.season?.tvdb : undefined
}
const malIndexes = new WeakMap<Index, Map<number, number>>()
const kitsuIndexes = new WeakMap<Index, Map<number, number>>()
/** Reverse lookup for metadata providers such as Jikan, which identify titles by MAL id while the
 *  rest of Izumi deliberately keeps AniList ids canonical. Built lazily from the already-cached
 *  Fribb map so catalog fallback does not add another mapping download. */
export function lookupAnilistByMal(idx: Index, malId: number): number | undefined {
  let reverse = malIndexes.get(idx)
  if (!reverse) {
    reverse = new Map()
    for (const [anilistId, entry] of idx) {
      if (entry.mal_id != null && !reverse.has(entry.mal_id)) reverse.set(entry.mal_id, anilistId)
    }
    malIndexes.set(idx, reverse)
  }
  return reverse.get(malId)
}
/** Reverse lookup for Kitsu's JSON:API catalogue. */
export function lookupAnilistByKitsu(idx: Index, kitsuId: number): number | undefined {
  let reverse = kitsuIndexes.get(idx)
  if (!reverse) {
    reverse = new Map()
    for (const [anilistId, entry] of idx) {
      if (entry.kitsu_id != null && !reverse.has(entry.kitsu_id)) reverse.set(entry.kitsu_id, anilistId)
    }
    kitsuIndexes.set(idx, reverse)
  }
  return reverse.get(kitsuId)
}
const URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json'
const KEY = 'anime-id-map-v1', TS = 'anime-id-map-ts'
let cached: Index | null = null
// Coalesce concurrent callers. The map is a multi-megabyte download, and a play click landing
// while the boot pre-warm is still in flight started a SECOND full one — neither could see the
// other because the memo is only written at the end.
let inflight: Promise<Index> | null = null
/** The map when it is already in memory, else null. Lets browse rows enrich cards for free
 *  without triggering the multi-megabyte download on their own account. */
export const cachedIndex = (): Index | null => cached
export function getIndex(): Promise<Index> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) inflight = loadIndex().finally(() => { inflight = null })
  return inflight
}

/** The map if it is in memory or loads within `ms`, else null while the load carries on for the next
 *  caller. For optional enrichment on a latency-sensitive path: a stale cache re-downloads the whole
 *  list, and nothing optional should wait for that. */
export async function indexWithin(ms: number): Promise<Index | null> {
  if (cached) return cached
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms) })
  try { return await Promise.race([getIndex().catch(() => null), late]) }
  finally { clearTimeout(timer) }
}

async function loadIndex(): Promise<Index> {
  const ts = (await get<number>(TS)) ?? 0
  let data = await get<MapEntry[]>(KEY)
  if (!data || Date.now() - ts > 7 * 864e5) {
    // BACKGROUND lane: this is the largest download the app ever makes, and on a first-ever launch
    // it happens while the home page is still filling in. In the metadata lane it took a permit from
    // the very covers and queries the user is waiting on.
    try { data = await (await phttp(URL, { background: true })).json() as MapEntry[]; await set(KEY, data); await set(TS, Date.now()) }
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
