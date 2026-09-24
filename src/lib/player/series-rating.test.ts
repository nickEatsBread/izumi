import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

// The gate is the product: every reason the prompt must NOT appear is a rule here.

// Hoisted mocks cannot reach the file's imports, so the stores are a minimal hand-rolled
// store contract (`get()` only needs `subscribe`).
const mocks = vi.hoisted(() => {
  const store = <T,>(initial: T) => {
    let value = initial
    const subs = new Set<(v: T) => void>()
    return {
      subscribe(fn: (v: T) => void) { fn(value); subs.add(fn); return () => { subs.delete(fn) } },
      set(next: T) { value = next; subs.forEach((fn) => fn(value)) },
      update(fn: (v: T) => T) { this.set(fn(value)) },
    }
  }
  return {
    anyTrackerConnected: vi.fn(() => true),
    setScore: vi.fn(async () => ['AniList']),
    connectedTrackerProviders: vi.fn(() => ['anilist', 'mal'] as string[]),
    incognito: store(false),
    enabled: store(true),
    traktToken: store<string | null>(null),
    localLibrary: store({ entries: {} }),
    localTracking: vi.fn(() => undefined as { score?: number } | undefined),
  }
})

vi.mock('$lib/trackers', () => ({ anyTrackerConnected: mocks.anyTrackerConnected, setScore: mocks.setScore }))
vi.mock('$lib/trackers/config', () => ({ connectedTrackerProviders: mocks.connectedTrackerProviders }))
vi.mock('$lib/trakt/config', () => ({ traktToken: mocks.traktToken }))
vi.mock('$lib/stores/incognito', () => ({ incognito: mocks.incognito }))
vi.mock('$lib/settings/ui', () => ({ seriesRatingPrompt: mocks.enabled }))
vi.mock('$lib/library/local-lists', () => ({
  localLibrary: mocks.localLibrary,
  localTrackingForMedia: (...args: unknown[]) => mocks.localTracking(...(args as [])),
}))

import {
  connectedTrackerLabels, isSeriesFinale, requestSeriesRating, resetSeriesRatingSession, saveSeriesRating,
  seriesRatingPrompt, shouldPromptSeriesRating,
} from './series-rating'
import type { Media } from '$lib/anilist/types'

const finished = (over: Partial<Media> = {}): Media => ({
  id: 1, title: { romaji: 'Show' }, status: 'FINISHED', episodes: 12, ...over,
} as Media)

beforeEach(() => {
  resetSeriesRatingSession()
  mocks.anyTrackerConnected.mockReturnValue(true)
  mocks.incognito.set(false)
  mocks.enabled.set(true)
  mocks.traktToken.set(null)
  mocks.localTracking.mockReturnValue(undefined)
  mocks.setScore.mockClear()
})

describe('isSeriesFinale', () => {
  it('is the last planned episode of a finished title', () => {
    expect(isSeriesFinale(finished(), 12)).toBe(true)
    expect(isSeriesFinale(finished(), 13)).toBe(true)
    expect(isSeriesFinale(finished(), 11)).toBe(false)
  })

  it('never fires on an airing title that merely has no later episode yet', () => {
    expect(isSeriesFinale(finished({ status: 'RELEASING' }), 12)).toBe(false)
    expect(isSeriesFinale(finished({ status: 'HIATUS' }), 12)).toBe(false)
    expect(isSeriesFinale(finished({ status: 'NOT_YET_RELEASED' }), 12)).toBe(false)
  })

  it('treats a cancelled title as over', () => {
    expect(isSeriesFinale(finished({ status: 'CANCELLED', episodes: 6 }), 6)).toBe(true)
  })

  it('handles movies, which play without an episode number', () => {
    expect(isSeriesFinale(finished({ episodes: 1 }), null)).toBe(true)
    expect(isSeriesFinale(finished({ episodes: 1 }), undefined)).toBe(true)
    expect(isSeriesFinale(finished(), null)).toBe(false)
  })

  it('needs a known total', () => {
    expect(isSeriesFinale(finished({ episodes: undefined }), 12)).toBe(false)
    expect(isSeriesFinale(finished({ episodes: 0 }), 12)).toBe(false)
  })
})

describe('shouldPromptSeriesRating', () => {
  const open = { finale: true, trackerConnected: true, incognito: false, enabled: true, currentScore: 0, alreadyAsked: false }

  it('asks only when every condition holds', () => {
    expect(shouldPromptSeriesRating(open)).toBe(true)
  })

  it.each([
    ['no finale', { finale: false }],
    ['no tracker linked', { trackerConnected: false }],
    ['incognito', { incognito: true }],
    ['setting off', { enabled: false }],
    ['already rated', { currentScore: 70 }],
    ['already asked this session', { alreadyAsked: true }],
  ])('stays quiet: %s', (_label, over) => {
    expect(shouldPromptSeriesRating({ ...open, ...over })).toBe(false)
  })
})

describe('requestSeriesRating', () => {
  it('publishes one request per title per session', () => {
    expect(requestSeriesRating(finished(), 12)).toBe(true)
    expect(get(seriesRatingPrompt)).toMatchObject({ episode: 12, currentScore: 0 })
    // The finalize hook fires for the same finale a moment later — and a dismissed prompt stays gone.
    seriesRatingPrompt.set(null)
    expect(requestSeriesRating(finished(), 12)).toBe(false)
    expect(get(seriesRatingPrompt)).toBeNull()
  })

  it('does nothing without a connected tracker — there is nowhere to save the answer', () => {
    mocks.anyTrackerConnected.mockReturnValue(false)
    expect(requestSeriesRating(finished(), 12)).toBe(false)
    expect(get(seriesRatingPrompt)).toBeNull()
  })

  it('respects an existing score from the tracker snapshot or the local library', () => {
    expect(requestSeriesRating(finished({ mediaListEntry: { score: 80 } } as Partial<Media>), 12)).toBe(false)
    mocks.localTracking.mockReturnValue({ score: 60 })
    expect(requestSeriesRating(finished({ id: 2 }), 12)).toBe(false)
  })

  it('stays silent in incognito and when switched off', () => {
    mocks.incognito.set(true)
    expect(requestSeriesRating(finished(), 12)).toBe(false)
    mocks.incognito.set(false)
    mocks.enabled.set(false)
    expect(requestSeriesRating(finished(), 12)).toBe(false)
  })

  it('ignores a mid-series episode and an airing show', () => {
    expect(requestSeriesRating(finished(), 5)).toBe(false)
    expect(requestSeriesRating(finished({ status: 'RELEASING' }), 12)).toBe(false)
  })
})

describe('saving', () => {
  it('writes the 1-10 answer through the canonical 0-100 score path', async () => {
    const media = finished()
    await saveSeriesRating({ media, episode: 12, currentScore: 0 }, 8)
    expect(mocks.setScore).toHaveBeenCalledWith(media, 80)
    await saveSeriesRating({ media, episode: 12, currentScore: 0 }, 14)
    expect(mocks.setScore).toHaveBeenLastCalledWith(media, 100)
  })

  it('names every connected service, Trakt included', () => {
    expect(connectedTrackerLabels()).toEqual(['AniList', 'MyAnimeList'])
    mocks.traktToken.set('t')
    expect(connectedTrackerLabels()).toEqual(['AniList', 'MyAnimeList', 'Trakt'])
  })
})
