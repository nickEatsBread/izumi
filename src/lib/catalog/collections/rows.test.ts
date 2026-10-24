import { describe, expect, it } from 'vitest'
import { resolveCatalogHomeRows } from '../home-layout'
import { HERO_HOME_ROW, CONTINUE_HOME_ROW, TMDB_HOME_ROWS } from '../home-options'
import { isContentRow } from '$lib/home/row-source'
import type { HomeCollection } from './model'
import { collectionIdOf, collectionRowId, collectionRowOptions, placeExistingCollections } from './rows'

const folder = { id: 'f', title: 'Folder', focusGifEnabled: false, tileShape: 'poster' as const, hideTitle: false, sources: [] }
const collection = (id: string, pinToTop = false, folders = [folder]): HomeCollection =>
  ({ id, title: `Collection ${id}`, pinToTop, viewMode: 'ROWS', showAllTab: false, folders })
const enabled = (rows: Array<{ id: string; enabled: boolean }>) => rows.filter((row) => row.enabled).map((row) => row.id)

describe('collection rows', () => {
  it('offers every collection with folders, pinned first, starting off', () => {
    const options = collectionRowOptions([collection('a'), collection('b', true), collection('empty', false, [])])
    expect(options.map((option) => option.id)).toEqual(['collection:b', 'collection:a'])
    expect(options[0]).toEqual({ id: 'collection:b', title: 'Collection b', description: '1 folder', group: 'Collections', defaultEnabled: false })
  })

  it('leaves a newly added collection off on built-in and custom screens alike', () => {
    const options = [HERO_HOME_ROW, CONTINUE_HOME_ROW, { id: 'trending', title: 'Trending' }, ...collectionRowOptions([collection('new')])]
    expect(enabled(resolveCatalogHomeRows('tmdb', options, { tmdb: { order: ['hero', 'continue', 'trending'], disabled: [] } }))).toEqual(['hero', 'continue', 'trending'])
    expect(enabled(resolveCatalogHomeRows('stremio', options, {}))).toEqual(['hero', 'continue', 'trending'])
    expect(enabled(resolveCatalogHomeRows('custom:night', options, { 'custom:night': { order: ['hero', 'continue'], disabled: [] } }))).not.toContain('collection:new')
  })

  it('round-trips ids and is never a theme slot candidate', () => {
    expect(collectionIdOf(collectionRowId('abc'))).toBe('abc')
    expect(collectionIdOf('trending')).toBeNull()
    expect(isContentRow('collection:abc')).toBe(false)
    expect(isContentRow('tmdb:trending')).toBe(true)
  })
})

describe('placing the collections someone already has', () => {
  const existing = [collection('a'), collection('b', true)]

  it('puts them right after the banner on every built-in screen, pinned first', () => {
    const layouts = placeExistingCollections(existing, { tmdb: { order: ['continue', 'hero', 'trending'], disabled: ['upcoming'] } })
    expect(layouts.tmdb).toEqual({ order: ['continue', 'hero', 'collection:b', 'collection:a', 'trending'], disabled: ['upcoming'] })
    for (const key of ['anilist', 'kitsu', 'stremio', 'jvm', 'merged'] as const) {
      expect(layouts[key]).toEqual({ order: ['hero', 'collection:b', 'collection:a'], disabled: [] })
    }
    expect(Object.keys(layouts).some((key) => key.startsWith('custom:'))).toBe(false)
  })

  it('keeps a collection where it already is, or hidden where it was hidden', () => {
    const layouts = placeExistingCollections(existing, { anilist: { order: ['hero', 'trending', 'collection:a'], disabled: ['collection:b'] } })
    expect(layouts.anilist).toEqual({ order: ['hero', 'trending', 'collection:a'], disabled: ['collection:b'] })
  })

  it('changes nothing else about a Home that never had a saved layout', () => {
    const options = [...TMDB_HOME_ROWS, ...collectionRowOptions(existing)]
    const before = enabled(resolveCatalogHomeRows('tmdb', TMDB_HOME_ROWS, {}))
    const after = enabled(resolveCatalogHomeRows('tmdb', options, placeExistingCollections(existing, {})))
    expect(after).toEqual(['hero', 'collection:b', 'collection:a', ...before.slice(1)])
  })

  it('writes nothing when there are no collections', () => {
    const layouts = { tmdb: { order: ['hero'], disabled: [] } }
    expect(placeExistingCollections([], layouts)).toBe(layouts)
  })
})
