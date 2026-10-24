import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { get, type Readable } from 'svelte/store'
import { catalogHomeLayouts, resolveCatalogHomeRows } from './home-layout'
import { createCustomScreen, deleteCustomScreen, renameCustomScreen } from './custom-screens'
import { homeRowOptions } from './registry'
import { homeBlocks } from '$lib/home/blocks'
import { CUSTOM_SCREEN_LIMIT, catalogDefaultProvider, catalogProvider, catalogProviders, catalogScreen, customScreens } from '$lib/settings/catalog'
import { screenThemes } from '$lib/themes/screen-theme'

const stores = [customScreens, catalogHomeLayouts, screenThemes, homeBlocks, catalogDefaultProvider, catalogScreen, catalogProvider, catalogProviders] as const
let saved: unknown[] = []

beforeEach(() => {
  saved = stores.map((store) => get(store as Readable<unknown>))
  customScreens.set([])
  catalogHomeLayouts.set({})
  screenThemes.set({})
  homeBlocks.set({})
  catalogProviders.set(['auto', 'tmdb'])
  catalogProvider.set('tmdb')
  catalogScreen.set('tmdb')
})
afterEach(() => stores.forEach((store, index) => (store as { set(value: unknown): void }).set(saved[index])))

describe('custom screens', () => {
  it('creates a named screen that opens on the banner and Continue Watching, with its theme', () => {
    const screen = createCustomScreen('  Movie night ', 'midnight')
    expect(get(customScreens)).toEqual([{ id: screen.slice('custom:'.length), name: 'Movie night' }])
    expect(get(catalogHomeLayouts)[screen]).toEqual({ order: ['hero', 'continue'], disabled: [] })
    expect(get(screenThemes)[screen]).toBe('midnight')
    expect(get(catalogScreen)).toBe(screen)
    expect(get(catalogProvider)).toBe('tmdb')
  })

  it('refuses an empty name and more than the screen limit', () => {
    expect(() => createCustomScreen('   ')).toThrow('Give this screen a name.')
    for (let index = 0; index < CUSTOM_SCREEN_LIMIT; index++) createCustomScreen(`Screen ${index}`)
    expect(() => createCustomScreen('One more')).toThrow(`up to ${CUSTOM_SCREEN_LIMIT}`)
  })

  it('renames a screen but never to an empty name', () => {
    const screen = createCustomScreen('Movie night')
    renameCustomScreen(screen, 'Film club')
    expect(get(customScreens)[0].name).toBe('Film club')
    expect(() => renameCustomScreen(screen, ' ')).toThrow('Give this screen a name.')
    expect(get(customScreens)[0].name).toBe('Film club')
  })

  it('deletes the screen, its layout, theme and blocks, and leaves it if it was open or the default', () => {
    const screen = createCustomScreen('Movie night', 'sakura')
    homeBlocks.set({ 'block:genre-chips:1': { type: 'genre-chips', area: 'main', phone: false, genres: 'top', all: true } })
    catalogHomeLayouts.update((layouts) => ({ ...layouts, [screen]: { order: ['hero', 'block:genre-chips:1'], disabled: [] } }))
    catalogDefaultProvider.set(screen)
    deleteCustomScreen(screen)
    expect(get(customScreens)).toEqual([])
    expect(get(catalogHomeLayouts)[screen]).toBeUndefined()
    expect(get(screenThemes)[screen]).toBeUndefined()
    expect(get(homeBlocks)).toEqual({})
    expect(get(catalogDefaultProvider)).toBe('adaptive')
    expect(get(catalogScreen)).toBe('auto')
  })
})

describe('custom screen row library', () => {
  it("offers Merged Home's library with every section off but the banner and Continue Watching", async () => {
    const options = await homeRowOptions('custom:night', ['auto'])
    expect(options.some((option) => option.id === 'auto:trending')).toBe(true)
    const rows = resolveCatalogHomeRows('custom:night', options, { 'custom:night': { order: ['hero', 'continue'], disabled: [] } })
    expect(rows.filter((row) => row.enabled).map((row) => row.id)).toEqual(['hero', 'continue'])
    const merged = await homeRowOptions('merged', ['auto'])
    expect(merged.find((option) => option.id === 'auto:list')?.defaultEnabled).not.toBe(false)
  })
})
