import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { recordedWatched } from '$lib/catalog/anime-detail'
import { seriesListEntry, type SeriesListInputs } from './list-entry'

const entry = (overrides: Partial<SeriesListInputs>) => seriesListEntry({
  edit: {},
  watched: 0,
  watchedBefore: 0,
  ...overrides,
})

describe('series page list entry', () => {
  it('counts an episode watched under the player after the editor set Watching at 0', () => {
    // The reported bug: the page stays mounted (hidden) during playback, so the editor's
    // optimistic 0 and the tracker reads from before playback outranked the new episode until a
    // refresh threw them away.
    const view = entry({
      edit: { status: 'CURRENT', progress: 0 },
      local: { status: 'CURRENT', progress: 1 },
      anilist: { status: 'CURRENT', progress: 0 },
      external: { status: 'CURRENT', progress: 0 },
      watched: 1,
      watchedBefore: 0,
    })
    expect(view.progress).toBe(1)
    expect(view.status).toBe('CURRENT')
  })

  it('counts a watch the stale tracker reads do not know about yet', () => {
    // With local history off nothing local is written; only this session's play knows.
    expect(entry({ anilist: { status: 'CURRENT', progress: 0 }, watched: 1, watchedBefore: 0 }).progress).toBe(1)
    expect(entry({ external: { status: 'CURRENT', progress: 3 }, watched: 4, watchedBefore: 3 }).progress).toBe(4)
  })

  it('keeps an explicit edit while nothing was watched after it', () => {
    // A deliberate rewind from 5 to 3 must not snap back to the stale tracker value or the
    // history this device already had.
    const view = entry({
      edit: { status: 'CURRENT', progress: 3 },
      anilist: { status: 'CURRENT', progress: 5 },
      watched: 5,
      watchedBefore: 5,
    })
    expect(view.progress).toBe(3)
    expect(view.status).toBe('CURRENT')
  })

  it('moves past a rewind once a later episode is watched', () => {
    const view = entry({
      edit: { status: 'CURRENT', progress: 3 },
      local: { status: 'CURRENT', progress: 6 },
      anilist: { status: 'CURRENT', progress: 5 },
      watched: 6,
      watchedBefore: 5,
    })
    expect(view.progress).toBe(6)
  })

  it('lets a watch replace the edited status but keep the edited score', () => {
    const view = entry({
      edit: { status: 'PLANNING', progress: 0, score: 80 },
      local: { status: 'CURRENT', progress: 1, score: 80 },
      watched: 1,
      watchedBefore: 0,
    })
    expect(view.status).toBe('CURRENT')
    expect(view.score100).toBe(80)
    expect(view.edit).toEqual({ score: 80 })
  })

  it('shows the entry again when an episode is watched after removing it', () => {
    const view = entry({
      edit: { removed: true },
      local: { status: 'CURRENT', progress: 1 },
      watched: 1,
      watchedBefore: 0,
    })
    expect(view.removed).toBe(false)
    expect(view.status).toBe('CURRENT')
    expect(view.progress).toBe(1)
  })

  it('keeps a removal while nothing was watched after it', () => {
    const view = entry({ edit: { removed: true }, anilist: { status: 'CURRENT', progress: 4 }, watched: 4, watchedBefore: 4 })
    expect(view).toMatchObject({ removed: true, progress: 0, score100: 0 })
    expect(view.status).toBeUndefined()
    expect(entry({ locallyRemoved: true, anilist: { status: 'CURRENT', progress: 4 } })).toMatchObject({ removed: true, progress: 0 })
  })

  it('does not treat history from before the page opened as a new watch', () => {
    // Trackers say 3 after an earlier rewind; this device's history still holds 5.
    expect(entry({ local: { status: 'CURRENT', progress: 3 }, watched: 5, watchedBefore: 5 }).progress).toBe(3)
    // Nothing is compared until the page has read its sources.
    expect(entry({ local: { status: 'CURRENT', progress: 3 }, watched: 5, watchedBefore: null }).progress).toBe(3)
  })

  it('takes the furthest tracker, so an AniList 0 does not hide MAL progress', () => {
    expect(entry({ anilist: { status: 'CURRENT', progress: 0 }, external: { status: 'CURRENT', progress: 4 } }).progress).toBe(4)
  })

  it('prefers local tracking, then AniList, then the other trackers for status and score', () => {
    const view = entry({
      local: { status: 'PAUSED', score: 70 },
      anilist: { status: 'CURRENT', score: 60 },
      external: { status: 'DROPPED', score: 50 },
    })
    expect(view.status).toBe('PAUSED')
    expect(view.score100).toBe(70)
    expect(entry({ anilist: { status: 'CURRENT' }, external: { status: 'DROPPED', score: 50 } })).toMatchObject({ status: 'CURRENT', score100: 50 })
  })

  it('lets an exact progress override win over the tracker reads', () => {
    expect(entry({ override: 2, anilist: { status: 'CURRENT', progress: 5 } }).progress).toBe(2)
  })
})

describe('recordedWatched', () => {
  it('reads session plays and local history under both the page id and its AniList id', () => {
    const provider = { id: 900001, catalog: { provider: 'kitsu', id: '42', type: 'anime' }, externalIds: { anilist: 21 } } as unknown as Media
    expect(recordedWatched(provider, { 21: { progress: 3 } }, { 900001: 4 })).toBe(4)
    expect(recordedWatched(provider, { 900001: { progress: 6 } }, { 21: 2 })).toBe(6)
    expect(recordedWatched({ id: 5 } as Media, {}, {})).toBe(0)
  })
})
