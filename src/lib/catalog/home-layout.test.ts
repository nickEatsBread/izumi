import { describe, expect, it } from 'vitest'
import { catalogHomeLayoutFromRows, catalogHomeLayoutKey, resolveCatalogHomeRows } from './home-layout'
import { TMDB_HOME_ROWS } from './home-options'

describe('catalog Home layouts', () => {
  it('keeps a focused TMDB Home with the featured discovery rows enabled', () => {
    expect(resolveCatalogHomeRows('tmdb', TMDB_HOME_ROWS, {}).filter((row) => row.enabled).map((row) => row.id)).toEqual([
      'hero', 'continue', 'trending', 'top10-movies', 'streaming-providers',
      'critics-pick', 'mood-now', 'world-cinema', 'network-spotlight',
      'anime-series', 'anime-movies', 'movies', 'series',
      'rated-movies', 'rated-series', 'upcoming',
    ])
  })

  it('offers broad TMDB presets without enabling every network request', () => {
    const ids = new Set(TMDB_HOME_ROWS.map((row) => row.id))
    expect(TMDB_HOME_ROWS.length).toBeGreaterThanOrEqual(35)
    for (const id of [
      'trending-today', 'trending-movies', 'now-playing', 'airing-today',
      'action-movies', 'horror-movies', 'sci-fi-fantasy-series', 'rated-anime-series',
      'mood-comfort', 'world-korean', 'network-hbo',
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
    expect(rows.slice(0, 3).map((row) => row.id)).toEqual(['hero', 'now-playing', 'trending'])
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

  it('puts the hero first in layouts saved before it was a row', () => {
    const options = [{ id: 'hero', title: 'Featured banner' }, { id: 'continue', title: 'Continue' }, { id: 'season', title: 'Season' }]
    const saved = { anilist: { order: ['season', 'continue'], disabled: [] } }
    expect(resolveCatalogHomeRows('anilist', options, saved).map((row) => row.id)).toEqual(['hero', 'season', 'continue'])
    const moved = { anilist: { order: ['season', 'hero', 'continue'], disabled: ['hero'] } }
    expect(resolveCatalogHomeRows('anilist', options, moved).map((row) => [row.id, row.enabled])).toEqual([['season', true], ['hero', false], ['continue', true]])
    expect(resolveCatalogHomeRows('anilist', options, {}).map((row) => row.id)[0]).toBe('hero')
  })
})

describe('lead rows', () => {
  const options = [
    { id: 'hero', title: 'Hero' },
    { id: 'continue', title: 'Continue' },
    { id: 'trending', title: 'Trending' },
    { id: 'collection:a', title: 'Studio picks', lead: true },
  ]

  it('places a lead row new to a saved layout right after the hero', () => {
    const rows = resolveCatalogHomeRows('tmdb', options, { tmdb: { order: ['continue', 'hero', 'trending'], disabled: [] } })
    expect(rows.map((row) => row.id)).toEqual(['continue', 'hero', 'collection:a', 'trending'])
  })

  it('places a lead row first when the Home has no banner, and keeps a saved position', () => {
    const noHero = options.filter((option) => option.id !== 'hero')
    expect(resolveCatalogHomeRows('tmdb', noHero, { tmdb: { order: ['continue', 'trending'], disabled: [] } }).map((row) => row.id))
      .toEqual(['collection:a', 'continue', 'trending'])
    expect(resolveCatalogHomeRows('tmdb', options, { tmdb: { order: ['hero', 'trending', 'collection:a', 'continue'], disabled: [] } }).map((row) => row.id))
      .toEqual(['hero', 'trending', 'collection:a', 'continue'])
  })

  it('keeps an opt-in lead row off on a custom screen', () => {
    const custom = options.map((option) => option.id === 'collection:a' ? { ...option, defaultEnabled: false } : option)
    const rows = resolveCatalogHomeRows('custom:night', custom, { 'custom:night': { order: ['hero', 'continue'], disabled: [] } })
    expect(rows.find((row) => row.id === 'collection:a')?.enabled).toBe(false)
    expect(catalogHomeLayoutKey('custom:night')).toBe('custom:night')
  })
})
