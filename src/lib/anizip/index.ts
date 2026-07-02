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

/** Fetch (and idb-cache) AniZip mappings for an AniList id, returning per-episode
 *  metadata. Uses the Tauri HTTP plugin to avoid CORS/mixed-content issues.
 *  Best-effort: returns `{}` on any error. */
export async function getEpisodeMeta(anilistId: number): Promise<Record<number, EpMeta>> {
  const cached = await get<AniZipResponse>(key(anilistId))
  if (cached) return parseEpisodes(cached)
  try {
    const r = await httpFetch(`https://api.ani.zip/mappings?anilist_id=${anilistId}`)
    if (!r.ok) return {}
    const j = (await r.json()) as AniZipResponse
    await set(key(anilistId), j)
    return parseEpisodes(j)
  } catch {
    return {}
  }
}
