// A partial calendar date (AniList FuzzyDate). Any part may be absent. Reused by
// Media.startDate + the viewer's list-entry start/finish dates.
export type FuzzyDate = { year?: number; month?: number; day?: number }

export interface MediaTag {
  name: string
  rank?: number
  isGeneralSpoiler?: boolean
  isMediaSpoiler?: boolean
}

/** The catalogue record that owns this media item. AniList records created before catalogue
 * switching intentionally omit this field and are treated as `anilist` by the identity helpers. */
export interface MediaCatalogIdentity {
  provider: 'anilist' | 'kitsu' | 'tmdb' | 'stremio'
  /** Provider-native id. Stremio ids include the add-on fingerprint and content type. */
  id: string
  type: 'anime' | 'manga' | 'movie' | 'series'
  /** Opaque fingerprint of the configured add-on that owns a Stremio meta item. Never a URL. */
  addonId?: string
}

/** Cross-database ids are optional capabilities, not the identity of the object. Consumers use
 * whichever namespace they understand (trackers, AniZip, Stremio stream add-ons, etc.). */
export interface ExternalMediaIds {
  anilist?: number
  mal?: number
  kitsu?: number
  tmdb?: number
  imdb?: string
  tvdb?: number
}

/** Provider-neutral playable unit. `number` is Izumi's stable, sequential episode number while
 * season/episode and id preserve the provider's addressing scheme for Stremio requests. */
export interface MediaVideo {
  id?: string
  number: number
  season?: number
  episode?: number
  title?: string
  overview?: string
  thumbnail?: string
  released?: string
}

export interface Media {
  /** Legacy numeric compatibility key used by existing persisted stores. For non-AniList media it
   * is a deterministic negative hash; `catalog` is always the authoritative identity. */
  id: number
  idMal?: number
  catalog?: MediaCatalogIdentity
  externalIds?: ExternalMediaIds
  videos?: MediaVideo[]
  type?: 'ANIME' | 'MANGA' | 'MOVIE' | 'SERIES'
  title: { romaji?: string; english?: string; native?: string; userPreferred?: string }
  description?: string
  season?: string
  seasonYear?: number
  format?: string
  status?: string
  episodes?: number
  chapters?: number
  volumes?: number
  duration?: number
  countryOfOrigin?: string
  source?: string
  averageScore?: number
  popularity?: number
  trending?: number
  genres?: string[]
  synonyms?: string[]
  startDate?: FuzzyDate | null
  studios?: { nodes?: { id?: number; name: string }[] } | null
  coverImage?: { extraLarge?: string; large?: string; medium?: string; color?: string }
  bannerImage?: string
  trailer?: { id?: string; site?: string } | null
  nextAiringEpisode?: { episode: number; airingAt?: number; timeUntilAiring: number } | null
  // Per-episode air schedule. AniList populates this on many OVAs/ONAs and adult titles
  // that never get a scalar `episodes` count, so it's our fallback source for the episode
  // total + aired count (see media.ts). airingAt is a unix timestamp in SECONDS.
  airingSchedule?: { nodes?: { episode: number; airingAt: number }[] } | null
  isFavourite?: boolean
  isAdult?: boolean
  // The viewer's list entry. score is 0-100 (read via score(format: POINT_100), tracker-format
  // independent); repeat = rewatch count; startedAt/completedAt are the viewer's own dates.
  mediaListEntry?: { id?: number; progress?: number; status?: string; score?: number; repeat?: number; startedAt?: FuzzyDate | null; completedAt?: FuzzyDate | null } | null
  relations?: { edges: { relationType: string; node: Media }[] }
  characters?: {
    edges: {
      role: string
      node: { id: number; name: { full?: string; native?: string }; image?: { large?: string } }
      voiceActors?: { id: number; name: { full?: string; native?: string }; image?: { large?: string } }[]
    }[]
  }
  staff?: {
    edges: {
      role: string
      node: { id: number; name: { full?: string; native?: string }; image?: { large?: string } }
    }[]
  }
  recommendations?: { nodes: { rating?: number; mediaRecommendation?: Media | null }[] }
  tags?: MediaTag[]
}
