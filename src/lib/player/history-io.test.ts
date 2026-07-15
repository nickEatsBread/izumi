import { afterEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { localHistory } from './history'
import { importJson } from './history-io'
import { positions } from './progress'

const bundle = (position: Record<string, unknown>) => JSON.stringify({
  app: 'izumi', kind: 'watch-history', version: 1, exportedAt: 1,
  history: {}, positions: position,
})

describe('watch history import merge', () => {
  afterEach(() => { localHistory.set({}); positions.set({}) })

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
})
