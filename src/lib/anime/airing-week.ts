// A week of airings for Home's schedule-shaped blocks and rows. AniList answers it; while AniList is
// out the week comes from the Schedule page's backup timetable instead, read once per week for the
// session's next few minutes (it is a large page, and several blocks ask for the same week).
import type { Client } from '@urql/core'
import { markAniListDegraded, markCatalogProvider, shouldUseJikanCatalog } from '$lib/anilist/degraded'
import { weekRange, type Airing } from '$lib/anilist/schedule'
import { loadScheduleWeek } from '$lib/anilist/schedule-cache'
import { getWeeklySchedule } from './animeschedule'

const BACKUP_TTL_MS = 10 * 60_000
const WEEK = 7 * 24 * 3600
const backupWeeks = new Map<string, { at: number; week: Promise<Airing[]> }>()

function backupWeek(key: string): Promise<Airing[]> | undefined {
  const hit = backupWeeks.get(key)
  return hit && Date.now() - hit.at < BACKUP_TTL_MS ? hit.week : undefined
}

export async function loadAiringWeek(client: Client, start: number, end: number, signal?: AbortSignal): Promise<Airing[]> {
  const key = `${start}:${end}`
  // While AniList is known to be out, a week already read from the backup (or the backup itself) answers
  // without waiting on AniList's deadline again.
  if (!(backupWeek(key) || shouldUseJikanCatalog())) {
    try {
      return await loadScheduleWeek(client, start, end, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      markAniListDegraded(error instanceof Error ? error.message : String(error))
    }
  }
  // Read again: another block may have started this week's backup while AniList was failing.
  const fresh = backupWeek(key)
  if (fresh) return fresh
  // Not tied to one caller's signal: another block may be waiting on the same week.
  const week = getWeeklySchedule(start, end)
  backupWeeks.set(key, { at: Date.now(), week })
  week.then(() => markCatalogProvider('AnimeSchedule'), () => {
    if (backupWeeks.get(key)?.week === week) backupWeeks.delete(key)
  })
  return week
}

/** Episodes aired before `before` (Unix seconds), newest first, read a week at a time backwards
 *  until `count` are known or `weeks` weeks were read. */
export async function airedBefore(client: Client, before: number, count: number, weeks = 3, signal?: AbortSignal, keep: (airing: Airing) => boolean = () => true): Promise<Airing[]> {
  const aired: Airing[] = []
  let { start } = weekRange(new Date(before * 1000))
  for (let read = 0; read < weeks && aired.length < count; read++, start -= WEEK) {
    const week = await loadAiringWeek(client, start, start + WEEK, signal)
    aired.push(...week.filter((item) => item.media && item.airingAt < before && keep(item)).sort((a, b) => b.airingAt - a.airingAt))
  }
  return aired
}

/** Test seam. */
export function clearAiringWeeks(): void { backupWeeks.clear() }
