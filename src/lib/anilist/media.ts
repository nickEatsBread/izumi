import { get } from 'svelte/store'
import { titleLanguage } from '$lib/settings/ui'
import type { Media } from './types'
import { catalogMediaHref } from '$lib/catalog/identity'

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

// Small grid/carousel cards (~152px, e.g. SmallCard/ContinueCard) were requesting `extraLarge`
// (~460px wide) via cover() — about 4x the pixels they display. `large` is AniList's mid-size asset,
// a better match for a small card; fall back to extraLarge then medium for snapshots fetched before
// `large` was added to the query (e.g. an older cwSnapshot in localStorage). Detail-page posters and
// the hero deliberately keep using cover() — they render at a size that wants the full asset.
/** AniList's cover fields are fixed assets, not hints: `extraLarge` is 460px wide, `large` 230px,
 *  `medium` 100px. */
const LARGE_COVER_W = 230
/** Past 2x the extra sharpness is not perceptible enough to justify quadrupling the bytes, which is
 *  the whole point of choosing here. A 3x phone therefore budgets as if it were 2x. */
const MAX_USEFUL_DPR = 2

/**
 * The smallest cover asset that still covers the pixels this card will actually paint.
 *
 * Density is what decides it, not platform: a 131px card on a 2.75x phone needs ~360 real pixels, so
 * it wants `extraLarge`, while the same card at 152px on a 1x monitor is served three times over by
 * `large`. Callers that cannot state a width (a fill-width card, a 16:9 fallback) get `extraLarge`,
 * because guessing small is the one mistake that shows.
 */
export function cardCover(m: Media, cssWidth = 0): string {
  const c = m.coverImage
  if (!c) return ''
  const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, MAX_USEFUL_DPR)
  const needed = cssWidth * dpr
  if (needed > 0 && needed <= LARGE_COVER_W) return c.large || c.extraLarge || c.medium || ''
  return c.extraLarge || c.large || c.medium || ''
}

const FORMATS: Record<string, string> = {
  TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA',
  ONA: 'ONA', MUSIC: 'Music', MANGA: 'Manga', NOVEL: 'Novel', ONE_SHOT: 'One Shot',
}
export const format = (m: Media) => (m.format ? FORMATS[m.format] ?? m.format : '')

// AniList formats that only ever belong to a reading title. They stand in for `type` on the
// trimmed projections that don't ask for it (the player's related-title strip is one), where an
// unrecognised manga would otherwise be sent to the anime route and come back "Not Found".
const READING_FORMATS = new Set(['MANGA', 'NOVEL', 'ONE_SHOT'])
/** Whether this is a manga/light novel rather than something playable. A declared `type` always
 *  wins; the format is only consulted when the record didn't carry one. */
export const isReadingMedia = (m: Media) =>
  m.type ? m.type === 'MANGA' : READING_FORMATS.has(m.format ?? '')

/** Reading media deliberately uses a separate information-only route. */
export const mediaHref = (m: Media) => m.catalog ? catalogMediaHref(m) : isReadingMedia(m) ? `/app/manga/${m.id}` : `/app/anime/${m.id}`

const STATUS: Record<string, string> = { RELEASING: 'Releasing', NOT_YET_RELEASED: 'Not Yet Released', FINISHED: 'Finished', CANCELLED: 'Cancelled', HIATUS: 'Hiatus' }
export const status = (m: Media) => (m.status ? STATUS[m.status] ?? m.status : '')

export const season = (m: Media) => (m.season && m.seasonYear ? `${m.season[0]}${m.season.slice(1).toLowerCase()} ${m.seasonYear}` : '')

/** Browse the exact AniList cour represented by a detail-page season label. */
export const seasonBrowseHref = (m: Media) => m.season && m.seasonYear
  ? `/app/search?season=${encodeURIComponent(m.season)}&year=${m.seasonYear}`
  : ''

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

// Episodes aired so far. nextAiringEpisode is authoritative when present (nextAiring-1),
// followed by actual past schedule nodes. A currently-airing MAL-only row has a planned total but
// no schedule data; that total must NOT be mistaken for aired episodes (it made every remaining
// future episode appear as "new"). Finished titles can safely use the total. Infinity means the
// aired count is unknown, so callers such as the watchlist don't claim a false number.
export const airedCount = (m: Media) => {
  if (m.nextAiringEpisode?.episode) return m.nextAiringEpisode.episode - 1
  const scheduled = lastAiredScheduled(m)
  if (scheduled) return scheduled
  if (m.status === 'NOT_YET_RELEASED') return 0
  if (m.status === 'RELEASING' || m.status === 'HIATUS') return Infinity
  return m.episodes ?? Infinity
}

/** Whether the viewer has an aired, unwatched episode available right now. When airing metadata is
 *  unavailable, an already-opened episode is the only local proof that the next number exists.
 *  Treating the unknown `Infinity` sentinel as an aired count made Continue Watching advertise
 *  unaired episodes from MAL-only/cached cards. */
export const hasAiredEpisodeToWatch = (
  m: Media,
  watched = m.mediaListEntry?.progress ?? 0,
  lastOpened?: number,
) => {
  const aired = airedCount(m)
  return Number.isFinite(aired) ? watched < aired : lastOpened != null && lastOpened > watched
}

// Resume episode = the one after `watched` (defaults to the tracked progress), capped
// to what's aired, floored at 1. Pass an explicit count when the progress lives outside
// mediaListEntry (e.g. a MyAnimeList-sourced row).
export const resumeEp = (m: Media, watched = m.mediaListEntry?.progress ?? 0) => {
  const aired = airedCount(m)
  return Math.max(1, Math.min(watched + 1, aired || 1))
}
