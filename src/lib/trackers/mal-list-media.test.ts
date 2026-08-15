import { describe, expect, it } from 'vitest'
import { mapMalAnimeListMedia } from './mal-list-media'

describe('MAL list card metadata', () => {
  it('maps the embedded MAL list node without requiring AniList metadata', () => {
    const media = mapMalAnimeListMedia({
      id: 5114,
      title: 'Fullmetal Alchemist: Brotherhood',
      main_picture: { medium: 'medium.jpg', large: 'large.jpg' },
      alternative_titles: { en: 'Fullmetal Alchemist: Brotherhood', ja: '鋼の錬金術師', synonyms: ['FMA:B'] },
      start_date: '2009-04-05',
      mean: 9.1,
      num_list_users: 3_400_000,
      media_type: 'tv',
      status: 'finished_airing',
      num_episodes: 64,
      start_season: { year: 2009, season: 'spring' },
      average_episode_duration: 1440,
      rating: 'r',
    }, 11061)

    expect(media).toMatchObject({
      id: 11061,
      idMal: 5114,
      type: 'ANIME',
      format: 'TV',
      status: 'FINISHED',
      episodes: 64,
      duration: 24,
      averageScore: 91,
      popularity: 3_400_000,
      season: 'SPRING',
      seasonYear: 2009,
      coverImage: { extraLarge: 'large.jpg', medium: 'medium.jpg' },
    })
    expect(media.title.native).toBe('鋼の錬金術師')
    expect(media.startDate).toEqual({ year: 2009, month: 4, day: 5 })
  })
})
