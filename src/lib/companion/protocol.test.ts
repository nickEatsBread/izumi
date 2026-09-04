import { describe, expect, it } from 'vitest'
import { companionMedia, isCompanionSnapshot, parseCompanionPairingLink } from './protocol'

describe('companion pairing protocol', () => {
  const valid = 'izumi://companion/pair?v=1&tv=192.168.4.20&device=0123456789abcdef01234567&challenge=0123456789abcdef0123456789abcdef'

  it('accepts a bounded private-LAN challenge', () => {
    expect(parseCompanionPairingLink(valid)).toEqual({
      protocol: 1,
      address: '192.168.4.20',
      deviceId: '0123456789abcdef01234567',
      challenge: '0123456789abcdef0123456789abcdef',
    })
  })

  it('rejects remote hosts and malformed identities', () => {
    expect(parseCompanionPairingLink(valid.replace('192.168.4.20', 'example.com'))).toBeNull()
    expect(parseCompanionPairingLink(valid.replace('0123456789abcdef01234567', 'short'))).toBeNull()
    expect(parseCompanionPairingLink(valid.replace('v=1', 'v=2'))).toBeNull()
  })
})

describe('companion home snapshot', () => {
  it('normalizes a catalog Media without exposing provider credentials', () => {
    const item = companionMedia({
      id: -12,
      catalog: { provider: 'tmdb', id: '1399', type: 'series' },
      title: { english: 'Example show' },
      description: '<b>Summary</b><br>line two',
      contentRating: 'TV-14',
      originalLanguage: 'ja',
      genres: ['Drama', 'Fantasy'],
      startDate: { year: 2025 },
      duration: 52,
      ratings: [{ source: 'TMDB', score: 8.4, scale: 10, votes: 2345 }],
      episodes: 10,
      mediaListEntry: { progress: 4 },
      coverImage: { large: 'https://img.example/poster.jpg' },
      logoImage: 'https://img.example/title-logo.png',
      trailer: { id: 'exampleTrailer', site: 'youtube' },
      featuredRank: { position: 2, label: 'Popular Series Today' },
      relations: {
        edges: [{
          relationType: 'SEQUEL',
          node: {
            id: -13,
            catalog: { provider: 'tmdb', id: '1400', type: 'series' },
            type: 'SERIES',
            title: { english: 'Example show: season two' },
            seasonYear: 2026,
            format: 'TV',
            episodes: 8,
            coverImage: { large: 'https://img.example/season-two.jpg' },
          },
        }],
      },
      recommendations: {
        nodes: [{
          mediaRecommendation: {
            id: -14,
            catalog: { provider: 'tmdb', id: '1401', type: 'series' },
            title: { english: 'A thoughtful recommendation' },
            episodes: 12,
          },
        }],
      },
      characters: { edges: [{
        role: 'Detective',
        node: { id: 101, name: { full: 'Actor One' }, image: { large: 'https://img.example/actor.jpg' } },
      }] },
      staff: { edges: [{
        role: 'Director',
        node: { id: 202, name: { full: 'Director Two' }, image: { large: 'https://img.example/director.jpg' } },
      }] },
    }, {
      episodeTitle: 'The next chapter',
      episodeImage: 'https://img.example/episode.jpg',
      season: 1,
      episodeProgress: 0.625,
      episodeRuntimeMinutes: 24,
      episodes: [{
        season: 1,
        episode: 5,
        title: 'The next chapter',
        description: 'The journey continues.',
        runtimeMinutes: 24,
        progress: 0.625,
      }],
    })
    expect(item).toMatchObject({
      mediaId: -12,
      ref: { provider: 'tmdb', id: '1399', type: 'series' },
      resolver: { streamType: 'series' },
      title: 'Example show',
      description: 'Summary line two',
      contentRating: 'TV-14',
      mediaKind: 'show',
      genres: ['Drama', 'Fantasy'],
      releaseYear: 2025,
      runtimeMinutes: 52,
      ratings: [{ source: 'TMDB', score: 8.4, scale: 10, votes: 2345 }],
      achievements: [
        { kind: 'popularity', label: '#2 Popular Series Today', source: 'tmdb' },
        { kind: 'score', label: '84% user score', source: 'TMDB' },
      ],
      logoImage: 'https://img.example/title-logo.png',
      trailer: { id: 'exampleTrailer', site: 'youtube', language: 'ja' },
      progress: 0.4,
      episode: 5,
      episodeTitle: 'The next chapter',
      episodeImage: 'https://img.example/episode.jpg',
      season: 1,
      episodeProgress: 0.625,
      episodeRuntimeMinutes: 24,
      episodes: [{
        season: 1,
        episode: 5,
        title: 'The next chapter',
        description: 'The journey continues.',
        runtimeMinutes: 24,
        progress: 0.625,
      }],
      relations: [{
        relationType: 'SEQUEL',
        media: {
          ref: { provider: 'tmdb', id: '1400', type: 'series' },
          resolver: { streamType: 'series' },
          title: 'Example show: season two',
          subtitle: '2026 · TV',
          seasonEpisodeCounts: [8],
        },
      }],
      recommendations: [{
        ref: { provider: 'tmdb', id: '1401', type: 'series' },
        resolver: { streamType: 'series' },
        title: 'A thoughtful recommendation',
        seasonEpisodeCounts: [12],
      }],
      cast: [{
        id: '101', provider: 'tmdb', name: 'Actor One', role: 'Detective',
        image: 'https://img.example/actor.jpg', credit: 'cast',
      }],
      crew: [{
        id: '202', provider: 'tmdb', name: 'Director Two', role: 'Director',
        image: 'https://img.example/director.jpg', credit: 'crew',
      }],
      placement: { position: 2, label: 'Popular Series Today', kind: 'ranking' },
    })
    expect(JSON.stringify(item)).not.toMatch(/token|api.?key|addonUrls/i)
  })

  it('preserves the movie stream type for AniList media', () => {
    const item = companionMedia({
      id: 1,
      format: 'MOVIE',
      title: { english: 'Example movie' },
    })
    expect(item).toMatchObject({
      ref: { provider: 'anilist', id: '1', type: 'anime' },
      resolver: { streamType: 'movie' },
    })
    expect(item).not.toHaveProperty('episode')
  })

  it('projects AniList rankings as factual, varied achievements', () => {
    const item = companionMedia({
      id: 11757,
      title: { english: 'Sword Art Online' },
      seasonYear: 2012,
      format: 'TV',
      episodes: 25,
      genres: ['Action', 'Adventure'],
      rankings: [
        { rank: 13, type: 'POPULAR', allTime: true, context: 'most popular all time' },
        { rank: 59, type: 'RATED', allTime: false, context: 'highest rated', year: 2012 },
      ],
    })
    expect(item.achievements).toEqual([
      { kind: 'popularity', label: '#13 most popular all time', source: 'AniList' },
      { kind: 'rating', label: '#59 highest rated 2012', source: 'AniList' },
    ])
    expect(item).toMatchObject({
      mediaKind: 'show',
      genres: ['Action', 'Adventure'],
      releaseYear: 2012,
      seasonEpisodeCounts: [25],
    })
  })

  it('recognizes only the versioned snapshot envelope', () => {
    expect(isCompanionSnapshot({
      app: 'izumi', kind: 'companion-home', version: 1,
      revision: 'one', generatedAt: 1, rows: [],
    })).toBe(true)
    expect(isCompanionSnapshot({ app: 'izumi', kind: 'companion-home', version: 2, rows: [] })).toBe(false)
  })
})
