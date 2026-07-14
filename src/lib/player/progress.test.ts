import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import { positionPercent, positions, progressKey, savePosition, watched } from './progress'

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

    expect(get(positions)[progressKey(101, 3)]).toEqual({ pos: 450, dur: 1200 })
    expect(notifications).toBe(2) // initial value + save
    unsubscribe()
    positions.set({})
  })
})
