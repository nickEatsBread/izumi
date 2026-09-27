import { describe, expect, it } from 'vitest'
import { episodeCodeText, episodeNoText, episodeRatingText } from './episode-fields'

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
})
