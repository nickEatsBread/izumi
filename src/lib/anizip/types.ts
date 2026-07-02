export interface AniZipEpisode {
  image?: string
  title?: Record<string, string>
  rating?: string
  overview?: string
  summary?: string
  airDate?: string
  runtime?: number
  length?: number
}
export interface AniZipResponse {
  episodes?: Record<string, AniZipEpisode>
  episodeCount?: number
}
export interface EpMeta {
  image?: string
  title?: string
  rating?: number
  overview?: string
}
