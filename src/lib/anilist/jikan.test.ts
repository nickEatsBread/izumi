import { describe, expect, it } from 'vitest'
import { aniListCatalogFailure, mapJikanMedia, parseJikanCatalogRequest } from './jikan'

describe('Jikan catalog fallback', () => {
  it('only recognizes the public catalog operations', () => {
    const body = (operation: string) => JSON.stringify({ query: `query ${operation} { Page { media { id } } }` })
    expect(parseJikanCatalogRequest(body('Hero'))?.operation).toBe('Hero')
    expect(parseJikanCatalogRequest(body('Search'))?.operation).toBe('Search')
    expect(parseJikanCatalogRequest(body('MediaById'))).toBeNull()
    expect(parseJikanCatalogRequest(body('Lists'))).toBeNull()
  })

  it('normalizes Jikan cards without substituting the MAL id for the AniList id', () => {
    const media = mapJikanMedia({
      mal_id: 52991,
      title: 'Sousou no Frieren',
      title_english: "Frieren: Beyond Journey's End",
      title_japanese: '葬送のフリーレン',
      type: 'TV',
      status: 'Finished Airing',
      score: 9.31,
      members: 900_000,
      duration: '1 hr 34 min',
      season: 'fall',
      year: 2023,
      aired: { from: '2023-09-29T00:00:00+00:00' },
      images: { webp: { large_image_url: 'https://img.test/frieren.webp' } },
      genres: [{ mal_id: 10, name: 'Fantasy' }],
      studios: [{ mal_id: 314, name: 'Madhouse' }],
      trailer: { youtube_id: 'abc123' },
    }, 154587)

    expect(media).toMatchObject({
      id: 154587,
      idMal: 52991,
      format: 'TV',
      status: 'FINISHED',
      averageScore: 93,
      duration: 94,
      season: 'FALL',
      seasonYear: 2023,
      startDate: { year: 2023, month: 9, day: 29 },
      trailer: { id: 'abc123', site: 'youtube' },
    })
  })

  it('preserves AniList shutdown details for the warning dialog', async () => {
    const response = Response.json({
      errors: [{ message: 'The AniList API has been temporarily disabled due to severe stability issues.' }],
    })
    await expect(aniListCatalogFailure(response)).resolves.toBe(
      '[GraphQL] The AniList API has been temporarily disabled due to severe stability issues.',
    )
  })
})
