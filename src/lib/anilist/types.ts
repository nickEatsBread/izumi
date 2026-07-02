export interface Media {
  id: number
  idMal?: number
  title: { romaji?: string; english?: string; native?: string; userPreferred?: string }
  description?: string
  season?: string
  seasonYear?: number
  format?: string
  status?: string
  episodes?: number
  duration?: number
  averageScore?: number
  genres?: string[]
  coverImage?: { extraLarge?: string; medium?: string; color?: string }
  bannerImage?: string
  trailer?: { id?: string; site?: string } | null
  nextAiringEpisode?: { episode: number; timeUntilAiring: number } | null
}
