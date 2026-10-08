import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_SIZE, episodeRanges, openingPage, pageOf, pageSizeFor, searchEpisodes, shownPage } from './episode-ranges'

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

describe('shown page', () => {
  it('follows the next episode until the viewer picks a page', () => {
    expect(shownPage(null, 3, 10)).toBe(3)
    expect(shownPage(1, 3, 10)).toBe(1)
  })
  it('keeps a picked page inside the list when the page count shrinks', () => {
    // Page 10 of 25-episode pages; the list passes 250 episodes and `auto` makes pages of 50.
    expect(shownPage(9, 0, pageCount(260, pageSizeFor(260, 'auto')))).toBe(5)
    expect(shownPage(null, 7, 6)).toBe(5)
  })
  it('never goes below the first page', () => {
    expect(shownPage(-2, 0, 3)).toBe(0)
    expect(shownPage(null, 0, 0)).toBe(0)
  })
})

function pageCount(total: number, per: number) { return Math.max(1, Math.ceil(total / per)) }

describe('opening page', () => {
  it('finds the page holding an episode', () => {
    expect(pageOf(numbers(1, 120), 1, 50)).toBe(0)
    expect(pageOf(numbers(1, 120), 50, 50)).toBe(0)
    expect(pageOf(numbers(1, 120), 51, 50)).toBe(1)
    expect(pageOf(numbers(1051, 1101), 1101, 50)).toBe(1)
    expect(pageOf(numbers(1, 12), 13, 50)).toBe(-1)
  })
  it('opens on the page holding the Play episode', () => {
    // A long-runner resumed at 1100: the range holding it, whatever the page size.
    expect(openingPage(numbers(1, 1150), 100, 1100, 1099)).toBe(10)
    expect(openingPage(numbers(1, 1150), 48, 1100, 1099)).toBe(22)
    // Caught up with an airing show: Play replays the last aired episode, so its page shows rather
    // than the next page of upcoming episodes.
    expect(openingPage(numbers(1, 30), 25, 25, 25)).toBe(0)
    // Offline lists hold only the downloaded episodes.
    expect(openingPage([3, 7, 60], 2, 60, 7)).toBe(1)
  })
  it('falls back to the first episode after the watched ones, else the last page', () => {
    expect(openingPage(numbers(1, 120), 50, 500, 60)).toBe(1)
    expect(openingPage(numbers(1, 120), 50, 500, 200)).toBe(2)
    expect(openingPage([], 50, 1, 0)).toBe(0)
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
