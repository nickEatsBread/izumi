import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import type { HistoryEntry } from '$lib/player/history'
import { localForYou } from './local-for-you'

const media = (id: number, name: string, genres: string[] = [], extra: Partial<Media> = {}): Media => ({
  id,
  title: { userPreferred: name },
  genres,
  averageScore: 75,
  ...extra,
})

const historyEntry = (item: Media, progress: number, updatedAt: number): HistoryEntry => ({
  media: item,
  episode: Math.max(1, progress),
  progress,
  updatedAt,
})

const NOW = Date.UTC(2026, 7, 30)
const watchedRecently = { 1: historyEntry(media(1, 'Recent Favourite', ['Action', 'Sci-Fi'], { episodes: 12 }), 12, NOW - 2 * 86_400_000) }

describe('local For You ranking', () => {
  it('taste-ranks catalog candidates without an account and names the most recent seed', () => {
    const result = localForYou(watchedRecently, [
      media(10, 'Perfect Match', ['Action', 'Sci-Fi']),
      media(11, 'Off Taste', ['Romance']),
    ], { now: NOW })
    expect(result.map((item) => item.media.id)).toEqual([10, 11])
    expect(result[0].reason).toBe('Because you watched Recent Favourite')
    expect(result[0].sourceCount).toBe(1)
  })

  it('hides already-watched, excluded, dismissed, and adult candidates; adult toggle re-admits', () => {
    const candidates = [
      media(1, 'Seed itself'),
      media(12, 'Watched elsewhere', [], { externalIds: { anilist: 1 } }),
      media(13, 'On tracker list'),
      media(14, 'Dismissed'),
      media(15, 'Adult pick', ['Action'], { isAdult: true }),
      media(16, 'Visible pick', ['Action']),
    ]
    const options = { excludedIds: [13], dismissedIds: [14], now: NOW }
    expect(localForYou(watchedRecently, candidates, options).map((item) => item.media.id)).toEqual([16])
    expect(localForYou(watchedRecently, candidates, { ...options, showAdult: true }).map((item) => item.media.id))
      .toEqual([15, 16])
  })

  it('normalizes cross-catalog genre spellings so TMDB-style candidates still match', () => {
    const result = localForYou(watchedRecently, [media(10, 'Catalog Match', ['Science Fiction', 'Action'])], { now: NOW })
    expect(result[0].reason).toBe('Because you watched Recent Favourite')
    expect(result[0].score).toBeGreaterThan(2)
  })

  it('renders nothing without watch history so the row stays hidden', () => {
    expect(localForYou({}, [media(10, 'Anything')], { now: NOW })).toEqual([])
  })

  it('gives candidates without genres a format and quality path into the row', () => {
    const history = { 1: historyEntry(media(1, 'TV Watcher', ['Action'], { format: 'TV' }), 8, NOW) }
    const result = localForYou(history, [media(10, 'Untagged', [], { format: 'TV', averageScore: 90 })], { now: NOW })
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('Picked for your watch history')
  })
})

describe('local For You memoization', () => {
  const candidates = [media(10, 'Pick', ['Action'])]
  // The memo compares option identities (store emissions replace arrays), so reuse one instance.
  const nothingDismissed: number[] = []

  it('reuses the exact result array while history, pool, and filters keep their identity', () => {
    const first = localForYou(watchedRecently, candidates, { dismissedIds: nothingDismissed, now: NOW })
    const second = localForYou(watchedRecently, candidates, { dismissedIds: nothingDismissed, now: NOW })
    expect(second).toBe(first)
  })

  it('recomputes when the dismissed list identity or the adult filter changes', () => {
    const base = localForYou(watchedRecently, candidates, { dismissedIds: nothingDismissed, now: NOW })
    const filtered = localForYou(watchedRecently, candidates, { dismissedIds: [10], now: NOW })
    expect(filtered).toEqual([])
    expect(filtered).not.toBe(base)
    expect(localForYou(watchedRecently, candidates, { dismissedIds: nothingDismissed, now: NOW, showAdult: true }))
      .not.toBe(base)
  })

  it('scores a few hundred candidates well inside the interaction budget', () => {
    const pool = Array.from({ length: 300 }, (_, index) =>
      media(index + 100, `Candidate ${index}`, [['Action', 'Romance', 'Comedy'][index % 3]]))
    const started = performance.now()
    const result = localForYou(watchedRecently, pool, { now: NOW })
    expect(result.length).toBeGreaterThan(0)
    expect(performance.now() - started).toBeLessThan(20)
  })
})
