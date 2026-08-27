import { describe, expect, it } from 'vitest'
import { shouldBeginNextEpisodePreload } from './preload-policy'

describe('next-episode preload timing', () => {
  it('gives an ordinary anime episode about eight minutes to resolve and buffer', () => {
    const duration = 24 * 60
    expect(shouldBeginNextEpisodePreload(15 * 60, duration)).toBe(false)
    expect(shouldBeginNextEpisodePreload(16 * 60, duration)).toBe(true)
  })

  it('starts in the final third of a short episode instead of waiting for 85%', () => {
    const duration = 5 * 60
    expect(shouldBeginNextEpisodePreload(3 * 60, duration)).toBe(false)
    expect(shouldBeginNextEpisodePreload(3.25 * 60, duration)).toBe(true)
  })

  it('does not mint expiring URLs more than eight minutes before the end of a long video', () => {
    const duration = 90 * 60
    expect(shouldBeginNextEpisodePreload(duration - 8 * 60 - 1, duration)).toBe(false)
    expect(shouldBeginNextEpisodePreload(duration - 8 * 60, duration)).toBe(true)
  })

  it('rejects invalid progress samples', () => {
    expect(shouldBeginNextEpisodePreload(-1, 100)).toBe(false)
    expect(shouldBeginNextEpisodePreload(1, 0)).toBe(false)
    expect(shouldBeginNextEpisodePreload(Number.NaN, 100)).toBe(false)
  })
})
