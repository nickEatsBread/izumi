import { phttp } from '$lib/net/http'
import { fetchManifest, type AddonManifest } from './manifest'
import { getExtensionIds, getKitsuId } from '$lib/anizip'
import { getIndex, lookupKitsu } from './idmap'
import { kitsuIdFromMal } from './kitsu'
import type { Media } from '$lib/anilist/types'

// External subtitles from a Stremio SUBTITLE addon (OpenSubtitles et al). Unlike sibling files inside
// a torrent, these are fetched from a subtitle provider by the video's id + filename, so they work
// regardless of the debrid provider. Any addon in the user's list whose manifest advertises the
// `subtitles` resource is queried; stream-only addons (Torrentio) are skipped.

export interface ExternalSubtitle { url: string; lang?: string; id?: string }

/** The `subtitles` resource of a manifest (with its id-prefixes), or null if the addon lacks one. */
function subtitleResource(m: AddonManifest | null): { idPrefixes?: string[] } | null {
  for (const r of m?.resources ?? []) {
    if (typeof r === 'string') { if (r === 'subtitles') return { idPrefixes: m?.idPrefixes } }
    else if (r.name === 'subtitles') return { idPrefixes: r.idPrefixes ?? m?.idPrefixes }
  }
  return null
}

/** Pick the video id an addon will understand from the candidates, keyed on its declared idPrefixes.
 *  Prefer a prefix the addon explicitly lists; else default to imdb (OpenSubtitles), else kitsu. */
export function pickSubtitleId(prefixes: string[] | undefined, imdbVid?: string, kitsuVid?: string): string | undefined {
  const has = (v?: string) => !!v && !!prefixes?.some((p) => v.startsWith(p))
  if (has(imdbVid)) return imdbVid
  if (has(kitsuVid)) return kitsuVid
  return imdbVid ?? kitsuVid
}

async function kitsuIdOf(media: Media): Promise<number | undefined> {
  try {
    const idx = await getIndex()
    return lookupKitsu(idx, media.id) ?? (await getKitsuId(media.id)) ?? (await kitsuIdFromMal(media.idMal)) ?? undefined
  } catch { return undefined }
}

function normBase(base: string): string {
  let b = base.trim().replace(/^http:\/\//i, 'https://').replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '')
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b
  return b
}

/** Fetch external subtitles for an episode from every subtitle-capable addon, in parallel. Best-effort
 *  ([] on any failure). `filename` (the release filename) is passed as Stremio `extra` — it's the main
 *  matching signal for hash-less debrid playback. Deduped by url. */
export async function fetchAddonSubtitles(
  bases: string[],
  media: Media,
  episode: number | undefined,
  filename?: string,
): Promise<ExternalSubtitle[]> {
  if (!bases.length) return []
  const type = media.format === 'MOVIE' ? 'movie' : 'series'
  const [ids, kitsu] = await Promise.all([getExtensionIds(media.id, episode), kitsuIdOf(media)])
  const imdbVid = ids.imdbId
    ? (type === 'series' ? `${ids.imdbId}:${ids.season ?? 1}:${episode ?? 1}` : ids.imdbId)
    : undefined
  const kitsuVid = kitsu != null ? (episode != null ? `kitsu:${kitsu}:${episode}` : `kitsu:${kitsu}`) : undefined
  if (!imdbVid && !kitsuVid) return []
  const extra = filename ? `/filename=${encodeURIComponent(filename)}` : ''

  const perAddon = await Promise.all(bases.map(async (base): Promise<ExternalSubtitle[]> => {
    const b = normBase(base)
    const sub = subtitleResource(await fetchManifest(b).catch(() => null))
    if (!sub) return []
    const id = pickSubtitleId(sub.idPrefixes, imdbVid, kitsuVid)
    if (!id) return []
    try {
      const r = await phttp(`${b}/subtitles/${type}/${encodeURIComponent(id)}${extra}.json`)
      if (!r.ok) return []
      const j = await r.json() as { subtitles?: { id?: string; url?: string; lang?: string }[] }
      return (j.subtitles ?? []).filter((s) => !!s.url).map((s) => ({ url: s.url!, lang: s.lang, id: s.id }))
    } catch { return [] }
  }))

  const seen = new Set<string>()
  return perAddon.flat().filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
}
