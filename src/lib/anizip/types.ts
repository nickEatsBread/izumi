export interface AniZipEpisode {
  image?: string
  title?: Record<string, string>
  rating?: string
  overview?: string
  summary?: string
  airDate?: string
  runtime?: number
  length?: number
  tvdbId?: number // TVDB EPISODE id (per-episode, distinct from the show id)
  seasonNumber?: number // TVDB season this episode belongs to
  episodeNumber?: number // per-season episode number
  absoluteEpisodeNumber?: number // TVDB absolute number across the whole series
}
export interface AniZipResponse {
  episodes?: Record<string, AniZipEpisode>
  episodeCount?: number
  // Cross-reference ids. Production-SPECIFIC — a 2026 series and a 1995 film that share a
  // title have DIFFERENT anidb_id/thetvdb_id — so id-based source resolution can't mix them.
  mappings?: {
    kitsu_id?: number
    mal_id?: number
    anidb_id?: number
    thetvdb_id?: number
    imdb_id?: string | null
    themoviedb_id?: string | null
  }
}
export interface EpMeta {
  image?: string
  title?: string
  rating?: number
  overview?: string
  season?: number
  abs?: number
}
