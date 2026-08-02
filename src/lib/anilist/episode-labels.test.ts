import { describe, expect, it } from 'vitest'
import { episodeLabels, episodeNumberLabel, episodeSummary } from './episode-labels'

describe('episode labels', () => {
  it('puts a generic label first while concealing an unwatched title', () => {
    expect(episodeLabels(2, 'The Hidden Name', true)).toEqual({
      primary: 'Episode 2',
      secondary: 'The Hidden Name',
      concealSecondary: true,
    })
    expect(episodeSummary(2, 'The Hidden Name', true)).toBe('Episode 2')
  })

  it('restores the ordinary title order once spoilers are allowed', () => {
    expect(episodeLabels(2, 'The Hidden Name', false)).toEqual({
      primary: 'The Hidden Name',
      secondary: 'Episode 2',
      concealSecondary: false,
    })
    expect(episodeSummary(2, 'The Hidden Name', false)).toBe('The Hidden Name')
  })
})

describe('episode number label', () => {
  it('shows the per-season number while series-wide numbering is switched off', () => {
    expect(episodeNumberLabel(5, 231, false)).toBe('5')
    expect(episodeNumberLabel(5, undefined, false)).toBe('5')
  })

  it('shows the series-wide number once the preference is switched on', () => {
    expect(episodeNumberLabel(5, 231, true)).toBe('A231')
  })

  it('keeps the per-season number when no series-wide number is known', () => {
    expect(episodeNumberLabel(5, undefined, true)).toBe('5')
  })

  it('does not restate a number that is already the same', () => {
    // A first season numbers both ways identically; prefixing every row with "A" there is noise.
    expect(episodeNumberLabel(5, 5, true)).toBe('5')
  })
})
