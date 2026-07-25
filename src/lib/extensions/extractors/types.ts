// Shared contract for embed-host extractors — izumi's equivalent of the reference app's
// ExtractorApi/ExtractorLink. Providers hand us an embed URL and get back playable links plus any
// sidecar subtitles, so each provider no longer has to reimplement every host it links to.

/** A playable link produced by an extractor. */
export interface ExtractorLink {
  url: string
  /** Container hint the player uses to pick a demuxer. */
  type: 'm3u8' | 'mp4' | 'dash'
  /** Free-text quality label ('1080p', 'auto'); providers surface it in the picker row. */
  quality: string
  /** Request headers the CDN requires — almost always Referer, sometimes Origin. */
  headers: Record<string, string>
  /** Which extractor produced this, for the row label. */
  source: string
}

/** A sidecar subtitle an embed page advertised alongside the video. */
export interface ExtractorSubtitle {
  url: string
  /** Raw provider label; normalization to an ISO code happens later, in the stream layer. */
  label?: string
  headers?: Record<string, string>
}

export interface ExtractorResult {
  links: ExtractorLink[]
  subtitles: ExtractorSubtitle[]
}

/** Minimal fetch surface an extractor needs. Matches the Worker's bridged fetch, so extractors run
 *  with the same CORS-free, header-preserving client the providers use. */
export interface ExtractorFetch {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    ok: boolean
    status: number
    url?: string
    text: () => Promise<string>
    json: () => Promise<unknown>
  }>
}

export interface ExtractorContext {
  fetch: ExtractorFetch
  /** The page that linked to this embed. Most hosts 403 without it. */
  referer?: string
  /** Display name of the extension that asked, so a resolved link can be attributed to the
   *  provider that produced it rather than arriving anonymous. */
  extension?: string
}

/** A resolved embed in the shape a provider's `findEpisodeServer` must return, so a provider can
 *  hand back `$loadEpisodeServer(...)` directly. `server` is the extractor's own name, which is
 *  what the picker row shows next to the extension name. */
export interface EpisodeServerResult {
  server: string
  headers: Record<string, string>
  videoSources: {
    url: string
    type: 'm3u8' | 'mp4' | 'dash'
    quality: string
    subtitles: { url: string; language?: string; headers?: Record<string, string> }[]
  }[]
}

/** One embed host (or family of hosts). */
export interface Extractor {
  name: string
  /** Host suffixes this extractor claims, e.g. 'streamwish.to'. Matched against the URL's host. */
  hosts: string[]
  extract(url: string, ctx: ExtractorContext): Promise<ExtractorResult>
}

export const emptyResult = (): ExtractorResult => ({ links: [], subtitles: [] })
