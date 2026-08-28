import { describe, expect, it } from 'vitest'
import { catalogHomeLayoutFromRows, catalogHomeLayoutKey, resolveCatalogHomeRows } from './home-layout'
import { TMDB_HOME_ROWS } from './home-options'

describe('catalog Home layouts', () => {
  it('preserves the existing TMDB Home as the focused default', () => {
    expect(resolveCatalogHomeRows('tmdb', TMDB_HOME_ROWS, {}).filter((row) => row.enabled).map((row) => row.id)).toEqual([
      'continue', 'trending', 'anime-series', 'anime-movies', 'movies', 'series',
      'rated-movies', 'rated-series', 'upcoming',
    ])
  })

  it('offers broad TMDB presets without enabling every network request', () => {
    const ids = new Set(TMDB_HOME_ROWS.map((row) => row.id))
    expect(TMDB_HOME_ROWS.length).toBeGreaterThanOrEqual(35)
    for (const id of [
      'trending-today', 'trending-movies', 'now-playing', 'airing-today',
      'action-movies', 'horror-movies', 'sci-fi-fantasy-series', 'rated-anime-series',
    ]) expect(ids.has(id)).toBe(true)
    expect(TMDB_HOME_ROWS.filter((row) => row.defaultEnabled === false).length).toBeGreaterThan(20)
  })

  it('repairs order, removes unknown ids, and respects saved visibility', () => {
    const rows = resolveCatalogHomeRows('tmdb', TMDB_HOME_ROWS, {
      tmdb: {
        order: ['now-playing', 'trending', 'removed-row', 'now-playing'],
        disabled: ['trending'],
      },
    })
    expect(rows.slice(0, 2).map((row) => row.id)).toEqual(['now-playing', 'trending'])
    expect(rows.find((row) => row.id === 'now-playing')?.enabled).toBe(true)
    expect(rows.find((row) => row.id === 'trending')?.enabled).toBe(false)
    expect(rows.some((row) => row.id === 'removed-row')).toBe(false)
  })

  it('keeps newly introduced opt-in rows off for an existing saved layout', () => {
    const options = [
      { id: 'existing', title: 'Existing', defaultEnabled: true },
      { id: 'new', title: 'New', defaultEnabled: false },
    ]
    const rows = resolveCatalogHomeRows('tmdb', options, { tmdb: { order: ['existing'], disabled: [] } })
    expect(rows.find((row) => row.id === 'new')?.enabled).toBe(false)
  })

  it('shares one anime layout between Automatic anime and AniList', () => {
    expect(catalogHomeLayoutKey('auto')).toBe('anilist')
    expect(catalogHomeLayoutKey('anilist')).toBe('anilist')
  })

  it('keeps the merged layout independent from every provider layout', () => {
    expect(catalogHomeLayoutKey('merged')).toBe('merged')
    const options = [
      { id: 'continue', title: 'Continue Watching' },
      { id: 'tmdb:trending', title: 'Trending' },
    ]
    expect(resolveCatalogHomeRows('merged', options, {
      tmdb: { order: ['trending'], disabled: [] },
      merged: { order: ['tmdb:trending', 'continue'], disabled: ['continue'] },
    }).map((row) => [row.id, row.enabled])).toEqual([
      ['tmdb:trending', true], ['continue', false],
    ])
  })

  it('serializes the effective order and disabled rows', () => {
    expect(catalogHomeLayoutFromRows([
      { id: 'a', title: 'A', enabled: true },
      { id: 'b', title: 'B', enabled: false },
    ])).toEqual({ order: ['a', 'b'], disabled: ['b'] })
  })
})
