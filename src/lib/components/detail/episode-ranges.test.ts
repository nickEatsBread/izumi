import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_SIZE, episodeRanges, pageSizeFor, searchEpisodes } from './episode-ranges'

const numbers = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe('episode page size', () => {
  it('keeps 48 unless the theme sets a size', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(48)
    expect(pageSizeFor(1000)).toBe(48)
    expect(pageSizeFor(1000, 50)).toBe(50)
  })
  it('picks 25, 50 or 100 by length on auto', () => {
    expect(pageSizeFor(24, 'auto')).toBe(25)
    expect(pageSizeFor(249, 'auto')).toBe(25)
    expect(pageSizeFor(250, 'auto')).toBe(50)
    expect(pageSizeFor(499, 'auto')).toBe(50)
    expect(pageSizeFor(500, 'auto')).toBe(100)
    expect(pageSizeFor(1155, 'auto')).toBe(100)
  })
})

describe('episode ranges', () => {
  it('labels each page by its printed first and last episode', () => {
    expect(episodeRanges(numbers(1, 120), 50)).toEqual(['1–50', '51–100', '101–120'])
    expect(episodeRanges(numbers(1051, 1101), 50)).toEqual(['1051–1100', '1101'])
    expect(episodeRanges(numbers(1, 100), 100, String, ' – ')).toEqual(['1 – 100'])
    expect(episodeRanges([], 50)).toEqual([])
  })
  it('prints the numbers the list shows', () => {
    expect(episodeRanges([1, 2, 3, 4], 2, (episode) => String(episode + 12))).toEqual(['13–14', '15–16'])
  })
})

describe('episode search', () => {
  const meta = { 1: { title: 'Romance Dawn' }, 10: { title: 'The Strongest Crew' }, 21: { title: 'Episode of 10 bounties' } }
  const list = [1, 10, 21, 100, 105, 110]
  it('has nothing to filter by for an empty query', () => {
    expect(searchEpisodes(list, '  ', meta)).toBeNull()
    expect(searchEpisodes(list, 'Episode ', meta)).toBeNull()
  })
  it('ranks number-prefix matches before every other match, each in list order', () => {
    expect(searchEpisodes(list, '10', meta)).toEqual([10, 100, 105, 21, 110])
    expect(searchEpisodes(list, 'ep 10', meta)).toEqual([10, 100, 105, 21, 110])
  })
  it('matches titles case-insensitively and series-wide numbers', () => {
    expect(searchEpisodes(list, 'dawn', meta)).toEqual([1])
    expect(searchEpisodes([1, 2], '1071', { 1: { abs: 1071 }, 2: { abs: 1072 } })).toEqual([1])
    expect(searchEpisodes(list, 'zzz', meta)).toEqual([])
  })
})
