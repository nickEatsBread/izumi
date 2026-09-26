import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('$lib/anilist/client', () => ({ anilist: {} }))
import { catalogHomeLayouts } from '$lib/catalog/home-layout'
import { homeAsideWidth, homeBlocks } from './blocks'
import { themeLayoutEnabled } from '$lib/themes/layout-state'
import { forkThemeHome, isThemeBlockId, resolveThemeHome } from './theme-layout'

const entries = [
  { block: 'genre-chips', area: 'main', phone: false, genres: 'top', all: true },
  { role: 'hero' },
  { role: 'trending' },
  { role: 'rated' },
  { block: 'ranked-list', area: 'aside', phone: false, tabs: [{ label: 'Top', role: 'trending' }], limit: 10 },
] as never

describe('theme Home layouts', () => {
  beforeEach(() => {
    catalogHomeLayouts.set({ anilist: { order: ['continue', 'season'], disabled: [] } })
    homeBlocks.set({ 'block:genre-chips:1': { type: 'genre-chips', area: 'main', phone: false, genres: 'top', all: true } })
    themeLayoutEnabled.set({})
  })
  afterEach(() => homeAsideWidth.set(320))

  it('resolves roles against the catalog and turns blocks into theme blocks', () => {
    const home = resolveThemeHome(entries, 'anilist', ['hero', 'continue', 'trending', 'season'])
    expect(home.rows).toEqual(['theme:0', 'hero', 'trending', 'theme:4'])
    expect(home.blocks['theme:4']).toMatchObject({ type: 'ranked-list', area: 'aside' })
    expect(isThemeBlockId('theme:4')).toBe(true)
    expect(isThemeBlockId('block:genre-chips:1')).toBe(false)
    expect(resolveThemeHome([{ role: 'trending' }] as never, 'merged', ['hero', 'kitsu:trending']).rows).toEqual(['kitsu:trending'])
  })

  it('forks the resolved Home into the user layout and turns the theme layout off', () => {
    const home = resolveThemeHome(entries, 'anilist', ['hero', 'continue', 'trending', 'season'])
    forkThemeHome('anilist', home, ['hero', 'continue', 'trending', 'season'], 'design-a', 360)
    const layout = get(catalogHomeLayouts).anilist!
    expect(layout.order).toEqual(['block:genre-chips:2', 'hero', 'trending', 'block:ranked-list:1', 'continue', 'season'])
    expect(layout.disabled).toEqual(['continue', 'season'])
    expect(get(homeBlocks)['block:ranked-list:1']).toMatchObject({ type: 'ranked-list', area: 'aside' })
    expect(get(homeBlocks)['block:genre-chips:1']).toBeDefined()
    expect(get(homeAsideWidth)).toBe(360)
    expect(get(themeLayoutEnabled)['design-a']).toBe(false)
  })
})
