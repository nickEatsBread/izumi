import { describe, expect, it } from 'vitest'
import { airingCountdown, airingCountdownAccessible, releasedAgo } from './airing-labels'

describe('airing labels', () => {
  const now = 2_000_000_000_000

  it('uses familiar lowercase countdown units', () => {
    expect(airingCountdown(now / 1000 + 2 * 86_400 + 3 * 3_600, now)).toBe('2d 3h')
    expect(airingCountdown(now / 1000 + 4 * 3_600 + 9 * 60, now)).toBe('4h 9m')
    expect(airingCountdown(now / 1000 + 42, now)).toBe('42s')
  })

  it('provides an unambiguous spoken countdown for compact visual units', () => {
    expect(airingCountdownAccessible(now / 1000 + 2 * 86_400 + 3 * 3_600, now)).toBe('2 days and 3 hours')
    expect(airingCountdownAccessible(now / 1000 + 4 * 3_600 + 1 * 60, now)).toBe('4 hours and 1 minute')
    expect(airingCountdownAccessible(now / 1000 + 1, now)).toBe('1 second')
  })

  it('describes recent releases without noisy seconds after the first minute', () => {
    expect(releasedAgo(now / 1000 - 20, now)).toBe('Just released')
    expect(releasedAgo(now / 1000 - 17 * 60, now)).toBe('Released 17m ago')
    expect(releasedAgo(now / 1000 - 3 * 3_600, now)).toBe('Released 3h ago')
  })
})
