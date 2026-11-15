import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import { fetchManifest, type AddonManifest } from './manifest'
import { getExtensionIds, getKitsuId, type ExtIds } from '$lib/anizip'
import { getIndex, lookupKitsu } from './idmap'
import { kitsuIdFromLinks } from './kitsu'
import { anilistIdOf, externalIdsOf, kitsuIdOf as catalogKitsuId } from '$lib/catalog/identity'
import { buildStreamIds } from './stream-ids'
import { addonResourceUrl } from './resource-url'
import { preferredSubLang, enabledSubtitleProviders } from '$lib/settings/ui'
import { createOpenSubtitles } from './subtitles/opensubtitles'
import { createSubDL } from './subtitles/subdl'
import { createJimaku } from './subtitles/jimaku'
import type { SubQuery, SubtitleCandidate, SubtitleProvider } from './subtitles/types'
import type { Media } from '$lib/anilist/types'
import { invoke } from '@tauri-apps/api/core'

// External subtitles from a Stremio SUBTITLE addon (OpenSubtitles et al). Unlike sibling files inside
// a torrent, these are fetched from a subtitle provider by the video's id + filename, so they work
// regardless of the debrid provider. Any addon in the user's list whose manifest advertises the
// `subtitles` resource is queried; stream-only addons (Torrentio) are skipped.

export interface ExternalSubtitle { url: string; lang?: string; id?: string }

/** The `subtitles` resource of a manifest (with its id-prefixes), or null if the addon lacks one. */
function subtitleResource(m: AddonManifest | null): { idPrefixes?: string[] } | null {
  for (const r of m?.resources ?? []) {
    if (typeof r === 'string') { if (r === 'subtitles') return { idPrefixes: m?.idPrefixes } }
    // An object resource without its own idPrefixes accepts every id (Stremio's rule).
    else if (r.name === 'subtitles') return { idPrefixes: r.idPrefixes }
  }
  return null
}

/** Pick the video id an addon will understand from the candidates, keyed on its declared idPrefixes.
 *  Prefer a prefix the addon explicitly lists (the meta's own video id first, as Stremio asks with
 *  it); else default to the video id, then imdb (OpenSubtitles), then kitsu. */
export function pickSubtitleId(prefixes: string[] | undefined, imdbVid?: string, kitsuVid?: string, directVid?: string): string | undefined {
  const has = (v?: string) => !!v && !!prefixes?.some((p) => v.startsWith(p))
  if (has(directVid)) return directVid
  if (has(imdbVid)) return imdbVid
  if (has(kitsuVid)) return kitsuVid
  return directVid ?? imdbVid ?? kitsuVid
}

async function kitsuIdOf(media: Media): Promise<number | undefined> {
  const direct = catalogKitsuId(media)
  if (direct) return direct
  // Catalog items carry a negative synthetic id, which is no AniList id.
  const anilist = anilistIdOf(media)
  try {
    const idx = await getIndex()
    return (anilist ? lookupKitsu(idx, anilist) ?? (await getKitsuId(anilist)) : undefined)
      ?? (await kitsuIdFromLinks({ anilist, mal: media.idMal })) ?? undefined
  } catch { return undefined }
}

/** preferredSubLang is an ISO-639-2 audio/sub code ('eng'/'jpn'/'none'); the subtitle REST APIs want
 *  ISO-639-1. Map it and always include English as a fallback so a match still surfaces when the
 *  preferred language has none (external candidates are manually picked, so extra rows are harmless). */
const ISO1: Record<string, string> = { eng: 'en', jpn: 'ja' }
function queryLanguages(): string[] {
  const code = ISO1[get(preferredSubLang)]
  return !code || code === 'en' ? ['en'] : [code, 'en']
}

/** Resolve the ids for one episode into the shared SubQuery each provider consumes. */
export interface SubtitleVideo {
  url?: string
  size?: number
  hash?: string
  headers?: Record<string, string>
}

async function movieHashOf(video?: SubtitleVideo): Promise<string | undefined> {
  if (/^[0-9a-f]{16}$/i.test(video?.hash ?? '')) return video!.hash!.toLowerCase()
  if (!video?.url || !/^https?:\/\//i.test(video.url) || !Number.isSafeInteger(video.size) || video.size! < 131072) return undefined
  return invoke<string>('opensubtitles_moviehash', {
    url: video.url,
    size: video.size,
    headers: video.headers,
  }).catch(() => undefined)
}

/** The add-on path's extra fields: the video ids the stream request used, the meta's own type and
 *  the played file's size (Stremio's `videoSize` extra; `moviehash` is its `videoHash`). */
interface AddonSubQuery extends SubQuery {
  metaType?: string
  /** The Stremio meta's own video id. */
  directVid?: string
  /** IMDb id, as a season:episode triple only when a mapping named both. */
  imdbVid?: string
  /** Kitsu id with the AniList episode. */
  kitsuVid?: string
  videoSize?: number
}

/** Resolve ids and the exact OpenSubtitles byte hash concurrently. */
async function buildSubQuery(media: Media, episode: number | undefined, filename?: string, video?: SubtitleVideo): Promise<AddonSubQuery> {
  const type = media.catalog?.type === 'movie' || media.format === 'MOVIE' ? 'movie' : 'series'
  const anilistId = anilistIdOf(media)
  const [ids, kitsu, moviehash] = await Promise.all([
    anilistId ? getExtensionIds(anilistId, episode).catch(() => ({} as ExtIds)) : ({} as ExtIds),
    kitsuIdOf(media),
    movieHashOf(video),
  ])
  // Same ids as play.ts's stream request: primaryStreamIds + the aligned-imdb wave (mediaExtensionIds).
  const v = episode == null ? media.videos?.[0] : media.videos?.find((x) => x.number === episode) ?? media.videos?.[episode - 1]
  const native = media.catalog?.provider === 'stremio' ? media.catalog.resourceType?.trim() : ''
  return {
    type,
    imdbId: ids.imdbId,
    parentImdbId: ids.imdbId,
    tmdbId: ids.tmdbId,
    kitsuId: kitsu != null ? String(kitsu) : undefined,
    anilistId: media.id,
    season: ids.season,
    episode,
    filename,
    moviehash,
    moviebytesize: moviehash ? video?.size : undefined,
    languages: queryLanguages(),
    metaType: native && /^[A-Za-z0-9._-]{1,80}$/.test(native) ? native : type,
    directVid: media.catalog?.provider === 'stremio' ? v?.id : undefined,
    imdbVid: buildStreamIds({
      type, imdb: ids.imdbId ?? externalIdsOf(media).imdb,
      season: v?.season ?? ids.season, imdbEpisode: v?.episode ?? ids.episodeNumber,
    })[0],
    kitsuVid: buildStreamIds({ type, kitsu, episode })[0],
    videoSize: Number.isSafeInteger(video?.size) && video!.size! > 0 ? video!.size : undefined,
  }
}

/** The Stremio subtitle addons as one uniform provider. Behaviour matches the pre-aggregator fan-out:
 *  per-addon manifest guard → pickSubtitleId → phttp GET → map to url-bearing candidates. Cross-addon
 *  duplicates are left for mergeCandidates to collapse. */
export function createAddonProvider(bases: string[]): SubtitleProvider {
  return {
    id: 'addon',
    async search(q: AddonSubQuery): Promise<SubtitleCandidate[]> {
      if (!bases.length) return []
      const { directVid, imdbVid, kitsuVid } = q
      if (!directVid && !imdbVid && !kitsuVid) return []
      // Stremio's subtitle extras, in its order.
      const extra = Object.entries({ videoHash: q.moviehash, videoSize: q.videoSize, filename: q.filename })
        .filter(([, value]) => value != null && value !== '')
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')

      const perAddon = await Promise.all(bases.map(async (base): Promise<SubtitleCandidate[]> => {
        const sub = subtitleResource(await fetchManifest(base).catch(() => null))
        if (!sub) return []
        const id = pickSubtitleId(sub.idPrefixes, imdbVid, kitsuVid, directVid)
        if (!id) return []
        try {
          const r = await phttp(addonResourceUrl(base, `/subtitles/${q.metaType ?? q.type}/${encodeURIComponent(id)}${extra ? `/${extra}` : ''}.json`))
          if (!r.ok) return []
          const j = await r.json() as { subtitles?: { id?: string; url?: string; lang?: string }[] }
          return (j.subtitles ?? []).filter((s) => !!s.url)
            .map((s): SubtitleCandidate => ({ provider: 'addon', url: s.url!, lang: s.lang, id: s.id }))
        } catch { return [] }
      }))
      return perAddon.flat()
    },
  }
}

/** The enabled direct-REST providers (OpenSubtitles / SubDL / Jimaku) for this search. */
function externalProviders(): SubtitleProvider[] {
  const out: SubtitleProvider[] = []
  for (const id of get(enabledSubtitleProviders)) {
    if (id === 'opensubtitles') out.push(createOpenSubtitles())
    else if (id === 'subdl') out.push(createSubDL())
    else if (id === 'jimaku') out.push(createJimaku())
  }
  return out
}

/** Flatten + dedupe candidate lists: url-bearing rows (addons) dedupe on url; needsFetch rows dedupe
 *  on provider + fileId/zipUrl/fileUrl, so the same OpenSubtitles file, SubDL zip or Jimaku file
 *  never lists twice. */
export function mergeCandidates(lists: SubtitleCandidate[][]): SubtitleCandidate[] {
  const seen = new Set<string>()
  const out: SubtitleCandidate[] = []
  for (const c of lists.flat()) {
    const key = c.url
      ? `url:${c.url}`
      : `${c.provider}:${c.download?.fileId ?? c.download?.zipUrl ?? c.download?.fileUrl ?? c.id ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

/** Fetch external subtitles for an episode from every enabled provider (addons + OpenSubtitles/SubDL),
 *  in parallel. Best-effort — each provider resolves [] on failure and the aggregator never throws.
 *  Returns a deduped candidate list; the caller partitions on `download?.needsFetch`. */
export async function fetchExternalSubtitles(
  bases: string[],
  media: Media,
  episode: number | undefined,
  filename?: string,
  video?: SubtitleVideo,
): Promise<SubtitleCandidate[]> {
  const q = await buildSubQuery(media, episode, filename, video)
  const providers: SubtitleProvider[] = [createAddonProvider(bases), ...externalProviders()]
  const results = await Promise.all(providers.map((p) => p.search(q).catch((): SubtitleCandidate[] => [])))
  return mergeCandidates(results)
}

/** Back-compat: addon-only, url-bearing subtitles (the pre-aggregator shape) for the eager at-load
 *  merge. Shares buildSubQuery + createAddonProvider with the aggregator — no duplicated addon loop. */
export async function fetchAddonSubtitles(
  bases: string[],
  media: Media,
  episode: number | undefined,
  filename?: string,
): Promise<ExternalSubtitle[]> {
  if (!bases.length) return []
  const q = await buildSubQuery(media, episode, filename)
  const cands = await createAddonProvider(bases).search(q).catch((): SubtitleCandidate[] => [])
  const seen = new Set<string>()
  return cands
    .filter((c) => !!c.url && (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .map((c) => ({ url: c.url!, lang: c.lang, id: c.id }))
}

/** Copy enabled portable search configuration into the private TV resolver profile. */
export function cloudSubtitleServices() {
  return externalProviders().flatMap(provider => provider.cloudConfiguration ? [provider.cloudConfiguration] : [])
}
