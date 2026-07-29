import { describe, expect, it } from 'vitest'
import {
  beginPlaybackOwner,
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
})
