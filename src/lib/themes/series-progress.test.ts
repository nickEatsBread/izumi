import { afterEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

// The Continue Watching module only lends its snapshot store here; keep the trackers stack out.
vi.mock('$lib/trackers', () => ({ getMalAnimeListMediaOrThrow: vi.fn(), setStatus: vi.fn() }))

import type { Media } from '$lib/anilist/types'
import { localTrackingForMedia, type LocalLibraryState, type LocalMediaEntry } from '$lib/library/local-lists'
import { cwSnapshot, type CwEntry } from '$lib/player/continue-watching'
import { durableHistory, manualProgressOverrides, sessionProgress, type HistoryEntry } from '$lib/player/history'
import { localTrackingProgress, localTrackingStatuses, seriesCompleted, seriesCompletion, seriesEpisodesWatched, seriesProgress, trackerProgress, type SeriesProgressSources } from './series-progress'

const media = (id: number, over: Partial<Media> = {}): Media => ({ id, title: { romaji: `Show ${id}` }, episodes: 12, ...over }) as Media
const kitsuCard = (anilist: number): Media => media(-77, { catalog: { provider: 'kitsu', id: '77', type: 'anime' }, externalIds: { anilist } } as Partial<Media>)
const sources = (over: Partial<SeriesProgressSources> = {}): SeriesProgressSources => ({
  tracker: new Map(), tracking: new Map(), history: {}, session: {}, overrides: {}, ...over,
})
const libraryEntry = (m: Media, updatedAt: number, tracking?: LocalMediaEntry['tracking']): LocalMediaEntry =>
  ({ media: m, listIds: [], addedAt: updatedAt, updatedAt, ...(tracking ? { tracking } : {}) })

describe('episodes watched for a card', () => {
  it('is absent for a title the viewer never tracked or finished', () => {
    expect(seriesEpisodesWatched(media(1), sources())).toBeUndefined()
    expect(seriesEpisodesWatched(media(1), sources({ history: { 1: { progress: 0 } } }))).toBeUndefined()
  })
  it('counts a list entry even at zero episodes', () => {
    expect(seriesEpisodesWatched(media(1, { mediaListEntry: { status: 'PLANNING', progress: 0 } }), sources())).toBe(0)
    expect(seriesEpisodesWatched(media(1, { mediaListEntry: { status: 'PLANNING' } }), sources())).toBe(0)
    expect(seriesEpisodesWatched(media(1), sources({ tracking: new Map([['anilist:anime:1', 0]]) }))).toBe(0)
    expect(seriesEpisodesWatched(media(1), sources({ tracker: new Map([[1, 0]]) }))).toBe(0)
  })
  it('falls back to the highest episode finished on this device', () => {
    expect(seriesEpisodesWatched(media(1), sources({ history: { 1: { progress: 3 } } }))).toBe(3)
    expect(seriesEpisodesWatched(media(1), sources({ history: { 1: { progress: 3 } }, session: { 1: 5 } }))).toBe(5)
  })
  it('takes the larger of the list entries and the episodes finished here', () => {
    expect(seriesEpisodesWatched(media(1), sources({ tracker: new Map([[1, 9]]), history: { 1: { progress: 4 } } }))).toBe(9)
    expect(seriesEpisodesWatched(media(1, { mediaListEntry: { progress: 2 } }), sources({ history: { 1: { progress: 4 } } }))).toBe(4)
    expect(seriesEpisodesWatched(media(1, { mediaListEntry: { progress: 2 } }), sources({ tracking: new Map([['anilist:anime:1', 7]]) }))).toBe(7)
  })
  it('lets a manual override win, even below the tracker', () => {
    expect(seriesEpisodesWatched(media(1, { mediaListEntry: { progress: 10 } }), sources({ overrides: { 1: 2 } }))).toBe(2)
    expect(seriesEpisodesWatched(media(1), sources({ overrides: { 1: 0 } }))).toBe(0)
  })
  it('reads a provider card through its AniList id', () => {
    const card = kitsuCard(21)
    expect(seriesEpisodesWatched(card, sources({ history: { 21: { progress: 6 } } }))).toBe(6)
    expect(seriesEpisodesWatched(card, sources({ tracker: new Map([[21, 8]]) }))).toBe(8)
    expect(seriesEpisodesWatched(card, sources({ tracking: new Map([['anilist:anime:21', 1]]) }))).toBe(1)
  })
})

describe('a finished series (API 4 `completed`)', () => {
  const finished = (over: Partial<Media> = {}) => media(1, { status: 'FINISHED', ...over })
  it('follows a Completed list status, this device tracking first', () => {
    expect(seriesCompleted(media(1, { mediaListEntry: { status: 'COMPLETED', progress: 12 } }), sources())).toBe(true)
    expect(seriesCompleted(media(1), sources({ statuses: new Map([['anilist:anime:1', 'COMPLETED']]) }))).toBe(true)
    // This device's tracking wins over the catalog entry, either way.
    expect(seriesCompleted(media(1, { mediaListEntry: { status: 'COMPLETED' } }), sources({ statuses: new Map([['anilist:anime:1', 'CURRENT']]) }))).toBe(false)
    expect(seriesCompleted(media(1, { mediaListEntry: { status: 'CURRENT' } }), sources({ statuses: new Map([['anilist:anime:1', 'COMPLETED']]) }))).toBe(true)
  })
  it('counts every episode watched of a finished series, and never an airing one', () => {
    expect(seriesCompleted(finished(), sources({ history: { 1: { progress: 12 } } }))).toBe(true)
    expect(seriesCompleted(finished(), sources({ history: { 1: { progress: 11 } } }))).toBe(false)
    expect(seriesCompleted(media(1, { status: 'RELEASING' }), sources({ history: { 1: { progress: 12 } } }))).toBe(false)
    expect(seriesCompleted(finished({ episodes: undefined }), sources({ history: { 1: { progress: 40 } } }))).toBe(false)
    expect(seriesCompleted(finished(), sources())).toBe(false)
  })
  it('does not count a rewatch in progress', () => {
    expect(seriesCompleted(finished({ mediaListEntry: { status: 'REPEATING', progress: 12 } }), sources({ history: { 1: { progress: 12 } } }))).toBe(false)
  })
  it('reads the statuses of this device tracking by the same key as its progress', () => {
    const state: LocalLibraryState = {
      lists: [],
      entries: { a: libraryEntry(media(1), 10, { status: 'COMPLETED', progress: 12 }), b: libraryEntry(media(2), 10, { progress: 3 }) },
    }
    expect([...localTrackingStatuses(state)]).toEqual([['anilist:anime:1', 'COMPLETED']])
  })
})

describe('progress sources', () => {
  it('keeps only tracker entries from the Continue Watching snapshot', () => {
    const snapshot: CwEntry[] = [
      { media: media(1), progress: 4, updatedAt: 1, source: 'tracker' },
      { media: media(2), progress: 7, updatedAt: 2, source: 'local' },
    ]
    expect([...trackerProgress(snapshot)]).toEqual([[1, 4]])
  })
  it('matches localTrackingForMedia, removals included', () => {
    const a = media(1), b = media(2), c = media(3), d = media(4), e = media(5)
    const state: LocalLibraryState = {
      lists: [],
      entries: {
        a1: libraryEntry(a, 10, { status: 'CURRENT', progress: 3 }),
        a2: libraryEntry(kitsuCard(1), 20, { status: 'CURRENT', progress: 5 }),
        b: libraryEntry(b, 10, { status: 'PLANNING' }),
        c: libraryEntry(c, 10, { status: 'CURRENT', progress: 2 }),
        d: libraryEntry(d, 10, { score: 80 }),
        e: libraryEntry(e, 10),
      },
      removedTracking: { 'anilist:anime:3': 50, 'anilist:anime:2': 5 },
    }
    const index = localTrackingProgress(state)
    expect(index.get('anilist:anime:1')).toBe(5)
    expect(index.get('anilist:anime:2')).toBe(0)
    expect(index.has('anilist:anime:3')).toBe(false)
    expect(index.has('anilist:anime:4')).toBe(false)
    expect(index.has('anilist:anime:5')).toBe(false)
    for (const m of [a, b, c, d, e]) {
      const tracking = localTrackingForMedia(state, m)
      const listed = tracking && (tracking.status || tracking.progress != null) ? tracking.progress ?? 0 : undefined
      expect(index.get(`anilist:anime:${m.id}`), `media ${m.id}`).toBe(listed)
    }
  })
})

describe('the live progress lookup', () => {
  afterEach(() => {
    cwSnapshot.set([])
    durableHistory.set({})
    sessionProgress.set({})
    manualProgressOverrides.set({})
  })
  it('follows the stores', () => {
    const lookup = () => get(seriesProgress)
    expect(lookup()(media(40))).toBeUndefined()
    cwSnapshot.set([{ media: media(40), progress: 6, updatedAt: 1, source: 'tracker' }])
    expect(lookup()(media(40))).toBe(6)
    durableHistory.set({ 40: { media: media(40), episode: 9, progress: 8, updatedAt: 2 } as HistoryEntry })
    expect(lookup()(media(40))).toBe(8)
    manualProgressOverrides.set({ 40: 1 })
    expect(lookup()(media(40))).toBe(1)
  })
  it('marks a series finished from the same stores', () => {
    const done = () => get(seriesCompletion)
    const show = media(41, { status: 'FINISHED' })
    expect(done()(show)).toBe(false)
    durableHistory.set({ 41: { media: show, episode: 12, progress: 12, updatedAt: 2 } as HistoryEntry })
    expect(done()(show)).toBe(true)
    manualProgressOverrides.set({ 41: 3 })
    expect(done()(show)).toBe(false)
  })
})
