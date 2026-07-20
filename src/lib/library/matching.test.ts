import { describe, expect, it } from 'vitest'
import { bestMediaMatch, parseEpisodeFilename, titleSimilarity } from './matching'

describe('local library filename matching', () => {
  it('parses common fansub names', () => {
    expect(parseEpisodeFilename('[SubsPlease] Frieren - 28 (1080p) [ABC].mkv')).toMatchObject({ title: 'Frieren', episode: 28 })
  })

  it('parses season and episode tokens', () => {
    expect(parseEpisodeFilename('My.Hero.Academia.S07E04.1080p.WEB-DL.mkv')).toMatchObject({
      title: 'My Hero Academia', season: 7, episode: 4,
    })
  })

  it('parses a bare episode number for season-folder libraries', () => {
    expect(parseEpisodeFilename('04.mkv')).toMatchObject({ episode: 4 })
  })

  it('matches alternate punctuation and title spellings', () => {
    expect(titleSimilarity('Bocchi the Rock!', 'Bocchi.The.Rock')).toBe(1)
    const hit = bestMediaMatch(parseEpisodeFilename('Sousou no Frieren - 12.mkv'), [
      { id: 1, title: { romaji: 'One Piece' } },
      { id: 2, title: { romaji: 'Sousou no Frieren', english: 'Frieren: Beyond Journey’s End' } },
    ])
    expect(hit?.media.id).toBe(2)
    expect(hit?.confidence).toBeGreaterThan(0.9)
  })
})
