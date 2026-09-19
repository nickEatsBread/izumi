import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { episodeDisplayModel, mediaDisplayModel } from './host-model'
import { displayText } from './presentation'

const media = {
  id: 1,
  title: { userPreferred: 'Sakura', romaji: 'Sakura', english: 'Sakura' },
  description: '<i>A story.</i>',
  averageScore: 78,
  format: 'TV',
  season: 'WINTER',
  seasonYear: 2021,
  status: 'RELEASING',
  duration: 24,
  episodes: 12,
  popularity: 15000,
  genres: ['Drama', 'Fantasy'],
  studios: { nodes: [{ id: 9, name: 'White Fox' }] },
  coverImage: { extraLarge: 'https://example.test/poster.jpg', medium: 'https://example.test/poster-m.jpg' },
  bannerImage: 'https://example.test/banner.jpg',
  startDate: { year: 2021 },
} as Media

describe('theme host display model', () => {
  it('exposes series fields as the shared contract types', () => {
    const model = mediaDisplayModel(media)
    expect(model.title).toBe('Sakura')
    expect(model.description).toBe('A story.')
    expect(model.score).toBe(78)
    expect(model.studio).toBe('White Fox')
    expect(model.genres).toContain('Drama')
    expect(model.episodeCount).toBe('12')
    expect(model.duration).toBe(24)
    expect(displayText('score', model)).toBe('78%')
    expect(displayText('duration', model)).toBe('24m')
  })
  it('adds episode stills, titles and progress without stringifying numbers', () => {
    const model = episodeDisplayModel(media, 8, {
      title: 'From Zero',
      overview: 'The next step.',
      image: 'https://example.test/still.jpg',
      runtime: 24,
      airDate: '2021-03-01',
    }, { progress: 42, score: 91 })
    expect(model.episodeNumber).toBe(8)
    expect(model.episodeTitle).toBe('From Zero')
    expect(model.still).toContain('still.jpg')
    expect(model.progress).toBe(42)
    expect(model.score).toBe(91)
    expect(displayText('progress', model)).toBe('42%')
  })
})
