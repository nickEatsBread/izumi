import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import { clearPosition, positionPercent, positions, progressKey, savePosition, watched, episodeBarPercent } from './progress'

describe('progress helpers', () => {
  it('keys by media + episode', () => expect(progressKey(101, 3)).toBe('101:3'))
  it('watched() true at/above 85% with a known duration', () => {
    expect(watched(850, 1000)).toBe(true)
    expect(watched(840, 1000)).toBe(false)
    expect(watched(10, 0)).toBe(false) // unknown duration
  })
  it('normalizes saved progress for the UI', () => {
    expect(positionPercent({ pos: 300, dur: 1200 })).toBe(0.25)
    expect(positionPercent({ pos: 1300, dur: 1200 })).toBe(1)
    expect(positionPercent({ pos: -10, dur: 1200 })).toBe(0)
    expect(positionPercent({ pos: 10, dur: 0 })).toBe(0)
  })
  it('publishes each throttled player save to live UI subscribers', () => {
    positions.set({})
    let notifications = 0
    const unsubscribe = positions.subscribe(() => notifications++)

    savePosition(101, 3, 450, 1200)

    expect(get(positions)[progressKey(101, 3)]).toMatchObject({ pos: 450, dur: 1200 })
    expect(get(positions)[progressKey(101, 3)].updatedAt).toEqual(expect.any(Number))
    expect(notifications).toBe(2) // initial value + save
    unsubscribe()
    positions.set({})
  })
  it('keeps a timestamped tombstone when a synced resume position is cleared', () => {
    positions.set({ '101:3': { pos: 450, dur: 1200, updatedAt: 1 } })
    clearPosition(101, 3)
    expect(get(positions)['101:3']).toMatchObject({ pos: 0, dur: 1200, cleared: true })
    expect(get(positions)['101:3'].updatedAt).toEqual(expect.any(Number))
    positions.set({})
  })

  describe('bounded growth (prune on write)', () => {
    it('drops cleared tombstones older than the TTL on the next save', () => {
      // A completed episode leaves a `cleared` tombstone; long-expired ones (completion long since
      // synced) must not pin storage forever. `updatedAt: 1` is ~1970 → far past the 30-day TTL.
      positions.set({
        '1:1': { pos: 0, dur: 1200, updatedAt: 1, cleared: true }, // ancient tombstone → evicted
        '2:2': { pos: 300, dur: 1200, updatedAt: Date.now() },      // fresh active entry → kept
      })
      savePosition(3, 3, 100, 1200) // triggers prune
      const p = get(positions)
      expect(p['1:1']).toBeUndefined()
      expect(p['2:2']).toBeDefined()
      expect(p['3:3']).toBeDefined()
      positions.set({})
    })
    it('caps the map to the most-recently-touched entries', () => {
      const seed: Record<string, { pos: number; dur: number; updatedAt: number }> = {}
      for (let i = 1; i <= 600; i++) seed[`${i}:1`] = { pos: 10, dur: 100, updatedAt: i }
      positions.set(seed)
      savePosition(9999, 1, 50, 100) // newest → must survive; oldest must be evicted
      const p = get(positions)
      expect(Object.keys(p).length).toBe(500)
      expect(p['9999:1']).toBeDefined() // newest kept
      expect(p['1:1']).toBeUndefined()  // oldest (updatedAt 1) evicted
      expect(p['600:1']).toBeDefined()  // recent kept
      positions.set({})
    })
  })

  describe('episodeBarPercent (per-episode progress bar)', () => {
    it('shows the ACTUAL saved position for a partly-watched episode, even once the tracker counts it', () => {
      // The 85% watch-threshold bumps the whole-episode count (trackedDone=true) while the player
      // keeps saving a real position. The bar must reflect the real 87%, not snap to a full 100.
      expect(episodeBarPercent({ pos: 870, dur: 1000 }, true)).toBe(87)
    })
    it('shows the actual position for an in-progress (not-yet-counted) episode', () => {
      expect(episodeBarPercent({ pos: 400, dur: 1000 }, false)).toBe(40)
    })
    it('falls back to a full bar for a finished episode whose position was cleared on EOF', () => {
      // player-ended → clearPosition sets pos:0; the tracker still counts it → full bar.
      expect(episodeBarPercent({ pos: 0, dur: 1000, cleared: true }, true)).toBe(100)
    })
    it('falls back to a full bar for an episode watched elsewhere (counted, no local position)', () => {
      expect(episodeBarPercent(undefined, true)).toBe(100)
    })
    it('is empty for an unwatched episode with no saved position', () => {
      expect(episodeBarPercent(undefined, false)).toBe(0)
    })
    it('is empty for an unreleased episode regardless of tracker/position state', () => {
      expect(episodeBarPercent({ pos: 500, dur: 1000 }, true, false)).toBe(0)
    })
  })
})
