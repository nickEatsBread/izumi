import { describe, expect, it } from 'vitest'
import { episodeFromSearch } from './episode'

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
