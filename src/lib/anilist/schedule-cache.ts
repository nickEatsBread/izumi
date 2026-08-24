import type { Client } from '@urql/core'
import { SCHEDULE_QUERY } from './detail-queries'
import type { Airing } from './schedule'

type PageData = {
  Page?: {
    airingSchedules?: Airing[]
    pageInfo?: { hasNextPage?: boolean }
  }
}

const cache = new Map<string, Airing[]>()
const inflight = new Map<string, Promise<Airing[]>>()
const keyOf = (start: number, end: number) => `${start}:${end}`
const SCHEDULE_DEADLINE_MS = 18_000

/** Session cache for schedule weeks. Requests deliberately survive ScheduleGrid unmounts: changing
 * week used to abort/remount the grid and throw away work which the next click immediately needed. */
export function loadScheduleWeek(client: Client, start: number, end: number): Promise<Airing[]> {
  const key = keyOf(start, end)
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(key)
  if (pending) return pending

  const request = (async () => {
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), SCHEDULE_DEADLINE_MS)
    const fetchPage = (page: number) => client.query<PageData>(
      SCHEDULE_QUERY,
      { start, end, page },
      { requestPolicy: 'network-only', fetchOptions: { signal: controller.signal } },
    ).toPromise()
    try {
      const first = await fetchPage(1)
      if (first.error) throw new Error(first.error.message)
      let current = first.data?.Page
      const all = [...(current?.airingSchedules ?? [])]
      // AniList documents total/lastPage as currently inaccurate. Follow the authoritative
      // hasNextPage flag so we neither skip a week tail nor fan out requests for phantom pages.
      for (let page = 2; current?.pageInfo?.hasNextPage && page <= 12; page++) {
        const result = await fetchPage(page)
        if (result.error) throw new Error(result.error.message)
        current = result.data?.Page
        all.push(...(current?.airingSchedules ?? []))
      }
      all.sort((a, b) => a.airingAt - b.airingAt)
      cache.set(key, all)
      return all
    } catch (error) {
      if (controller.signal.aborted) throw new Error('AniList schedule request timed out')
      throw error
    } finally {
      clearTimeout(deadline)
    }
  })().finally(() => inflight.delete(key))

  inflight.set(key, request)
  return request
}

export const cachedScheduleWeek = (start: number, end: number): Airing[] | undefined =>
  cache.get(keyOf(start, end))

/** Test seam. */
export function clearScheduleCache(): void {
  cache.clear()
  inflight.clear()
}
