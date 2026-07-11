import type { Stream } from './parse'
import { titleTokens } from './relevance'
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { title } from '$lib/anilist/media'
import { preferredAudioLang } from '$lib/settings/ui'
import { runningStreamExtensions } from '$lib/extensions/manager'

// onlinestream-provider extension SDK shapes. Fields we consume.
export interface SnSearchResult { id: string; title: string; url?: string; subOrDub?: string }
export interface SnEpisode { id: string; number: number; url?: string; title?: string }
// Seanime VideoSubtitle is {url, language, isDefault}; providers vary (some emit `lang`/`label`/
// `default`), so accept them all and normalize in videoSourceToStream.
export interface SnVideoSubtitle { url: string; language?: string; lang?: string; label?: string; isDefault?: boolean; default?: boolean }
export interface SnVideoSource { url: string; type?: string; quality?: string; subtitles?: SnVideoSubtitle[] }
export interface SnEpisodeServer { server?: string; headers?: Record<string, string>; videoSources?: SnVideoSource[] }
export interface SnSettings { episodeServers?: string[]; supportsDub?: boolean }

/** Pick the search result whose title best overlaps the media's known titles (token
 *  intersection). Returns undefined if nothing overlaps (never guess a wrong show). */
export function pickSearchResult(results: SnSearchResult[], titles: string[]): SnSearchResult | undefined {
  const wanted = new Set(titles.flatMap((t) => titleTokens(t)))
  if (!wanted.size) return undefined
  let best: SnSearchResult | undefined
  let bestScore = 0
  for (const r of results) {
    const toks = titleTokens(r.title ?? '')
    const score = toks.filter((t) => wanted.has(t)).length
    if (score > bestScore) { bestScore = score; best = r }
  }
  return bestScore > 0 ? best : undefined
}

/** Find the episode entry whose number equals the requested episode. */
export function pickEpisode(eps: SnEpisode[], episode: number): SnEpisode | undefined {
  return eps.find((e) => e.number === episode)
}

/** Map one VideoSource (+ its server headers) to a direct streaming Stream. */
export function videoSourceToStream(
  vs: SnVideoSource, server: string, headers: Record<string, string>, provider: string,
  epTitle?: string, audio?: 'sub' | 'dub',
): Stream {
  const quality = vs.quality || 'auto'
  const kind = /m3u8|hls/i.test(vs.type ?? '') ? 'HLS' : 'MP4'
  return {
    url: vs.url,
    // `⚡` marks it instant-cached (isCached) and the `· quality` token feeds resolutionOf's
    // badge. The picker's HEADING comes from __addonName, not this name — without it the row
    // rendered as a generic "Source" (name has no `[XX]` bracket for describe() to sniff).
    name: `⚡ ${provider} · ${server} · ${quality}`,
    __stream: true,
    __headers: headers,
    __audio: audio,
    // Normalize the provider's subtitle shape: `language`/`lang`/`label` → lang, and carry
    // `isDefault` so the player auto-selects the intended track (both were being dropped).
    __subtitles: (vs.subtitles ?? []).map((s) => ({
      url: s.url,
      lang: s.language ?? s.lang ?? s.label,
      isDefault: s.isDefault ?? s.default ?? false,
    })),
    __addonName: provider,
    behaviorHints: { filename: epTitle?.trim() || `Direct ${kind}${server ? ` · ${server}` : ''}` },
  }
}

/** Resolve direct (non-debrid) streaming sources for an episode from every configured
 *  onlinestream-provider extension, in parallel. Best-effort: [] when none configured / all fail.
 *  Episode only (these providers are episode-indexed). */
export async function resolveOnlineStreams(media: Media, episode: number | undefined): Promise<Stream[]> {
  if (episode == null) return []
  const exts = await runningStreamExtensions()
  if (!exts.length) return []
  const titles = [title(media), media.title.romaji, media.title.english, ...(media.synonyms ?? [])]
    .filter((t): t is string => !!t && t.length > 1)
  const preferDub = get(preferredAudioLang) === 'eng'
  // Search + resolve the requested episode for one sub/dub pass. null = no match this pass.
  const findEp = async (ext: (typeof exts)[number], dub: boolean): Promise<SnEpisode | null> => {
    const results = (await ext.call('search', { query: titles[0], dub, year: media.seasonYear ?? undefined }).catch(() => null)) as SnSearchResult[] | null
    const best = pickSearchResult(results ?? [], titles)
    if (!best) return null
    const eps = (await ext.call('findEpisodes', best.id).catch(() => null)) as SnEpisode[] | null
    return pickEpisode(eps ?? [], episode) ?? null
  }
  const per = await Promise.all(exts.map(async (ext): Promise<Stream[]> => {
    try {
      // Preferred audio first (dub for English users), then fall back to sub — most anime is
      // sub-only, so forcing dub:true would return zero sources for those shows. Track which pass
      // won so each row can be tagged with its actual audio type.
      let ep = await findEp(ext, preferDub)
      let audio: 'sub' | 'dub' = preferDub ? 'dub' : 'sub'
      if (!ep && preferDub) { ep = await findEp(ext, false); audio = 'sub' }
      if (!ep) return []
      const settings = (await ext.call('getSettings').catch(() => null)) as SnSettings | null
      const servers = settings?.episodeServers?.length ? settings.episodeServers : ['default']
      // Aggregate EVERY server that returns sources (not first-server-wins) so the picker shows
      // all alternatives + a working fallback when one server's stream is dead. Dedupe by url.
      const out: Stream[] = []
      // Give the row a real label — anime title + episode (+ the provider's episode title when it's
      // more than a bare "Episode N") — instead of the provider's generic "Episode 01", so the
      // onlinestream row reads like the torrent rows do.
      const epName = ep.title?.trim()
      const hasRealTitle = !!epName && epName !== `Episode ${episode}` && epName !== String(episode)
      const epLabel = `${title(media)} — Episode ${episode}${hasRealTitle ? ` · ${epName}` : ''}`
      for (const server of servers) {
        const es = (await ext.call('findEpisodeServer', ep, server).catch(() => null)) as SnEpisodeServer | null
        if (es?.videoSources?.length) {
          for (const vs of es.videoSources) out.push(videoSourceToStream(vs, es.server ?? server, es.headers ?? {}, ext.name, epLabel, audio))
        }
      }
      const seen = new Set<string>()
      return out.filter((s) => { if (!s.url || seen.has(s.url)) return false; seen.add(s.url); return true })
    }
    catch { return [] }
  }))
  return per.flat()
}
