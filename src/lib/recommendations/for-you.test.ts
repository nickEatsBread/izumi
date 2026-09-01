import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import type { HistoryEntry } from '$lib/player/history'
import { accountSeed, historySeeds, rankForYou } from './for-you'

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

describe('For You taste profile', () => {
  it('prefers recent, substantially watched history and ignores media without an AniList id', () => {
    const now = Date.UTC(2026, 7, 30)
    const history = {
      1: historyEntry(media(1, 'Recent', ['Action'], { episodes: 12 }), 12, now - 2 * 86_400_000),
      2: historyEntry(media(2, 'Old sample', ['Drama'], { episodes: 24 }), 1, now - 400 * 86_400_000),
      '-3': historyEntry(media(-3, 'TMDB show', [], { catalog: { provider: 'tmdb', id: '3', type: 'series' } }), 5, now),
    }
    const seeds = historySeeds(history, now)
    expect(seeds.map((seed) => seed.media.id)).toEqual([1, 2])
    expect(seeds[0].affinity).toBeGreaterThan(seeds[1].affinity)
  })

  it('uses explicit account scores as affinity without requiring a completed status', () => {
    expect(accountSeed(media(1, 'Favourite'), 95, 'CURRENT', 3).affinity).toBeCloseTo(0.95)
    expect(accountSeed(media(1, 'Unrated'), 0, 'COMPLETED', 12).affinity).toBeCloseTo(0.7)
  })
})

describe('For You ranking', () => {
  const seeds = [
    { media: media(1, 'Space Show', ['Sci-Fi', 'Action']), affinity: 1 },
    { media: media(2, 'Quiet Drama', ['Drama']), affinity: 0.7 },
  ]

  it('deduplicates candidates, boosts shared taste, and explains multiple supporting titles', () => {
    const result = rankForYou(seeds, [
      { seedId: 1, rating: 100, media: media(10, 'Great Match', ['Sci-Fi']) },
      { seedId: 2, rating: 20, media: media(10, 'Great Match', ['Sci-Fi']) },
      { seedId: 1, rating: 100, media: media(11, 'Weaker Match', ['Romance']) },
    ])
    expect(result.map((item) => item.media.id)).toEqual([10, 11])
    expect(result[0].sourceCount).toBe(2)
    expect(result[0].reason).toBe('Inspired by Space Show + 1 more')
  })

  it('removes seeds, watched, dismissed, and hidden adult candidates', () => {
    const edges = [
      { seedId: 1, rating: 10, media: media(1, 'Seed') },
      { seedId: 1, rating: 10, media: media(12, 'Watched') },
      { seedId: 1, rating: 10, media: media(13, 'Dismissed') },
      { seedId: 1, rating: 10, media: media(14, 'Adult', [], { isAdult: true }) },
      { seedId: 1, rating: 10, media: media(15, 'Visible') },
    ]
    expect(rankForYou(seeds, edges, { excludedIds: [12], dismissedIds: [13] }).map((item) => item.media.id))
      .toEqual([15])
    expect(rankForYou(seeds, edges, { showAdult: true }).some((item) => item.media.id === 14)).toBe(true)
  })

  it('is deterministic when scores tie', () => {
    const edges = [
      { seedId: 1, rating: 0, media: media(30, 'Thirty') },
      { seedId: 1, rating: 0, media: media(20, 'Twenty') },
    ]
    expect(rankForYou(seeds, edges).map((item) => item.media.id)).toEqual([20, 30])
  })
})
