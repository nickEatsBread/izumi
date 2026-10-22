import type { Media } from './types'
export interface Airing {
  airingAt: number
  episode: number
  media: Media
  /** A skipped slot restored from the delay timetable rather than a real airing. */
  delayPlaceholder?: boolean
  /** Provider calendars also carry movie premieres and season-aware TV episodes. */
  kind?: 'episode' | 'movie'
  source?: 'tmdb' | 'stremio' | 'trakt'
  season?: number
  providerEpisode?: number
  /** TMDB often supplies only a calendar date. Do not invent an exact airtime for it. */
  timeKnown?: boolean
  /** Short, factual explanation for a personalized movie match. */
  context?: string
  /** Provider-authored calendar meaning, such as a streaming release or series finale. */
  eventLabel?: string
}
// Week window anchored to the user's LOCAL Monday 00:00 (not UTC), so groupByDay's
// start-relative day index buckets airings into the columns the user actually sees in their
// timezone. Airing TIMES are already shown local (toLocaleTimeString in DayColumn).
export function weekRange(now: Date) {
  const d = new Date(now); const day = (d.getDay() + 6) % 7 // local Monday=0
  d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day)
  const start = Math.floor(d.getTime() / 1000)
  return { start, end: start + 7 * 24 * 3600 }
}
export function groupByDay(items: Airing[], start: number): Airing[][] {
  const days: Airing[][] = Array.from({ length: 7 }, () => [])
  for (const it of items) { const i = Math.floor((it.airingAt - start) / (24 * 3600)); if (i >= 0 && i < 7) days[i].push(it) }
  return days
}

/** One entry per show, episode and airing time: a schedule (or its backup) can list the same airing
 *  twice, and the lists keyed by it must never see a repeat. */
export function uniqueAirings(items: Airing[]): Airing[] {
  const seen = new Set<string>()
  return items.filter((airing) => {
    const key = `${airing.media?.id}-${airing.episode}-${airing.airingAt}`
    if (!airing.media || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The airings within [start, end), once each. */
export const airingsBetween = (items: Airing[], start: number, end: number): Airing[] =>
  uniqueAirings(items.filter((airing) => airing.airingAt >= start && airing.airingAt < end))

/** Local HH:MM airing time. */
export const airTime = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Has this episode already aired? `now` is injectable for tests. */
export const aired = (unix: number, now: number = Date.now()) => unix * 1000 <= now

export function scheduleItemLabel(item: Airing): string {
  if (item.eventLabel) return item.eventLabel
  if (item.kind === 'movie') return 'Movie premiere'
  if (item.season != null && item.providerEpisode != null) return `S${item.season} E${item.providerEpisode}`
  return `Episode ${item.episode}`
}

export const scheduleSourceLabel = (item: Airing): string => item.source === 'tmdb'
  ? 'TMDB'
  : item.source === 'stremio'
    ? 'Stremio'
    : item.source === 'trakt'
      ? 'Trakt'
      : ''

/** Compact "still to air" countdown ('in 30m' / 'in 5h' / 'in 3d'); '' once aired. */
export function until(unix: number, now: number = Date.now()): string {
  const mins = Math.round((unix * 1000 - now) / 60_000)
  if (mins <= 0) return ''
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60)
  return h < 24 ? `in ${h}h` : `in ${Math.floor(h / 24)}d`
}
