import type { Media } from '$lib/anilist/types'

export interface MalAnimeListNode {
  id?: number
  title?: string
  main_picture?: { medium?: string; large?: string }
  alternative_titles?: { synonyms?: string[]; en?: string; ja?: string }
  start_date?: string
  mean?: number
  num_list_users?: number
  media_type?: string
  status?: string
  num_episodes?: number
  start_season?: { year?: number; season?: string }
  average_episode_duration?: number
  rating?: string
}

const FORMAT: Record<string, string> = {
  tv: 'TV', movie: 'MOVIE', ova: 'OVA', ona: 'ONA', special: 'SPECIAL', music: 'MUSIC',
}

const STATUS: Record<string, string> = {
  currently_airing: 'RELEASING',
  finished_airing: 'FINISHED',
  not_yet_aired: 'NOT_YET_RELEASED',
}

/** Build an ordinary Izumi card directly from the metadata embedded in MAL's list response.
 * AniList ids remain canonical for navigation/playback; callers resolve that id from the cached
 * MAL↔AniList map before invoking this mapper. */
export function mapMalAnimeListMedia(node: MalAnimeListNode, anilistId: number): Media {
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(node.start_date ?? '')
  const picture = node.main_picture ?? {}
  const alternatives = node.alternative_titles ?? {}
  return {
    id: anilistId,
    idMal: node.id,
    type: 'ANIME',
    title: {
      romaji: node.title,
      english: alternatives.en || undefined,
      native: alternatives.ja || undefined,
      userPreferred: alternatives.en || node.title || 'Unknown title',
    },
    season: node.start_season?.season?.toUpperCase(),
    seasonYear: node.start_season?.year ?? (date ? Number(date[1]) : undefined),
    format: node.media_type ? FORMAT[node.media_type] ?? node.media_type.toUpperCase() : undefined,
    status: node.status ? STATUS[node.status] ?? node.status.toUpperCase() : undefined,
    episodes: node.num_episodes || undefined,
    duration: node.average_episode_duration
      ? Math.max(1, Math.round(node.average_episode_duration / 60))
      : undefined,
    averageScore: node.mean ? Math.round(node.mean * 10) : undefined,
    popularity: node.num_list_users,
    synonyms: alternatives.synonyms ?? [],
    startDate: date
      ? { year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) }
      : null,
    coverImage: {
      extraLarge: picture.large,
      large: picture.large,
      medium: picture.medium ?? picture.large,
    },
    nextAiringEpisode: null,
    airingSchedule: { nodes: [] },
    isAdult: node.rating === 'rx',
  }
}
