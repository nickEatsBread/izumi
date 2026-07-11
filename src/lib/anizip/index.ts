import { phttp } from '$lib/net/http'
import { get, set } from 'idb-keyval'
import type { AniZipResponse, EpMeta } from './types'

// AniZip episode titles use backticks in place of apostrophes ("I`m Luffy!") —
// normalize to a real apostrophe.
const cleanTitle = (t?: string) => t?.replace(/`/g, '’')

/** Convert a raw AniZip response into a `{ episodeNumber -> EpMeta }` map,
 *  dropping non-numeric keys (specials like `S1`). */
export function parseEpisodes(res: AniZipResponse | undefined): Record<number, EpMeta> {
  const out: Record<number, EpMeta> = {}
  for (const [k, e] of Object.entries(res?.episodes ?? {})) {
    const n = Number(k)
    if (!Number.isInteger(n)) continue
    out[n] = {
      image: e.image,
      title: cleanTitle(e.title?.en ?? e.title?.['x-jat']),
      rating: e.rating ? Number(e.rating) : undefined,
      overview: e.overview ?? e.summary,
      season: e.seasonNumber,
      abs: e.absoluteEpisodeNumber,
    }
  }
  return out
}

const key = (id: number) => `anizip-${id}`

/** Fetch (and idb-cache) the raw AniZip mappings response for an AniList id.
 *  Uses the Tauri HTTP plugin to avoid CORS/mixed-content issues. Reads the idb
 *  cache first; on a miss, fetches + caches. Best-effort: returns `undefined` on
 *  any error. Shared by both `getEpisodeMeta` and `getKitsuId` so they hit the
 *  same cache. */
export async function fetchAniZip(anilistId: number, wantEpisode?: number): Promise<AniZipResponse | undefined> {
  const cached = await get<AniZipResponse>(key(anilistId))
  // Serve from cache, EXCEPT when a specific episode is requested that the cached response predates.
  // Airing shows gain episodes over time and this cache has no TTL, so a stale entry would be missing
  // a freshly-aired episode's ids — refetch to pick them up.
  if (cached && (wantEpisode == null || cached.episodes?.[String(wantEpisode)])) return cached
  try {
    const r = await phttp(`https://api.ani.zip/mappings?anilist_id=${anilistId}`)
    if (!r.ok) return cached
    const j = (await r.json()) as AniZipResponse
    await set(key(anilistId), j)
    return j
  } catch {
    return cached
  }
}

/** Per-episode metadata (thumbnail/title/rating) for an AniList id.
 *  Best-effort: returns `{}` on any error. */
export async function getEpisodeMeta(anilistId: number): Promise<Record<number, EpMeta>> {
  return parseEpisodes(await fetchAniZip(anilistId))
}

/** The Kitsu id AniZip maps this AniList id to, if any. Used as a fallback when
 *  the Fribb id list misses. Reuses the same cache as `getEpisodeMeta`. */
export async function getKitsuId(anilistId: number): Promise<number | undefined> {
  const res = await fetchAniZip(anilistId)
  return res?.mappings?.kitsu_id
}

/** Production-specific ids for source extensions (some index by AniDB, others by TVDB).
 *  Resolved from the SAME AniZip response the season map uses, so no extra round-trip. Passing
 *  the AniDB anime id (+ absolute/season episode) lets an id-based extension resolve the RIGHT
 *  title and a freshly-aired episode with no dependency on the kitsu→imdb mapping having
 *  propagated (the reason the addon path misses new/ambiguous titles). Best-effort: `{}`. */
export interface ExtIds {
  anidbAid?: number
  anidbEid?: number // AniDB episode id
  tvdbId?: number // show id
  tvdbEId?: number // episode id
  tmdbId?: string
  imdbId?: string
  season?: number
  absoluteEpisodeNumber?: number
}
export async function getExtensionIds(anilistId: number, episode?: number): Promise<ExtIds> {
  const res = await fetchAniZip(anilistId, episode)
  const m = res?.mappings
  const ep = episode != null ? res?.episodes?.[String(episode)] : undefined
  return {
    anidbAid: m?.anidb_id,
    anidbEid: ep?.anidbEid,
    tvdbId: m?.thetvdb_id,
    tvdbEId: ep?.tvdbId,
    tmdbId: m?.themoviedb_id ?? undefined,
    imdbId: m?.imdb_id ?? undefined,
    season: ep?.seasonNumber,
    absoluteEpisodeNumber: ep?.absoluteEpisodeNumber,
  }
}

/** Compact `{ episode -> { season, abs } }` map used by the stream season-verifier.
 *  Torrentio numbers a Kitsu entry's episodes sequentially against TVDB and spills
 *  into the next season once an episode exceeds the mapped season's length; pairing
 *  the requested episode with its AniZip season/absolute number lets us de-rank any
 *  returned file whose parsed season/number disagrees. Best-effort: `{}` on error. */
export async function getEpisodeSeasonMap(anilistId: number): Promise<Record<number, { season?: number; abs?: number }>> {
  const m = parseEpisodes(await fetchAniZip(anilistId))
  const out: Record<number, { season?: number; abs?: number }> = {}
  for (const [k, e] of Object.entries(m)) out[Number(k)] = { season: e.season, abs: e.abs }
  return out
}
