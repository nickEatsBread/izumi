import { describe, expect, it } from 'vitest'
import { episodeLabels, episodeSummary } from './episode-labels'

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
