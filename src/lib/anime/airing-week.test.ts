import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ week: vi.fn(), backup: vi.fn(), degraded: vi.fn(), provider: vi.fn() }))
vi.mock('$lib/anilist/schedule-cache', () => ({ loadScheduleWeek: mocks.week }))
vi.mock('./animeschedule', () => ({ getWeeklySchedule: mocks.backup }))
vi.mock('$lib/anilist/degraded', () => ({ markAniListDegraded: mocks.degraded, markCatalogProvider: mocks.provider, shouldUseJikanCatalog: () => false }))

import { weekRange } from '$lib/anilist/schedule'
import { airedBefore, clearAiringWeeks, loadAiringWeek } from './airing-week'

const airing = (id: number, airingAt: number, episode = 1) => ({ airingAt, episode, media: { id } })
const client = {} as never
const DAY = 86_400

beforeEach(() => {
  clearAiringWeeks()
  for (const mock of Object.values(mocks)) mock.mockReset()
})

describe('airing weeks', () => {
  it('reads AniList while it answers', async () => {
    mocks.week.mockResolvedValue([airing(1, 100)])
    await expect(loadAiringWeek(client, 0, 7 * DAY)).resolves.toEqual([airing(1, 100)])
    expect(mocks.backup).not.toHaveBeenCalled()
  })

  it('falls back to the backup timetable once per week while AniList is out', async () => {
    mocks.week.mockRejectedValue(new Error('[GraphQL] disabled'))
    mocks.backup.mockResolvedValue([airing(2, 200)])
    const [first, second] = await Promise.all([loadAiringWeek(client, 0, 7 * DAY), loadAiringWeek(client, 0, 7 * DAY)])
    expect(first).toEqual([airing(2, 200)])
    expect(second).toEqual([airing(2, 200)])
    expect(mocks.backup).toHaveBeenCalledTimes(1)
    expect(mocks.degraded).toHaveBeenCalledWith('[GraphQL] disabled')
    // A later read of the same week answers from the backup without asking AniList again.
    mocks.week.mockClear()
    await expect(loadAiringWeek(client, 0, 7 * DAY)).resolves.toEqual([airing(2, 200)])
    expect(mocks.week).not.toHaveBeenCalled()
    expect(mocks.provider).toHaveBeenCalledWith('AnimeSchedule')
  })

  it('does not keep a failed backup week', async () => {
    mocks.week.mockRejectedValue(new Error('down'))
    mocks.backup.mockRejectedValueOnce(new Error('backup down')).mockResolvedValueOnce([airing(3, 300)])
    await expect(loadAiringWeek(client, 0, 7 * DAY)).rejects.toThrow('backup down')
    await expect(loadAiringWeek(client, 0, 7 * DAY)).resolves.toEqual([airing(3, 300)])
  })

  it('lists aired episodes newest first, reading earlier weeks until enough are known', async () => {
    const before = weekRange(new Date()).start + 2 * DAY
    const { start } = weekRange(new Date(before * 1000))
    mocks.week.mockImplementation(async (_client: unknown, weekStart: number) => weekStart === start
      ? [airing(1, start + DAY), airing(2, start + 3 * DAY)] // the second has not aired yet
      : [airing(3, weekStart + DAY), airing(4, weekStart + 5 * DAY)])
    const aired = await airedBefore(client, before, 3)
    expect(aired.map((item) => item.media.id)).toEqual([1, 4, 3])
    expect(mocks.week).toHaveBeenCalledTimes(2)
    expect(mocks.week.mock.calls[1][1]).toBe(start - 7 * DAY)
  })
})
