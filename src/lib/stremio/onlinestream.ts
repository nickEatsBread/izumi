import type { Stream } from './parse'
import { titleTokens } from './relevance'

// Seanime onlinestream-provider SDK shapes (github.com/5rahim/seanime,
// internal/extension/hibike/onlinestream/types.go). Fields we consume.
export interface SnSearchResult { id: string; title: string; url?: string; subOrDub?: string }
export interface SnEpisode { id: string; number: number; url?: string; title?: string }
export interface SnVideoSource { url: string; type?: string; quality?: string; subtitles?: { url: string; lang?: string }[] }
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
  vs: SnVideoSource, server: string, headers: Record<string, string>, provider: string, epTitle?: string,
): Stream {
  const quality = vs.quality || 'auto'
  return {
    url: vs.url,
    name: `⚡ ${provider} · ${server} · ${quality}`,
    __stream: true,
    __headers: headers,
    __subtitles: vs.subtitles ?? [],
    behaviorHints: { filename: `${epTitle ? epTitle + ' ' : ''}${quality}`.trim() },
  }
}
