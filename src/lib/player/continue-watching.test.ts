import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

// Isolate the module from the real trackers stack (client/mal-auth/queue) — it only needs this one fn.
const mocks = vi.hoisted(() => ({ malList: vi.fn() }))
vi.mock('$lib/trackers', () => ({ getMalListProgressOrThrow: mocks.malList }))

import {
  mergeInstant, buildSnapshot, reconcileContinueWatching,
  cwSnapshot, reconciling, reconciledOnce, type CwEntry,
} from './continue-watching'
import { localHistory, sessionProgress, type HistoryEntry } from './history'
import type { Media } from '$lib/anilist/types'

// ── fixtures ───────────────────────────────────────────────────────────────────
const media = (id: number, over: Partial<Media> = {}): Media =>
  ({ id, idMal: id + 100, title: { romaji: `Show ${id}` }, episodes: 12, ...over }) as Media

const entry = (id: number, progress: number, updatedAt: number, source: 'tracker' | 'local' = 'tracker'): CwEntry =>
  ({ media: media(id), progress, updatedAt, source })

const hist = (id: number, over: Partial<HistoryEntry> = {}): HistoryEntry =>
  ({ media: media(id), episode: 1, progress: 0, updatedAt: 1000, ...over })

const okClient = (m: Media[]) => ({ query: () => ({ toPromise: async () => ({ data: { Page: { media: m } } }) }) })

beforeEach(() => {
  cwSnapshot.set([])
  localHistory.set({})
  sessionProgress.set({})
  reconciling.set(false)
  reconciledOnce.set(false)
  mocks.malList.mockReset()
})
afterEach(() => { cwSnapshot.set([]); localHistory.set({}); sessionProgress.set({}) })

describe('mergeInstant (instant paint)', () => {
  it('merges snapshot ∪ local, dedupes by id keeping max progress, orders most-recent first', () => {
    const snapshot = [entry(1, 3, 200), entry(2, 5, 100)]
    const history = { 1: hist(1, { progress: 6, updatedAt: 150 }), 3: hist(3, { progress: 1, updatedAt: 300 }) }
    const out = mergeInstant(snapshot, history, {})
    expect(out.map((e) => e.media.id)).toEqual([3, 1, 2]) // updatedAt desc: 300, 200, 100
    expect(out.find((e) => e.media.id === 1)!.progress).toBe(6) // local (6) beat snapshot (3)
  })

  it('lifts progress by this session’s freshly-watched count', () => {
    const out = mergeInstant([entry(1, 2, 100)], {}, { 1: 7 })
    expect(out[0].progress).toBe(7)
  })

  it('hides caught-up shows (finished, all episodes watched)', () => {
    const finished = media(1, { status: 'FINISHED', episodes: 12 })
    const out = mergeInstant([{ media: finished, progress: 12, updatedAt: 100, source: 'tracker' }], {}, {})
    expect(out).toEqual([])
  })

  it('resumes an opened-but-unfinished episode via episode - 1', () => {
    // opened ep 5 (episode:5), completed count 2 -> progress = max(2, 4) = 4, resume lands on ep 5
    const out = mergeInstant([], { 1: hist(1, { episode: 5, progress: 2 }) }, {})
    expect(out[0].progress).toBe(4)
  })
})

describe('buildSnapshot (reconcile merge)', () => {
  it('only-increase: keeps a higher local/prior count, never regresses to a lower remote read', () => {
    const out = buildSnapshot({
      ani: [{ media: media(1), progress: 3, updatedAt: 500 }],
      mal: [], refreshedMedia: {},
      history: { 1: hist(1, { progress: 6 }) },
      session: {}, prior: [entry(1, 5, 400)],
    })
    expect(out.find((e) => e.media.id === 1)!.progress).toBe(6) // max(3 remote, 5 prior, 6 local)
  })

  it('only-increase: adopts a higher remote count (watched elsewhere)', () => {
    const out = buildSnapshot({
      ani: [{ media: media(1), progress: 9, updatedAt: 500 }],
      mal: [], refreshedMedia: {}, history: {}, session: {}, prior: [entry(1, 2, 400)],
    })
    expect(out[0].progress).toBe(9)
  })

  it('membership = fresh sources: a show only in the prior snapshot drops out', () => {
    const out = buildSnapshot({ ani: [], mal: [], refreshedMedia: {}, history: {}, session: {}, prior: [entry(9, 4, 100)] })
    expect(out).toEqual([])
  })

  it('keeps a show dropped from the tracker if it is still in local history', () => {
    const out = buildSnapshot({ ani: [], mal: [], refreshedMedia: {}, history: { 5: hist(5, { progress: 2 }) }, session: {}, prior: [] })
    expect(out.map((e) => e.media.id)).toEqual([5])
    expect(out[0].source).toBe('local')
  })

  it('dedupes across ani + mal + local by id, max progress wins', () => {
    const out = buildSnapshot({
      ani: [{ media: media(1), progress: 4, updatedAt: 300 }],
      mal: [{ media: media(1), progress: 7, updatedAt: 200 }],
      refreshedMedia: {}, history: { 1: hist(1, { progress: 5 }) }, session: {}, prior: [],
    })
    expect(out.length).toBe(1)
    expect(out[0].progress).toBe(7)
  })

  it('keeps caught-up shows in the snapshot (render-time filtering lets them reappear)', () => {
    const out = buildSnapshot({
      ani: [{ media: media(1, { status: 'FINISHED', episodes: 12 }), progress: 12, updatedAt: 100 }],
      mal: [], refreshedMedia: {}, history: {}, session: {}, prior: [],
    })
    expect(out.map((e) => e.media.id)).toEqual([1]) // present here; mergeInstant is what hides it
  })

  it('prefers refreshed media (fresh airing info) over the source media', () => {
    const out = buildSnapshot({
      ani: [{ media: media(1, { nextAiringEpisode: { episode: 3, timeUntilAiring: 1 } }), progress: 2, updatedAt: 100 }],
      mal: [], refreshedMedia: { 1: media(1, { nextAiringEpisode: { episode: 8, timeUntilAiring: 1 } }) },
      history: {}, session: {}, prior: [],
    })
    expect(out[0].media.nextAiringEpisode!.episode).toBe(8)
  })

  it('orders by updatedAt desc', () => {
    const out = buildSnapshot({
      ani: [{ media: media(1), progress: 1, updatedAt: 100 }, { media: media(2), progress: 1, updatedAt: 900 }],
      mal: [], refreshedMedia: {}, history: {}, session: {}, prior: [],
    })
    expect(out.map((e) => e.media.id)).toEqual([2, 1])
  })
})

describe('reconcileContinueWatching', () => {
  it('local-only user (no tracker): no network, snapshot untouched, marks reconciledOnce', async () => {
    cwSnapshot.set([entry(1, 3, 100)])
    await reconcileContinueWatching(okClient([]) as never, undefined, false)
    expect(get(cwSnapshot)).toEqual([entry(1, 3, 100)])
    expect(get(reconciledOnce)).toBe(true)
    expect(get(reconciling)).toBe(false)
  })

  it('no-clobber: an enabled tracker failing offline leaves the snapshot intact', async () => {
    const preset = [entry(77, 2, 100)]
    cwSnapshot.set(preset)
    mocks.malList.mockRejectedValue(new Error('offline'))
    await reconcileContinueWatching(okClient([]) as never, undefined, true)
    expect(get(cwSnapshot)).toEqual(preset)
    expect(get(reconciling)).toBe(false)
  })

  it('writes the rebuilt snapshot from a successful MAL fetch', async () => {
    mocks.malList.mockResolvedValue([{ idMal: 202, progress: 5, updatedAt: 1234 }])
    await reconcileContinueWatching(okClient([media(101, { idMal: 202 })]) as never, undefined, true)
    const snap = get(cwSnapshot)
    expect(snap.length).toBe(1)
    expect(snap[0].media.id).toBe(101)
    expect(snap[0].progress).toBe(5)
    expect(snap[0].updatedAt).toBe(1234)
    expect(get(reconciledOnce)).toBe(true)
  })
})
