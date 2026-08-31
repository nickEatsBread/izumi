import { describe, expect, it } from 'vitest'
import { catalogCollections, episodeCountsFor } from './catalog'
import type { CompanionHomeSnapshot, CompanionMedia } from '../types'

const media = (id: string, type: string, extra: Partial<CompanionMedia> = {}): CompanionMedia => ({
  ref: { provider: 'anilist', id, type },
  title: id,
  ...extra,
})

const snapshot = (items: CompanionMedia[]): CompanionHomeSnapshot => ({
  app: 'izumi',
  kind: 'companion-home',
  version: 1,
  revision: 'test',
  generatedAt: 1,
  catalog: { screen: 'anilist', label: 'AniList' },
  rows: [{ id: 'recommended', title: 'For You', kind: 'catalog', items }],
})

describe('TV catalogue collections', () => {
  it('does not present series as movies or recommendations as My List', () => {
    const series = media('series', 'anime')
    const movie = media('movie', 'movie')
    const saved = media('saved', 'anime', { inMyList: true })
    const result = catalogCollections(snapshot([series, movie, saved]))

    expect(result.movies).toEqual([movie])
    expect(result.myList).toEqual([saved])
    expect(result.trending).toEqual([])
  })

  it('never fabricates an episode count', () => {
    expect(episodeCountsFor(media('unknown', 'anime', { subtitle: '2 seasons' }))).toEqual([])
    expect(episodeCountsFor(media('known', 'anime', {
      episodes: [
        { season: 1, episode: 1 },
        { season: 1, episode: 4 },
        { season: 2, episode: 2 },
      ],
    }))).toEqual([4, 2])
  })
})
