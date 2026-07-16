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
  settings?: Record<string, unknown>
}
