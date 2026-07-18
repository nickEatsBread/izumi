import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import { fetchManifest, type AddonManifest } from './manifest'
import { getExtensionIds, getKitsuId } from '$lib/anizip'
import { getIndex, lookupKitsu } from './idmap'
import { kitsuIdFromMal } from './kitsu'
import { preferredSubLang, enabledSubtitleProviders } from '$lib/settings/ui'
import { createOpenSubtitles } from './subtitles/opensubtitles'
import { createSubDL } from './subtitles/subdl'
import type { SubQuery, SubtitleCandidate, SubtitleProvider } from './subtitles/types'
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

/** preferredSubLang is an ISO-639-2 audio/sub code ('eng'/'jpn'/'none'); the subtitle REST APIs want
 *  ISO-639-1. Map it and always include English as a fallback so a match still surfaces when the
 *  preferred language has none (external candidates are manually picked, so extra rows are harmless). */
const ISO1: Record<string, string> = { eng: 'en', jpn: 'ja' }
function queryLanguages(): string[] {
  const code = ISO1[get(preferredSubLang)]
  return !code || code === 'en' ? ['en'] : [code, 'en']
}

/** Resolve the ids for one episode into the shared SubQuery each provider consumes. */
async function buildSubQuery(media: Media, episode: number | undefined, filename?: string): Promise<SubQuery> {
  const type = media.format === 'MOVIE' ? 'movie' : 'series'
  const [ids, kitsu] = await Promise.all([getExtensionIds(media.id, episode), kitsuIdOf(media)])
  return {
    type,
    imdbId: ids.imdbId,
    parentImdbId: ids.imdbId,
    tmdbId: ids.tmdbId,
    kitsuId: kitsu != null ? String(kitsu) : undefined,
    season: ids.season,
    episode,
    filename,
    languages: queryLanguages(),
  }
}

/** The Stremio subtitle addons as one uniform provider. Behaviour matches the pre-aggregator fan-out:
 *  per-addon manifest guard → pickSubtitleId → phttp GET → map to url-bearing candidates. Cross-addon
 *  duplicates are left for mergeCandidates to collapse. */
export function createAddonProvider(bases: string[]): SubtitleProvider {
  return {
    id: 'addon',
    async search(q: SubQuery): Promise<SubtitleCandidate[]> {
      if (!bases.length) return []
      const imdbVid = q.imdbId
        ? (q.type === 'series' ? `${q.imdbId}:${q.season ?? 1}:${q.episode ?? 1}` : q.imdbId)
        : undefined
      const kitsuVid = q.kitsuId != null
        ? (q.episode != null ? `kitsu:${q.kitsuId}:${q.episode}` : `kitsu:${q.kitsuId}`)
        : undefined
      if (!imdbVid && !kitsuVid) return []
      const extra = q.filename ? `/filename=${encodeURIComponent(q.filename)}` : ''

      const perAddon = await Promise.all(bases.map(async (base): Promise<SubtitleCandidate[]> => {
        const b = normBase(base)
        const sub = subtitleResource(await fetchManifest(b).catch(() => null))
        if (!sub) return []
        const id = pickSubtitleId(sub.idPrefixes, imdbVid, kitsuVid)
        if (!id) return []
        try {
          const r = await phttp(`${b}/subtitles/${q.type}/${encodeURIComponent(id)}${extra}.json`)
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

/** The enabled direct-REST providers (OpenSubtitles / SubDL) for this search. */
function externalProviders(): SubtitleProvider[] {
  const out: SubtitleProvider[] = []
  for (const id of get(enabledSubtitleProviders)) {
    if (id === 'opensubtitles') out.push(createOpenSubtitles())
    else if (id === 'subdl') out.push(createSubDL())
  }
  return out
}

/** Flatten + dedupe candidate lists: url-bearing rows (addons) dedupe on url; needsFetch rows dedupe
 *  on provider + fileId/zipUrl, so the same OpenSubtitles file or SubDL zip never lists twice. */
export function mergeCandidates(lists: SubtitleCandidate[][]): SubtitleCandidate[] {
  const seen = new Set<string>()
  const out: SubtitleCandidate[] = []
  for (const c of lists.flat()) {
    const key = c.url
      ? `url:${c.url}`
      : `${c.provider}:${c.download?.fileId ?? c.download?.zipUrl ?? c.id ?? ''}`
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
): Promise<SubtitleCandidate[]> {
  const q = await buildSubQuery(media, episode, filename)
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
