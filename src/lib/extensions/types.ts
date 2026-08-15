// Contracts shared with source extensions.

/** A torrent result returned by an extension's single()/batch()/movie(). The only
 *  load-bearing field for us is `hash` — we resolve it through Real-Debrid. */
export interface TorrentResult {
  title: string
  link?: string // magnet: URI or .torrent URL
  hash: string // 40-char btih infohash
  seeders?: number
  leechers?: number
  downloads?: number
  size?: number // bytes
  accuracy?: 'high' | 'medium' | 'low'
  type?: 'batch' | 'best' | 'alt'
  provider?: string // display name of the source extension that returned it (for the picker label)
  providerId?: string // stable extension id used for direct Continue Watching resolution
  logo?: string // icon URL/data of the source extension (for the picker logo)
}

/** The search context handed to an extension. The TorrentQuery shape
 *  (a scoped `fetch` is injected by the worker at call time). */
export interface TorrentQuery {
  anilistId?: number
  titles: string[]
  episode?: number
  episodeCount?: number
  resolution?: string
  exclusions?: string[]
  kitsuId?: number
  malId?: number
  absoluteEpisode?: number // absolute episode number (falls back to the per-season number)
  // AniZip enrichment — production-specific ids. Field names are the extension-SDK CONTRACT
  // (sources destructure exactly these), not our internal ExtIds names — see extToStreams.
  anidbAid?: number
  anidbEid?: number // AniDB episode id (episode-level; some indexers search by it)
  // Manifest-v2 and older source SDKs use different names for these ids; the query builder sends
  // both aliases for compatibility.
  tvdbId?: number
  tmdbId?: number | string
  absoluteEpisodeNumber?: number
  tvdbAid?: number // TVDB show id
  tvdbEid?: number // TVDB episode id
  mvdbAid?: number | string // TMDB id
  imdbAid?: string
  season?: number
  // SDK contract extras: the full AniList media object + raw AniZip mapping objects, passed
  // verbatim (sources may read production fields we don't distill), and the platform flag.
  media?: unknown
  mappingsA?: Record<string, unknown>
  mappingsE?: Record<string, unknown>
  isAndroid?: boolean
}

export function torrentQueryIdFields(ids: {
  anidbAid?: number
  anidbEid?: number
  tvdbId?: number
  tvdbEId?: number
  tmdbId?: number | string
  imdbId?: string
  season?: number
  absoluteEpisodeNumber?: number
}): Partial<TorrentQuery> {
  return {
    anidbAid: ids.anidbAid,
    anidbEid: ids.anidbEid,
    tvdbId: ids.tvdbId,
    tvdbAid: ids.tvdbId,
    tvdbEid: ids.tvdbEId,
    tmdbId: ids.tmdbId,
    mvdbAid: ids.tmdbId,
    imdbAid: ids.imdbId,
    season: ids.season,
    absoluteEpisode: ids.absoluteEpisodeNumber,
    absoluteEpisodeNumber: ids.absoluteEpisodeNumber,
  }
}

/** Normalized extension config (both flat config and manifest
 *  entries reduce to this). `code` is the resolved URL of the JS module. */
export interface ExtensionConfig {
  id: string
  name: string
  version?: string
  type?: string
  code: string // resolved https:// URL of the extension module
  icon?: string // base64 PNG or URL — shown in the settings card
  description?: string
  // Human language of the content the provider serves (ISO 639-1, e.g. 'fr'). NOT the manifest's
  // `language` field, which is the SOURCE-CODE language (javascript/typescript). Half the providers
  // in a typical catalog are non-English, and without this a French source is indistinguishable
  // from an English one until its subtitles show up on screen.
  lang?: string
  settings?: Record<string, unknown>
  /** Native `.izumi-ext` modules are already in Izumi's worker ABI and need no
   * Seanime/Miru compatibility transform before evaluation. */
  runtime?: 'izumi-js' | 'aniyomi-jvm'
  /** Validated package code returned by the native installer. Remote configs
   * leave this empty and fetch `code` as a URL. */
  moduleCode?: string
  signed?: boolean
}

/** Extension workers are an untyped runtime boundary. Accept numeric strings, but never let NaN,
 * negatives or fractional tracker values leak into ranking and dedupe comparisons. */
export function normalizeTorrentCount(value: unknown): number | undefined {
  const normalized = typeof value === 'string' ? value.replace(/,/g, '').trim() : value
  if (normalized === '') return undefined
  const number = Number(normalized)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined
}
