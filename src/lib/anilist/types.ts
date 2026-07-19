// A partial calendar date (AniList FuzzyDate). Any part may be absent. Reused by
// Media.startDate + the viewer's list-entry start/finish dates.
export type FuzzyDate = { year?: number; month?: number; day?: number }

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
  synonyms?: string[]
  startDate?: FuzzyDate | null
  studios?: { nodes?: { name: string }[] } | null
  coverImage?: { extraLarge?: string; medium?: string; color?: string }
  bannerImage?: string
  trailer?: { id?: string; site?: string } | null
  nextAiringEpisode?: { episode: number; timeUntilAiring: number } | null
  // Per-episode air schedule. AniList populates this on many OVAs/ONAs and adult titles
  // that never get a scalar `episodes` count, so it's our fallback source for the episode
  // total + aired count (see media.ts). airingAt is a unix timestamp in SECONDS.
  airingSchedule?: { nodes?: { episode: number; airingAt: number }[] } | null
  isFavourite?: boolean
  // The viewer's list entry. score is 0-100 (read via score(format: POINT_100), tracker-format
  // independent); repeat = rewatch count; startedAt/completedAt are the viewer's own dates.
  mediaListEntry?: { id?: number; progress?: number; status?: string; score?: number; repeat?: number; startedAt?: FuzzyDate | null; completedAt?: FuzzyDate | null } | null
  relations?: { edges: { relationType: string; node: Media }[] }
}
