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
