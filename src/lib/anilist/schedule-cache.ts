import type { Client } from '@urql/core'
import { SCHEDULE_QUERY, SCHEDULE_WEEK_QUERY } from './detail-queries'
import type { Airing } from './schedule'

type PageData = {
  Page?: {
    airingSchedules?: Airing[]
    pageInfo?: { hasNextPage?: boolean }
  }
}

const DAY = 24 * 3600
const DAY_KEYS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6'] as const
type DayKey = typeof DAY_KEYS[number]
type WeekData = Partial<Record<DayKey, PageData['Page']>>

function weekVariables(start: number): Record<string, number> {
  const variables: Record<string, number> = {}
  for (let day = 0; day < DAY_KEYS.length; day++) {
    // AniList's greater/lesser filters are strict. Subtract one second at the lower edge so an
    // airing exactly at local midnight is neither lost nor duplicated into the previous day.
    variables[`d${day}Start`] = start + day * DAY - 1
    variables[`d${day}End`] = start + (day + 1) * DAY
  }
  return variables
}

const cache = new Map<string, Airing[]>()
interface InflightWeek {
  controller: AbortController
  consumers: Set<symbol>
  promise: Promise<Airing[]>
}
const inflight = new Map<string, InflightWeek>()
const keyOf = (start: number, end: number) => `${start}:${end}`
const SCHEDULE_DEADLINE_MS = 18_000
const MAX_CACHED_WEEKS = 12

function cached(key: string): Airing[] | undefined {
  const value = cache.get(key)
  if (!value) return undefined
  // Map insertion order doubles as a tiny LRU. A long browse through historical weeks should not
  // retain every poster/title payload for the remainder of the app session.
  cache.delete(key)
  cache.set(key, value)
  return value
}

function remember(key: string, value: Airing[]): void {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > MAX_CACHED_WEEKS) {
    const oldest = cache.keys().next().value as string | undefined
    if (oldest == null) break
    cache.delete(oldest)
  }
}

const abortError = () => new DOMException('The request was aborted', 'AbortError')

/** Session cache for schedule weeks. Concurrent consumers of the same week share pagination, but
 * obsolete navigation is cancelled once its final consumer leaves. This matters under AniList's
 * 30/minute degraded quota: letting every briefly-visited week finish in the background can spend
 * the entire minute before the week the viewer actually stopped on gets a turn. */
export function loadScheduleWeek(
  client: Client,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<Airing[]> {
  if (signal?.aborted) return Promise.reject(abortError())
  const key = keyOf(start, end)
  const hit = cached(key)
  if (hit) return Promise.resolve(hit)
  let entry = inflight.get(key)
  if (!entry) {
    const controller = new AbortController()
    let timedOut = false
    const consumers = new Set<symbol>()
    const request = (async () => {
      const deadline = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, SCHEDULE_DEADLINE_MS)
      const fetchDayPage = (day: number, page: number) => client.query<PageData>(
        SCHEDULE_QUERY,
        { start: start + day * DAY - 1, end: Math.min(end, start + (day + 1) * DAY), page },
        { requestPolicy: 'network-only', fetchOptions: { signal: controller.signal } },
      ).toPromise()
      try {
        const first = await client.query<WeekData>(
          SCHEDULE_WEEK_QUERY,
          weekVariables(start),
          { requestPolicy: 'network-only', fetchOptions: { signal: controller.signal } },
        ).toPromise()
        if (first.error) throw new Error(first.error.message)
        const all: Airing[] = []
        for (let day = 0; day < DAY_KEYS.length; day++) {
          let current = first.data?.[DAY_KEYS[day]]
          all.push(...(current?.airingSchedules ?? []))
          // AniList documents total/lastPage as currently inaccurate. Follow the authoritative
          // hasNextPage flag and page only this unusually busy day, not the whole week again.
          for (let page = 2; current?.pageInfo?.hasNextPage && page <= 12; page++) {
            const result = await fetchDayPage(day, page)
            if (result.error) throw new Error(result.error.message)
            current = result.data?.Page
            all.push(...(current?.airingSchedules ?? []))
          }
        }
        all.sort((a, b) => a.airingAt - b.airingAt)
        remember(key, all)
        return all
      } catch (error) {
        if (timedOut) throw new Error('AniList schedule request timed out')
        throw error
      } finally {
        clearTimeout(deadline)
      }
    })()
    entry = { controller, consumers, promise: request }
    request.finally(() => {
      if (inflight.get(key) === entry) inflight.delete(key)
    }).catch(() => { /* each consumer receives the original rejection below */ })
    inflight.set(key, entry)
  }

  const current = entry
  const consumer = Symbol(key)
  current.consumers.add(consumer)
  return new Promise<Airing[]>((resolve, reject) => {
    let settled = false
    const release = () => {
      signal?.removeEventListener('abort', onAbort)
      current.consumers.delete(consumer)
      if (!current.consumers.size && inflight.get(key) === current) current.controller.abort()
    }
    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      release()
      run()
    }
    const onAbort = () => finish(() => reject(abortError()))
    signal?.addEventListener('abort', onAbort, { once: true })
    current.promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    )
  })
}

export const cachedScheduleWeek = (start: number, end: number): Airing[] | undefined =>
  cached(keyOf(start, end))

/** Test seam. */
export function clearScheduleCache(): void {
  cache.clear()
  for (const request of inflight.values()) request.controller.abort()
  inflight.clear()
}
