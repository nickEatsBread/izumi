import { describe, expect, it } from 'vitest'
import { resolveCatalogHomeRows } from '../home-layout'
import { HERO_HOME_ROW, CONTINUE_HOME_ROW } from '../home-options'
import { isContentRow } from '$lib/home/row-source'
import type { HomeCollection } from './model'
import { collectionIdOf, collectionRowId, collectionRowOptions } from './rows'

const folder = { id: 'f', title: 'Folder', focusGifEnabled: false, tileShape: 'poster' as const, hideTitle: false, sources: [] }
const collection = (id: string, pinToTop = false, folders = [folder]): HomeCollection =>
  ({ id, title: `Collection ${id}`, pinToTop, viewMode: 'ROWS', showAllTab: false, folders })

describe('collection rows', () => {
  it('offers every collection with folders, pinned first, as a lead row', () => {
    const options = collectionRowOptions([collection('a'), collection('b', true), collection('empty', false, [])], 'tmdb')
    expect(options.map((option) => option.id)).toEqual(['collection:b', 'collection:a'])
    expect(options[0]).toMatchObject({ title: 'Collection b', description: '1 folder', group: 'Collections', lead: true, defaultEnabled: true })
  })

  it('keeps collections where they always were on a built-in screen, and off on a custom one', () => {
    const options = [HERO_HOME_ROW, CONTINUE_HOME_ROW, { id: 'trending', title: 'Trending' }]
    const builtIn = resolveCatalogHomeRows('tmdb', [...options, ...collectionRowOptions([collection('a')], 'tmdb')], {
      tmdb: { order: ['hero', 'continue', 'trending'], disabled: [] },
    })
    expect(builtIn.filter((row) => row.enabled).map((row) => row.id)).toEqual(['hero', 'collection:a', 'continue', 'trending'])
    const custom = resolveCatalogHomeRows('custom:night', [...options, ...collectionRowOptions([collection('a')], 'custom:night')], {
      'custom:night': { order: ['hero', 'continue'], disabled: [] },
    })
    expect(custom.find((row) => row.id === 'collection:a')?.enabled).toBe(false)
  })

  it('round-trips ids and is never a theme slot candidate', () => {
    expect(collectionIdOf(collectionRowId('abc'))).toBe('abc')
    expect(collectionIdOf('trending')).toBeNull()
    expect(isContentRow('collection:abc')).toBe(false)
    expect(isContentRow('tmdb:trending')).toBe(true)
  })
})
