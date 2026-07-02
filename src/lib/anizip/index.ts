import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { get, set } from 'idb-keyval'
import type { AniZipResponse, EpMeta } from './types'

/** Convert a raw AniZip response into a `{ episodeNumber -> EpMeta }` map,
 *  dropping non-numeric keys (specials like `S1`). */
export function parseEpisodes(res: AniZipResponse | undefined): Record<number, EpMeta> {
  const out: Record<number, EpMeta> = {}
  for (const [k, e] of Object.entries(res?.episodes ?? {})) {
    const n = Number(k)
    if (!Number.isInteger(n)) continue
    out[n] = {
      image: e.image,
      title: e.title?.en ?? e.title?.['x-jat'],
      rating: e.rating ? Number(e.rating) : undefined,
      overview: e.overview ?? e.summary,
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
    const r = await httpFetch(`https://api.ani.zip/mappings?anilist_id=${anilistId}`)
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
