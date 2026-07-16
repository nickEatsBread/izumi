import { afterEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { localHistory } from './history'
import { exportJson, importJson } from './history-io'
import { positions } from './progress'
import { sourceOrigins } from './source-origin'

const bundle = (position: Record<string, unknown>) => JSON.stringify({
  app: 'izumi', kind: 'watch-history', version: 1, exportedAt: 1,
  history: {}, positions: position,
})

describe('watch history import merge', () => {
  afterEach(() => { localHistory.set({}); positions.set({}); sourceOrigins.set({}) })

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
    expect(merged).toEqual({ imported: 0, positionsImported: 1, originsImported: 0 })
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
})
