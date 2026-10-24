import { describe, expect, it } from 'vitest'
import { arrivalDayText, episodeCodeText, episodeNameText, episodeNoText, episodeRatingText, upcomingText } from './episode-fields'

describe('episode template fields', () => {
  it('prints the plain episode number, series-wide when the viewer shows those', () => {
    expect(episodeNoText(12, undefined, false)).toBe('12')
    expect(episodeNoText(12, 1071, false)).toBe('12')
    expect(episodeNoText(12, 1071, true)).toBe('1071')
    expect(episodeNoText(12, undefined, true)).toBe('12')
    expect(episodeNoText(12.5, undefined, false)).toBe('12.5')
  })
  it('codes an episode with its season when the metadata knows it', () => {
    expect(episodeCodeText(5, 2)).toBe('S2 E5')
    expect(episodeCodeText(1, 4, 17)).toBe('S4 E17')
    expect(episodeCodeText(5)).toBe('E5')
    expect(episodeCodeText(5, 0)).toBe('E5')
  })
  it('names an episode only by a title of its own', () => {
    expect(episodeNameText(5, 'From Zero')).toBe('From Zero')
    expect(episodeNameText(5, '  From Zero ')).toBe('From Zero')
    expect(episodeNameText(5, undefined)).toBeUndefined()
    expect(episodeNameText(5, '')).toBeUndefined()
    expect(episodeNameText(5, '   ')).toBeUndefined()
    // The label a list prints in place of a missing title is not a title.
    expect(episodeNameText(5, 'Episode 5')).toBeUndefined()
    // Spoiler protection hides it.
    expect(episodeNameText(5, 'From Zero', true)).toBeUndefined()
  })
  it('rates released episodes out of ten with one decimal', () => {
    expect(episodeRatingText(8.5, true)).toBe('8.5')
    expect(episodeRatingText(8.25, true)).toBe('8.3')
    expect(episodeRatingText(7, true)).toBe('7.0')
    expect(episodeRatingText(84, true)).toBe('8.4')
    expect(episodeRatingText(8.5, false)).toBeUndefined()
    expect(episodeRatingText(undefined, true)).toBeUndefined()
    expect(episodeRatingText(0, true)).toBeUndefined()
    expect(episodeRatingText(Number.NaN, true)).toBeUndefined()
  })
  it('names the day an unaired episode arrives, from its airing time or else its air day', () => {
    // Saturday 24 October 2026, noon UTC: the same calendar day from UTC-11 to UTC+11.
    const now = Date.UTC(2026, 9, 24, 12)
    const at = (day: number) => Date.UTC(2026, 9, day, 12) / 1000
    expect(arrivalDayText(at(30), undefined, now, 'en-US')).toBe('Friday, October 30')
    // The airing time wins over the metadata's day, and decides alone: once due, the day is unknown.
    expect(arrivalDayText(at(30), '2026-11-06', now, 'en-US')).toBe('Friday, October 30')
    expect(arrivalDayText(at(23), '2026-10-31', now, 'en-US')).toBeUndefined()
    // An air day is a calendar day: no time zone moves it.
    expect(arrivalDayText(undefined, '2026-10-31', now, 'en-US')).toBe('Saturday, October 31')
    expect(arrivalDayText(undefined, '2026-10-24', now, 'en-US')).toBe('Saturday, October 24')
    expect(arrivalDayText(undefined, '2026-10-20', now, 'en-US')).toBeUndefined()
    expect(arrivalDayText(undefined, 'TBA', now, 'en-US')).toBeUndefined()
    expect(arrivalDayText(undefined, undefined, now, 'en-US')).toBeUndefined()
    // The viewer's locale orders the words.
    expect(arrivalDayText(undefined, '2026-10-31', now, 'en-GB')).toBe('Saturday 31 October')
  })
  it('says when an unaired episode is coming, and nothing for a released one', () => {
    expect(upcomingText(false, 'Saturday, October 31')).toBe('Coming Saturday, October 31')
    expect(upcomingText(false, undefined)).toBe('Coming soon')
    expect(upcomingText(true, 'Saturday, October 31')).toBeUndefined()
    expect(upcomingText(true, undefined)).toBeUndefined()
  })
})
