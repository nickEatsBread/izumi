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
  absoluteEpisodeNumber?: number
  // AniZip enrichment — production-specific ids (field names match the extension runtime so
  // extensions run unchanged). Some extensions index by AniDB, others by TVDB.
  anidbAid?: number
  tvdbId?: number // show id
  tvdbEId?: number // episode id
  tmdbId?: string
  imdbId?: string
  season?: number
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
