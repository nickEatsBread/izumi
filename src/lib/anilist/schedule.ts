import type { Media } from './types'
export interface Airing { airingAt: number; episode: number; media: Media }
export function weekRange(now: Date) {
  const d = new Date(now); const day = (d.getUTCDay() + 6) % 7 // Monday=0
  d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - day)
  const start = Math.floor(d.getTime() / 1000)
  return { start, end: start + 7 * 24 * 3600 }
}
export function groupByDay(items: Airing[], start: number): Airing[][] {
  const days: Airing[][] = Array.from({ length: 7 }, () => [])
  for (const it of items) { const i = Math.floor((it.airingAt - start) / (24 * 3600)); if (i >= 0 && i < 7) days[i].push(it) }
  return days
}
