import type { Media } from './types'
export interface Airing { airingAt: number; episode: number; media: Media }
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

/** Local HH:MM airing time. */
export const airTime = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Has this episode already aired? `now` is injectable for tests. */
export const aired = (unix: number, now: number = Date.now()) => unix * 1000 <= now

/** Compact "still to air" countdown ('in 30m' / 'in 5h' / 'in 3d'); '' once aired. */
export function until(unix: number, now: number = Date.now()): string {
  const mins = Math.round((unix * 1000 - now) / 60_000)
  if (mins <= 0) return ''
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60)
  return h < 24 ? `in ${h}h` : `in ${Math.floor(h / 24)}d`
}
