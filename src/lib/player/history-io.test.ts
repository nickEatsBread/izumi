import { afterEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { durableHistory as localHistory } from './history'
import { exportJson, exportMalXml, importJson } from './history-io'
import { durablePositions as positions } from './progress'
import { episodeSourceOrigins, sourceOrigins } from './source-origin'
import { WATCHLIST_ID, localLibrary, saveLocalTracking } from '$lib/library/local-lists'
import type { Media } from '$lib/anilist/types'

const bundle = (position: Record<string, unknown>) => JSON.stringify({
  app: 'izumi', kind: 'watch-history', version: 1, exportedAt: 1,
  history: {}, positions: position,
})

describe('watch history import merge', () => {
  afterEach(() => {
    localHistory.set({})
    positions.set({})
    sourceOrigins.set({})
    episodeSourceOrigins.set({})
    localLibrary.set({ lists: [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }], entries: {}, queue: [] })
  })

  it('uses the newest per-episode resume position across devices', () => {
    positions.set({ '1:1': { pos: 10, dur: 100, updatedAt: 10 } })
    importJson(bundle({ '1:1': { pos: 40, dur: 100, updatedAt: 20 } }))
    expect(get(positions)['1:1'].pos).toBe(40)

    importJson(bundle({ '1:1': { pos: 5, dur: 100, updatedAt: 15 } }))
    expect(get(positions)['1:1'].pos).toBe(40)
  })

  it('propagates a newer cleared-position tombstone', () => {
    positions.set({ '1:1': { pos: 80, dur: 100, updatedAt: 10 } })
    importJson(bundle({ '1:1': { pos: 0, dur: 100, updatedAt: 20, cleared: true } }))
    expect(get(positions)['1:1']).toMatchObject({ pos: 0, cleared: true, updatedAt: 20 })
  })

  it('syncs an exact episode position without replacing tracker-owned history', () => {
    localHistory.set({
      1: { media: { id: 1, title: { romaji: 'Local' } }, episode: 1, progress: 1, updatedAt: 10 },
    })
    const incoming = JSON.stringify({
      app: 'izumi', kind: 'watch-history', version: 1, exportedAt: 20,
      history: {
        2: { media: { id: 2, title: { romaji: 'Remote' } }, episode: 2, progress: 2, updatedAt: 20 },
      },
      positions: { '2:2': { pos: 900, dur: 1440, updatedAt: 20 } },
    })

    const merged = importJson(incoming, { includeHistory: false })

    expect(get(localHistory)[1].media.title.romaji).toBe('Local')
    expect(get(localHistory)[2]).toBeUndefined()
    expect(get(positions)['2:2']).toMatchObject({ pos: 900, dur: 1440, updatedAt: 20 })
    expect(merged).toEqual({
      imported: 0,
      positionsImported: 1,
      originsImported: 0,
      episodeOriginsImported: 0,
      sceneBookmarksImported: 0,
    })
  })

  it('exports positions but omits history when a tracker owns episode counts', () => {
    localHistory.set({
      2: { media: { id: 2, title: { romaji: 'Mushoku Tensei' } }, episode: 2, progress: 1, updatedAt: 10 },
    })
    positions.set({ '2:2': { pos: 900, dur: 1440, updatedAt: 20 } })

    const exported = JSON.parse(exportJson({ includeHistory: false }))

    expect(exported.history).toEqual({})
    expect(exported.positions['2:2']).toMatchObject({ pos: 900, dur: 1440, updatedAt: 20 })
    expect(exported.origins).toEqual({})
    expect(exported.episodeOrigins).toEqual({})
  })

  it('does not rewrite the position store when peers have nothing newer', () => {
    positions.set({ '1:1': { pos: 40, dur: 100, updatedAt: 20 } })
    let notifications = 0
    const unsubscribe = positions.subscribe(() => notifications++)

    const merged = importJson(bundle({ '1:1': { pos: 5, dur: 100, updatedAt: 15 } }))

    unsubscribe()
    expect(merged.positionsImported).toBe(0)
    expect(notifications).toBe(1)
  })

  it('syncs a newer source origin even when tracker-owned history is omitted', () => {
    sourceOrigins.set({
      2: {
        origin: { kind: 'addon', id: 'local-origin', name: 'Local' },
        release: { group: 'OldGroup' },
        updatedAt: 10,
      },
    })
    const incoming = JSON.stringify({
      app: 'izumi', kind: 'watch-history', version: 1, exportedAt: 20,
      history: {}, positions: {},
      origins: {
        2: {
          origin: { kind: 'torrent-extension', id: 'remote-origin', name: 'Remote' },
          release: { infoHash: 'abcdef', group: 'NewGroup' },
          updatedAt: 20,
        },
      },
    })

    const merged = importJson(incoming, { includeHistory: false })

    expect(merged.originsImported).toBe(1)
    expect(get(sourceOrigins)[2]).toMatchObject({
      origin: { kind: 'torrent-extension', id: 'remote-origin' },
      release: { infoHash: 'abcdef', group: 'NewGroup' },
      updatedAt: 20,
    })
  })

  it('preserves a valid catalog selection when importing provider-specific history', () => {
    const incoming = JSON.stringify({
      app: 'izumi', kind: 'watch-history', version: 1, exportedAt: 20,
      history: {
        2: {
          media: { id: 2, title: { romaji: 'Imported' } },
          episode: 2,
          progress: 1,
          updatedAt: 20,
          catalogSelection: 'tmdb',
        },
      },
      positions: {},
    })

    importJson(incoming)

    expect(get(localHistory)[2].catalogSelection).toBe('tmdb')
  })

  it('syncs an exact episode source origin', () => {
    const incoming = JSON.stringify({
      app: 'izumi', kind: 'watch-history', version: 1, exportedAt: 20,
      history: {}, positions: {},
      episodeOrigins: {
        '2:4': {
          origin: { kind: 'torrent-extension', id: 'episode-origin' },
          release: { group: 'Group' },
          updatedAt: 20,
        },
      },
    })

    const merged = importJson(incoming, { includeHistory: false })

    expect(merged.episodeOriginsImported).toBe(1)
    expect(get(episodeSourceOrigins)['2:4']).toMatchObject({
      origin: { id: 'episode-origin' },
      release: { group: 'Group' },
    })
  })

  it('exports account-free list status, progress, and score to tracker XML', () => {
    const media = {
      id: 7, idMal: 70, title: { romaji: 'Local Drop' }, episodes: 12,
    } as Media
    saveLocalTracking(media, { status: 'DROPPED', progress: 4, score: 80 })

    const result = exportMalXml()

    expect(result).toMatchObject({ total: 1, skipped: 0 })
    expect(result.xml).toContain('<my_watched_episodes>4</my_watched_episodes>')
    expect(result.xml).toContain('<my_score>8</my_score>')
    expect(result.xml).toContain('<my_status>Dropped</my_status>')
  })

  it('round-trips local list tracking through the Izumi JSON export', () => {
    const media = { id: 8, title: { romaji: 'Offline List' }, episodes: 12 } as Media
    saveLocalTracking(media, { status: 'PAUSED', progress: 5, score: 90 })
    const exported = exportJson()

    localLibrary.set({ lists: [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }], entries: {}, queue: [] })
    importJson(exported)

    expect(get(localLibrary).entries['anilist:anime:8']?.tracking).toEqual({
      status: 'PAUSED', progress: 5, score: 90,
    })
  })
})
