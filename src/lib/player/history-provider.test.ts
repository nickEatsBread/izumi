import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { mediaSnapshot } from './history'

describe('provider media history snapshot', () => {
  it('retains the native identity and compact episode coordinates needed after restart', () => {
    const media = {
      id: -10,
      type: 'SERIES',
      format: 'TV',
      title: { romaji: 'Example', userPreferred: 'Example' },
      catalog: { provider: 'tmdb', type: 'series', id: '1399' },
      externalIds: { tmdb: 1399, imdb: 'tt0944947' },
      videos: [{
        id: '63056', number: 14, season: 2, episode: 4,
        title: 'Garden of Bones', overview: 'Large text is intentionally discarded',
        thumbnail: 'https://image.test/still.jpg',
      }],
    } as Media

    expect(mediaSnapshot(media)).toMatchObject({
      catalog: { provider: 'tmdb', type: 'series', id: '1399' },
      externalIds: { tmdb: 1399, imdb: 'tt0944947' },
      videos: [{ id: '63056', number: 14, season: 2, episode: 4, title: 'Garden of Bones' }],
    })
    expect(mediaSnapshot(media).videos?.[0].overview).toBeUndefined()
    expect(mediaSnapshot(media).videos?.[0].thumbnail).toBeUndefined()
  })
})
