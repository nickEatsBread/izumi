import { describe, expect, it } from 'vitest'
import { behindCount, buildWatchlist, lastAiredAt } from './watchlist'
import type { Media } from '$lib/anilist/types'

const media = (id: number, extra: Partial<Media> = {}): Media =>
  ({ id, title: {}, ...extra }) as Media

describe('behindCount', () => {
  it('is aired minus progress for a releasing show', () => {
    const m = media(1, { episodes: 12, nextAiringEpisode: { episode: 8, timeUntilAiring: 3600 } })
    expect(behindCount(m, 5)).toBe(2) // eps 6,7 aired and unwatched
  })
  it('uses the full episode count for FINISHED shows', () => {
    expect(behindCount(media(1, { status: 'FINISHED', episodes: 12 }), 10)).toBe(2)
  })
  it('does not count a MAL planned total as aired when airing metadata is unavailable', () => {
    expect(behindCount(media(1, {
      status: 'RELEASING', episodes: 12, nextAiringEpisode: null, airingSchedule: { nodes: [] },
    }), 7)).toBe(0)
  })
  it('does not count episodes of a not-yet-released title as new', () => {
    expect(behindCount(media(1, { status: 'NOT_YET_RELEASED', episodes: 12 }), 0)).toBe(0)
  })
  it('clamps to 0 when progress is ahead of aired', () => {
    const m = media(1, { episodes: 12, nextAiringEpisode: { episode: 4, timeUntilAiring: 60 } })
    expect(behindCount(m, 7)).toBe(0)
  })
  it('treats unknown aired count (no episodes, no schedule) as caught up', () => {
    expect(behindCount(media(1), 3)).toBe(0) // airedCount() = Infinity must not mean "behind"
  })
})

describe('lastAiredAt', () => {
  const now = 1_000_000_000_000 // ms
  it('returns the newest already-aired schedule node time', () => {
    const m = media(1, { airingSchedule: { nodes: [
      { episode: 1, airingAt: 999_000_000 }, { episode: 2, airingAt: 999_900_000 }, { episode: 3, airingAt: 1_000_100_000 },
    ] } })
    expect(lastAiredAt(m, now)).toBe(999_900_000) // ep 3 hasn't aired yet at `now`
  })
  it('is undefined without a schedule', () => {
    expect(lastAiredAt(media(1), now)).toBeUndefined()
  })
})

describe('buildWatchlist', () => {
  it('merges AniList and MAL by media id, keeping max progress', () => {
    const m = media(1, { idMal: 10, episodes: 12, nextAiringEpisode: { episode: 9, timeUntilAiring: 60 } })
    const items = buildWatchlist(
      [{ media: m, progress: 3, updatedAt: 100 }],
      [{ idMal: 10, progress: 6, updatedAt: 200_000 }],
      [m],
    )
    expect(items).toHaveLength(1)
    expect(items[0].progress).toBe(6)
    expect(items[0].behind).toBe(2)
  })
  it('includes MAL-only shows resolved via the media batch', () => {
    const m = media(2, { idMal: 20, episodes: 12 })
    const items = buildWatchlist([], [{ idMal: 20, progress: 4, updatedAt: 0 }], [m])
    expect(items.map((i) => i.media.id)).toEqual([2])
  })
  it('merges canonical tracker entries for the same title without losing progress', () => {
    const m = media(3, { episodes: 12, status: 'FINISHED' })
    const items = buildWatchlist([
      { media: m, progress: 2, updatedAt: 100 },
      { media: m, progress: 7, updatedAt: 200 },
    ], [], [])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ progress: 7, updatedAt: 200_000, behind: 5 })
  })
  it('puts behind shows first, newest-aired first, then caught-up by soonest next episode', () => {
    const behindOld = media(1, { episodes: 12, nextAiringEpisode: { episode: 6, timeUntilAiring: 60 },
      airingSchedule: { nodes: [{ episode: 5, airingAt: 100 }] } })
    const behindNew = media(2, { episodes: 12, nextAiringEpisode: { episode: 6, timeUntilAiring: 60 },
      airingSchedule: { nodes: [{ episode: 5, airingAt: 200 }] } })
    const caughtSoon = media(3, { episodes: 12, nextAiringEpisode: { episode: 3, timeUntilAiring: 100 } })
    const caughtLater = media(4, { episodes: 12, nextAiringEpisode: { episode: 3, timeUntilAiring: 900 } })
    const caughtDone = media(5, { status: 'FINISHED', episodes: 12 })
    const items = buildWatchlist(
      [
        { media: caughtLater, progress: 2, updatedAt: 50 },
        { media: caughtDone, progress: 12, updatedAt: 60 },
        { media: behindOld, progress: 3, updatedAt: 10 },
        { media: caughtSoon, progress: 2, updatedAt: 40 },
        { media: behindNew, progress: 3, updatedAt: 20 },
      ],
      [], [],
    )
    expect(items.map((i) => i.media.id)).toEqual([2, 1, 3, 4, 5])
  })
})
