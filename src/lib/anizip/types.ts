export interface AniZipEpisode {
  image?: string
  title?: Record<string, string>
  rating?: string
  overview?: string
  summary?: string
  airDate?: string
  runtime?: number
  length?: number
  seasonNumber?: number // TVDB season this episode belongs to
  episodeNumber?: number // per-season episode number
  absoluteEpisodeNumber?: number // TVDB absolute number across the whole series
}
export interface AniZipResponse {
  episodes?: Record<string, AniZipEpisode>
  episodeCount?: number
  mappings?: { kitsu_id?: number; mal_id?: number }
}
export interface EpMeta {
  image?: string
  title?: string
  rating?: number
  overview?: string
  season?: number
  abs?: number
}
