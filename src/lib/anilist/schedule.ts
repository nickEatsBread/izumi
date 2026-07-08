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
