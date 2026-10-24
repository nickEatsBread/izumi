import { describe, expect, it } from 'vitest'
import { episodeForTitle, episodeFromSearch, titleFromSearch } from './episode'

describe('episodeForTitle', () => {
  it('reads a plain trailing number as the episode once a title is picked', () => {
    expect(episodeForTitle('quiet harbor 12', ['Quiet Harbor'])).toEqual({ episode: 12 })
    expect(episodeForTitle('quiet harbor ep 3', ['Quiet Harbor'])).toEqual({ episode: 3 })
    expect(episodeForTitle('quiet harbor s02e05', ['Quiet Harbor'])).toEqual({ season: 2, episode: 5 })
  })
  it('keeps a number that belongs to the title, a year, or nothing at all', () => {
    expect(episodeForTitle('harbor 100', ['Harbor 100'])).toBeUndefined()
    expect(episodeForTitle('harbor 100', ['Other name', 'Harbor 100: Part One'])).toBeUndefined()
    expect(episodeForTitle('quiet harbor 2023', ['Quiet Harbor'])).toBeUndefined()
    expect(episodeForTitle('quiet harbor', ['Quiet Harbor'])).toBeUndefined()
  })
})

describe('titleFromSearch', () => {
  it.each([
    ['quiet harbor 12', 'quiet harbor 12'],
    ['quiet harbor ep 12', 'quiet harbor'],
    ['Quiet Harbor S02E05 1080p', 'Quiet Harbor'],
    ['quiet harbor - 05 [1080p] x265 10bit', 'quiet harbor'],
    ['quiet harbor season 2 05 web-dl', 'quiet harbor'],
    ['quiet harbor 2023', 'quiet harbor 2023'],
  ])('reads the title in %s', (text, title) => {
    expect(titleFromSearch(text)).toBe(title)
  })
})

describe('episodeFromSearch', () => {
  it.each([
    ['quiet harbor s01e05 1080p', { season: 1, episode: 5 }],
    ['Quiet Harbor S2E12', { season: 2, episode: 12 }],
    ['quiet harbor ep 5', { episode: 5 }],
    ['quiet harbor episode 07', { episode: 7 }],
    ['quiet harbor E05', { episode: 5 }],
    ['quiet harbor - 05', { episode: 5 }],
    ['quiet harbor 05 720p', { episode: 5 }],
    ['quiet harbor season 2 05', { season: 2, episode: 5 }],
    ['quiet harbor 012', { episode: 12 }],
    ['long harbor - 1080', { episode: 1080 }],
  ])('reads %s', (text, want) => {
    expect(episodeFromSearch(text)).toEqual(want)
  })

  it.each([
    'quiet harbor 1080p',
    'quiet harbor 720',
    'quiet harbor 2023',
    'quiet harbor x265 hevc 10bit',
    'quiet harbor season 2',
    'quiet harbor',
    // A plain number is too often part of the title (or a cour, or a bit depth) to pick a file by.
    'quiet harbor 100',
    'quiet harbor 12',
    'quiet harbor part 2',
    'quiet harbor 10 bit',
    'quiet harbor (01-12) batch',
    'quiet harbor 2023-05',
    'quiet harbor s01e00',
  ])('finds no episode in %s', (text) => {
    expect(episodeFromSearch(text)).toBeUndefined()
  })
})
