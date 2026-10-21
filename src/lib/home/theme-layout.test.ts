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

  it('fills its rows and tabs with another catalog’s own rows, then keeps the rest of that Home', () => {
    const stremio = ['hero', 'continue', 'o1:movie:top', 'o1:series:top', 'o1:movie:imdbRating', 'o1:series:imdbRating', 'o1:movie:year']
    const home = resolveThemeHome([
      { role: 'hero' },
      { role: 'continue' },
      { role: 'list' },
      { block: 'tabbed-grid', tabs: [{ label: 'NEWEST', role: 'newest' }, { label: 'POPULAR', role: 'popular' }, { label: 'TOP RATED', role: 'rated' }] },
      { role: 'trending' },
      { block: 'ranked-list', tabs: [{ label: 'TOP', role: 'trending' }] },
    ] as never, 'stremio', stremio, stremio.slice(2))
    // Same id first, then an id saying the same thing, then the catalog's next unused row.
    expect(home.blocks['theme:3']).toMatchObject({ tabs: [
      { label: 'NEWEST', role: 'o1:movie:year' }, { label: 'POPULAR', role: 'o1:movie:top' }, { label: 'TOP RATED', role: 'o1:movie:imdbRating' },
    ] })
    expect(home.blocks['theme:5']).toMatchObject({ tabs: [{ label: 'TOP', role: 'o1:series:top' }] })
    // A local row (Your List) is never filled with a catalog row; rows the theme left out follow it.
    expect(home.rows).toEqual(['hero', 'continue', 'theme:3', 'o1:series:top', 'theme:5', 'o1:series:imdbRating'])
    // The row filling the trending slot is styled as the theme's trending row.
    expect(home.roles).toEqual({ hero: 'hero', continue: 'continue', 'o1:series:top': 'trending' })
  })

  it('leaves out tabs another catalog has no row for, and a block left with none', () => {
    const home = resolveThemeHome([
      { block: 'tabbed-grid', tabs: [{ label: 'NEWEST', role: 'newest' }, { label: 'POPULAR', role: 'popular' }] },
      { block: 'ranked-list', tabs: [{ label: 'TOP', role: 'trending' }] },
      { block: 'genre-chips' },
    ] as never, 'jvm', ['continue', 'popular:7'])
    expect(home.rows).toEqual(['theme:0', 'theme:2'])
    expect(home.blocks['theme:0']).toMatchObject({ tabs: [{ label: 'POPULAR', role: 'popular:7' }] })
  })

  it('fills slots only from the rows the Home shows, and keeps the opening tab', () => {
    const home = resolveThemeHome([
      { block: 'tabbed-grid', tabs: [{ label: 'A', role: 'newest' }, { label: 'B', role: 'trending' }, { label: 'C', role: 'popular' }], default: 2 },
    ] as never, 'merged', ['continue', 'tmdb:hidden-row', 'tmdb:trending', 'stremio:o1:movie:top'], ['tmdb:trending', 'stremio:o1:movie:top'])
    // `newest` finds no word match and no free shown row (the hidden TMDB row is never used).
    expect(home.blocks['theme:0']).toMatchObject({ tabs: [{ label: 'B', role: 'tmdb:trending' }, { label: 'C', role: 'stremio:o1:movie:top' }], default: 1 })
  })

  it('keeps AniList’s own rows and order exactly', () => {
    const ids = ['hero', 'continue', 'recent', 'list', 'recommendations', 'season', 'trending', 'popular', 'newest', 'movies', 'rated']
    const home = resolveThemeHome([{ role: 'hero' }, { role: 'rated' }, { block: 'tabbed-grid', tabs: [{ label: 'A', role: 'newest' }, { label: 'B', role: 'rated' }] }] as never, 'anilist', ids)
    expect(home.rows).toEqual(['hero', 'rated', 'theme:2'])
    expect(home.blocks['theme:2']).toMatchObject({ tabs: [{ label: 'A', role: 'newest' }, { label: 'B', role: 'rated' }] })
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
