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
export async function fetchAniZip(anilistId: number): Promise<AniZipResponse | undefined> {
  const cached = await get<AniZipResponse>(key(anilistId))
  if (cached) return cached
  try {
    const r = await phttp(`https://api.ani.zip/mappings?anilist_id=${anilistId}`)
    if (!r.ok) return undefined
    const j = (await r.json()) as AniZipResponse
    await set(key(anilistId), j)
    return j
  } catch {
    return undefined
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
