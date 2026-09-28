import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { catalogHomeLayouts, resolveCatalogHomeRows, type CatalogHomeLayouts } from '$lib/catalog/home-layout'
import { homeBlocks, type HomeBlock } from './blocks'
import { addHomeBlock, blockRowOptions, pruneHomeBlocks, removeHomeBlock, splitHomeColumns, updateHomeBlock } from './block-rows'

const chips: HomeBlock = { type: 'genre-chips', area: 'main', phone: false, genres: 'top', all: true }
const ranked: HomeBlock = { type: 'ranked-list', area: 'aside', phone: false, tabs: [{ label: 'Top', role: 'trending' }], limit: 10 }
const rankedOnPhones: HomeBlock = { ...ranked, phone: true }

describe('blocks in the Home layout', () => {
  let previousLayouts: CatalogHomeLayouts
  let previousBlocks: Record<string, HomeBlock>

  beforeEach(() => {
    previousLayouts = get(catalogHomeLayouts)
    previousBlocks = get(homeBlocks)
    catalogHomeLayouts.set({ anilist: { order: ['continue', 'block:genre-chips:1', 'season', 'block:ghost:1'], disabled: [] } })
    homeBlocks.set({ 'block:genre-chips:1': chips, 'block:ranked-list:2': ranked })
  })

  afterEach(() => {
    catalogHomeLayouts.set(previousLayouts)
    homeBlocks.set(previousBlocks)
  })

  it('offers only the blocks a layout already contains, so resolving keeps them in place', () => {
    const blocks = blockRowOptions('anilist', get(catalogHomeLayouts), get(homeBlocks))
    expect(blocks.map((row) => row.id)).toEqual(['block:genre-chips:1'])
    const rows = resolveCatalogHomeRows('anilist', [{ id: 'continue', title: 'Continue' }, { id: 'season', title: 'Season' }, ...blocks], get(catalogHomeLayouts))
    expect(rows.map((row) => row.id)).toEqual(['continue', 'block:genre-chips:1', 'season'])
    expect(blockRowOptions('tmdb', get(catalogHomeLayouts), get(homeBlocks))).toEqual([])
  })

  it('adds a block with default settings at the requested gap', () => {
    const rows = [{ id: 'continue', title: 'Continue', enabled: true }, { id: 'season', title: 'Season', enabled: true }]
    const id = addHomeBlock('anilist', rows, 'latest-episodes', 'season', [])
    expect(id).toBe('block:latest-episodes:1')
    expect(get(homeBlocks)[id!]).toMatchObject({ type: 'latest-episodes', pageSize: 12 })
    expect(get(catalogHomeLayouts).anilist?.order).toEqual(['continue', 'block:latest-episodes:1', 'season'])
  })

  it('does nothing and returns null when rows holds no non-block row (the row library has not loaded)', () => {
    const beforeLayouts = get(catalogHomeLayouts)
    const beforeBlocks = get(homeBlocks)
    const onlyBlockRows = [{ id: 'block:genre-chips:1', title: 'Genre chips', enabled: true }]
    expect(addHomeBlock('anilist', onlyBlockRows, 'latest-episodes', null, [])).toBeNull()
    expect(addHomeBlock('anilist', [], 'latest-episodes', null, [])).toBeNull()
    expect(get(catalogHomeLayouts)).toEqual(beforeLayouts)
    expect(get(homeBlocks)).toEqual(beforeBlocks)
  })

  it('numbers a new block past every id any saved layout references, even without settings for them', () => {
    catalogHomeLayouts.set({
      anilist: { order: ['continue', 'block:latest-episodes:3'], disabled: [] },
      tmdb: { order: [], disabled: ['block:latest-episodes:5'] },
    })
    // Settings were never synced for those references — a device that only received the layout.
    homeBlocks.set({})
    const rows = [{ id: 'continue', title: 'Continue', enabled: true }]
    const id = addHomeBlock('anilist', rows, 'latest-episodes', null, [])
    expect(id).toBe('block:latest-episodes:6')
  })

  it('removes a block from the layout and forgets its settings', () => {
    removeHomeBlock('anilist', 'block:genre-chips:1')
    expect(get(catalogHomeLayouts).anilist?.order).toEqual(['continue', 'season', 'block:ghost:1'])
    expect(get(homeBlocks)['block:genre-chips:1']).toBeUndefined()
  })

  it('repairs settings on update and ignores unknown blocks', () => {
    updateHomeBlock('block:genre-chips:1', { all: false, genres: ['Drama'] })
    expect(get(homeBlocks)['block:genre-chips:1']).toMatchObject({ all: false, genres: ['Drama'] })
    updateHomeBlock('block:genre-chips:1', { type: 'ranked-list' } as Partial<HomeBlock>)
    expect(get(homeBlocks)['block:genre-chips:1']?.type).toBe('genre-chips')
    updateHomeBlock('block:missing:1', { title: 'x' })
    expect(get(homeBlocks)['block:missing:1']).toBeUndefined()
  })

  it('prunes settings that no layout references', () => {
    pruneHomeBlocks()
    expect(Object.keys(get(homeBlocks))).toEqual(['block:genre-chips:1'])
  })

  it('splits rows into columns, dropping aside blocks on phones unless they opt in', () => {
    const ids = ['continue', 'block:ranked-list:2', 'season']
    expect(splitHomeColumns(ids, { 'block:ranked-list:2': ranked }, false)).toEqual({ main: ['continue', 'season'], aside: ['block:ranked-list:2'] })
    expect(splitHomeColumns(ids, { 'block:ranked-list:2': ranked }, true)).toEqual({ main: ['continue', 'season'], aside: [] })
    expect(splitHomeColumns(ids, { 'block:ranked-list:2': rankedOnPhones }, true)).toEqual({ main: ['continue', 'season'], aside: ['block:ranked-list:2'] })
  })
})
