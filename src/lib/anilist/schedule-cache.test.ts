import type { Client } from '@urql/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearScheduleCache, loadScheduleWeek } from './schedule-cache'

describe('schedule week cache', () => {
  beforeEach(clearScheduleCache)

  it('deduplicates in-flight pages and reuses the completed week', async () => {
    const query = vi.fn((_document: unknown, vars: { page: number }) => ({
      toPromise: async () => ({
        data: {
          Page: {
            airingSchedules: [{ airingAt: vars.page === 1 ? 20 : 10, episode: vars.page, media: { id: vars.page } }],
            // AniList currently documents lastPage as inaccurate. A bogus value must not fan out.
            pageInfo: { lastPage: 99, hasNextPage: vars.page === 1 },
          },
        },
      }),
    }))
    const client = { query } as unknown as Client

    const [first, sameInflight] = await Promise.all([
      loadScheduleWeek(client, 100, 200),
      loadScheduleWeek(client, 100, 200),
    ])
    const cached = await loadScheduleWeek(client, 100, 200)

    expect(query).toHaveBeenCalledTimes(2)
    expect(first.map((airing) => airing.airingAt)).toEqual([10, 20])
    expect(sameInflight).toBe(first)
    expect(cached).toBe(first)
  })

  it('times out a stuck week and clears it from the in-flight cache', async () => {
    vi.useFakeTimers()
    try {
      const query = vi.fn((_document: unknown, _vars: unknown, context: {
        fetchOptions: { signal: AbortSignal }
      }) => ({
        toPromise: () => new Promise((_, reject) => {
          context.fetchOptions.signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          }, { once: true })
        }),
      }))
      const client = { query } as unknown as Client

      const first = loadScheduleWeek(client, 300, 400)
      const firstRejected = expect(first).rejects.toThrow('AniList schedule request timed out')
      await vi.advanceTimersByTimeAsync(18_000)
      await firstRejected

      const second = loadScheduleWeek(client, 300, 400)
      const secondRejected = expect(second).rejects.toThrow('AniList schedule request timed out')
      expect(query).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(18_000)
      await secondRejected
    } finally {
      vi.useRealTimers()
    }
  })
})
