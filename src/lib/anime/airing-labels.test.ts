import { describe, expect, it } from 'vitest'
import { airingCountdown, releasedAgo } from './airing-labels'

describe('airing labels', () => {
  const now = 2_000_000_000_000

  it('uses the compact Miruro-style countdown units', () => {
    expect(airingCountdown(now / 1000 + 2 * 86_400 + 3 * 3_600, now)).toBe('2D 3H')
    expect(airingCountdown(now / 1000 + 4 * 3_600 + 9 * 60, now)).toBe('4H 9M')
    expect(airingCountdown(now / 1000 + 42, now)).toBe('42s')
  })

  it('describes recent releases without noisy seconds after the first minute', () => {
    expect(releasedAgo(now / 1000 - 20, now)).toBe('Just released')
    expect(releasedAgo(now / 1000 - 17 * 60, now)).toBe('Released 17m ago')
    expect(releasedAgo(now / 1000 - 3 * 3_600, now)).toBe('Released 3h ago')
  })
})
