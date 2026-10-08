import { describe, expect, it } from 'vitest'
import { airingDate, countdownShown, fullCountdown, wordsCountdown } from './airing-countdown'

const time = (d: number, h: number, m: number, s = 0) => d * 86_400 + h * 3600 + m * 60 + s

describe('words countdown', () => {
  it('names the two largest units in words', () => {
    expect(wordsCountdown(time(2, 3, 4, 5))).toBe('2 days 3 hours')
    expect(wordsCountdown(time(1, 1, 0))).toBe('1 day 1 hour')
    expect(wordsCountdown(time(4, 0, 59))).toBe('4 days 0 hours')
    expect(wordsCountdown(time(0, 3, 4))).toBe('3 hours 4 minutes')
    expect(wordsCountdown(time(0, 1, 1))).toBe('1 hour 1 minute')
  })
  it('keeps at least a minute in the last hour', () => {
    expect(wordsCountdown(time(0, 0, 17))).toBe('17 minutes')
    expect(wordsCountdown(time(0, 0, 0, 40))).toBe('1 minute')
  })
})

describe('full countdown', () => {
  it('shows every unit down to seconds, zeros included', () => {
    expect(fullCountdown(time(2, 3, 4, 5))).toBe('2 days 3 hrs 4 mins 5 secs')
    expect(fullCountdown(time(0, 0, 0, 9))).toBe('0 days 0 hrs 0 mins 9 secs')
    expect(fullCountdown(time(1, 1, 1, 1))).toBe('1 day 1 hr 1 min 1 sec')
    expect(fullCountdown(time(27, 23, 59, 59.9))).toBe('27 days 23 hrs 59 mins 59 secs')
  })
})

describe('airing date', () => {
  // Sunday 2 August 2026, 16:16 UTC.
  const at = Date.UTC(2026, 7, 2, 16, 16) / 1000
  it('prints the day and the time on the locale clock', () => {
    expect(airingDate(at, { locale: 'en-US', timeZone: 'UTC' })).toBe('Sun, Aug 2 at 4:16 PM')
    expect(airingDate(at, { locale: 'en-GB', timeZone: 'UTC' })).toBe('Sun 2 Aug at 16:16')
  })
  it('uses the viewer time zone', () => {
    expect(airingDate(at, { locale: 'en-US', timeZone: 'Asia/Tokyo' })).toBe('Mon, Aug 3 at 1:16 AM')
  })
})

describe('countdown visibility', () => {
  it('shows an episode still to come', () => {
    expect(countdownShown(60)).toBe(true)
    expect(countdownShown(0)).toBe(false)
    expect(countdownShown(-5)).toBe(false)
  })
  it('hides an episode further away than the theme allows', () => {
    expect(countdownShown(time(28, 0, 0), 28)).toBe(true)
    expect(countdownShown(time(28, 0, 0, 1), 28)).toBe(false)
    expect(countdownShown(time(93, 19, 31), 28)).toBe(false)
    expect(countdownShown(time(93, 19, 31))).toBe(true)
  })
})
