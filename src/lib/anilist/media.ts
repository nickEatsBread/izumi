import { get } from 'svelte/store'
import { titleLanguage } from '$lib/settings/ui'
import type { Media } from './types'

// Title in the user's preferred language (Settings → Interface). Romaji-first or English-first,
// each falling back to the other (then userPreferred) so a missing variant never shows 'TBA'.
// Reads the setting live; new titles pick up a change as you navigate/browse.
export const title = (m: Media) => {
  const t = m.title
  return get(titleLanguage) === 'english'
    ? t.english || t.romaji || t.userPreferred || 'TBA'
    : t.romaji || t.english || t.userPreferred || 'TBA'
}

export const banner = (m: Media) =>
  m.bannerImage
  || (m.trailer?.id && (!m.trailer.site || m.trailer.site === 'youtube') ? `https://i.ytimg.com/vi/${m.trailer.id}/maxresdefault.jpg` : undefined)
  || m.coverImage?.extraLarge || m.coverImage?.medium || ''

export const cover = (m: Media) => m.coverImage?.extraLarge || m.coverImage?.medium || ''

const FORMATS: Record<string, string> = { TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' }
export const format = (m: Media) => (m.format ? FORMATS[m.format] ?? m.format : '')

const STATUS: Record<string, string> = { RELEASING: 'Releasing', NOT_YET_RELEASED: 'Not Yet Released', FINISHED: 'Finished', CANCELLED: 'Cancelled', HIATUS: 'Hiatus' }
export const status = (m: Media) => (m.status ? STATUS[m.status] ?? m.status : '')

export const season = (m: Media) => (m.season && m.seasonYear ? `${m.season[0]}${m.season.slice(1).toLowerCase()} ${m.seasonYear}` : '')

export const ratingBg = (score?: number) => score == null ? 'bg-muted' : score >= 75 ? 'bg-green-700' : score >= 65 ? 'bg-orange-400' : 'bg-red-400'

// AniList leaves the scalar `episodes` (and often `nextAiringEpisode`) null on many
// OVAs/ONAs and adult titles that still carry a full per-episode airingSchedule. These
// two helpers read the episode count out of that schedule so such titles don't collapse
// to "no episodes" (e.g. a RELEASING OVA whose only signal is 4 aired schedule nodes).
const scheduleNodes = (m: Media) => m.airingSchedule?.nodes ?? []
// Highest episode number in the schedule that has already aired (0 if none aired).
const lastAiredScheduled = (m: Media) => {
  const now = Date.now() / 1000
  return scheduleNodes(m).reduce((max, n) => (n.airingAt <= now ? Math.max(max, n.episode) : max), 0)
}
// Highest episode number anywhere in the schedule, aired or not (0 if empty).
const lastScheduled = (m: Media) => scheduleNodes(m).reduce((max, n) => Math.max(max, n.episode), 0)

// Planned/known episode total: AniList's own count, else the airing schedule's highest
// episode, else the next-airing episode (an upcoming ep implies at least that many). 0
// only when nothing at all is known. Used everywhere an episode count is shown so a null
// AniList count falls back to the schedule instead of rendering '?' / 'TBA'.
export const totalEpisodes = (m: Media) =>
  m.episodes || lastScheduled(m) || m.nextAiringEpisode?.episode || 0

// Episodes aired so far. nextAiringEpisode is authoritative when present (nextAiring-1);
// otherwise fall back to the schedule's last-aired episode, then the planned total, then
// Infinity when nothing is known (so a resume episode is never clamped away).
export const airedCount = (m: Media) => {
  if (m.nextAiringEpisode?.episode) return m.nextAiringEpisode.episode - 1
  return lastAiredScheduled(m) || (m.episodes ?? Infinity)
}

/** Whether the viewer has an aired, unwatched episode available right now. */
export const hasAiredEpisodeToWatch = (m: Media, watched = m.mediaListEntry?.progress ?? 0) => watched < airedCount(m)

// Resume episode = the one after `watched` (defaults to the tracked progress), capped
// to what's aired, floored at 1. Pass an explicit count when the progress lives outside
// mediaListEntry (e.g. a MyAnimeList-sourced row).
export const resumeEp = (m: Media, watched = m.mediaListEntry?.progress ?? 0) => {
  const aired = airedCount(m)
  return Math.max(1, Math.min(watched + 1, aired || 1))
}
