import { describe, expect, it } from 'vitest'
import {
  beginPlaybackOwner,
  cancelPlaybackOwner,
  currentPlaybackOwner,
  invalidatePlaybackOwner,
  ownsPlayback,
} from './playback-owner'

describe('playback ownership', () => {
  it('lets recovery retain the current load but rejects it after a new resolve takes over', () => {
    const owner = beginPlaybackOwner()
    expect(owner).not.toBeNull()
    expect(beginPlaybackOwner(owner!)).toBe(owner)

    invalidatePlaybackOwner()

    expect(ownsPlayback(owner!)).toBe(false)
    expect(beginPlaybackOwner(owner!)).toBeNull()
  })

  it('gives each normal source load a new owner', () => {
    const first = beginPlaybackOwner()
    const second = beginPlaybackOwner()
    expect(first).not.toBe(second)
    expect(currentPlaybackOwner()).toBe(second)
  })

  it('cancels only the load that still owns playback', () => {
    const stale = beginPlaybackOwner()!
    const current = beginPlaybackOwner()!

    expect(cancelPlaybackOwner(stale)).toBe(false)
    expect(currentPlaybackOwner()).toBe(current)
    expect(cancelPlaybackOwner(current)).toBe(true)
    expect(currentPlaybackOwner()).toBeNull()
  })
})
