import { describe, expect, it } from 'vitest'
import { compactCountdown, longCountdown } from './countdown'

describe('airing countdown text', () => {
  it('uses the two largest units in compact form', () => {
    expect(compactCountdown(2 * 86400 + 21 * 3600 + 5)).toBe('2d 21h')
    expect(compactCountdown(5 * 3600 + 7 * 60)).toBe('5h 7m')
    expect(compactCountdown(30)).toBe('1m')
    expect(compactCountdown(-5)).toBe('1m')
  })
  it('spells units out in long form with singulars', () => {
    expect(longCountdown(86400 + 3600 + 60)).toBe('1 day 1 hr 1 min')
    expect(longCountdown(4 * 86400 + 19 * 3600 + 43 * 60)).toBe('4 days 19 hrs 43 mins')
    expect(longCountdown(2 * 86400 + 30 * 60)).toBe('2 days 0 hrs 30 mins')
    expect(longCountdown(45 * 60)).toBe('45 mins')
  })
})
