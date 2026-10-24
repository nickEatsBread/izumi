import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import {
  catalogLabel, catalogLastProvider, catalogLastScreen, catalogProvider, catalogScreen, catalogScreens, nextCatalogProvider, nextCatalogScreen,
  isJvmCatalogSourceEnabled, mergedCatalogProviders, normalizeCatalogProviders, previousCatalogProvider,
  resolveCatalogScreenStartup, resolveCatalogStartup, resolveCatalogSwitcherPlacement, selectCatalogProvider, selectCatalogScreen,
  stremioHeroArtwork, companionScreen, customScreenId, isCustomScreen, isMergedScreen, normalizeCustomScreens,
  previousCatalogScreen, CUSTOM_SCREEN_LIMIT,
} from './catalog'

describe('catalog platform selection', () => {
  it('keeps multiple valid platforms in their chosen order', () => {
    expect(normalizeCatalogProviders(['auto', 'tmdb'])).toEqual(['auto', 'tmdb'])
  })

  it('deduplicates and rejects malformed persisted values', () => {
    expect(normalizeCatalogProviders(['tmdb', 'tmdb', 'invalid', null])).toEqual(['tmdb'])
    expect(normalizeCatalogProviders([], 'kitsu')).toEqual(['kitsu'])
    expect(normalizeCatalogProviders('tmdb')).toEqual(['auto'])
  })

  it('provides compact labels for the platform switcher', () => {
    expect(catalogLabel('auto')).toBe('Automatic anime')
    expect(catalogLabel('tmdb')).toBe('TMDB')
    expect(catalogLabel('jvm')).toBe('Aniyomi sources')
    expect(catalogLabel('adaptive')).toBe('Adaptive')
  })

  it('cycles through enabled platforms in their configured order', () => {
    expect(nextCatalogProvider('auto', ['auto', 'tmdb', 'kitsu'])).toBe('tmdb')
    expect(nextCatalogProvider('tmdb', ['auto', 'tmdb', 'kitsu'])).toBe('kitsu')
    expect(nextCatalogProvider('kitsu', ['auto', 'tmdb', 'kitsu'])).toBe('auto')
  })

  it('cycles backwards through enabled platforms with wraparound', () => {
    expect(previousCatalogProvider('auto', ['auto', 'tmdb', 'kitsu'])).toBe('kitsu')
    expect(previousCatalogProvider('kitsu', ['auto', 'tmdb', 'kitsu'])).toBe('tmdb')
    expect(previousCatalogProvider('tmdb', ['auto', 'tmdb', 'kitsu'])).toBe('auto')
  })

  it('recovers to the first enabled platform when the active value is unavailable', () => {
    expect(nextCatalogProvider('stremio', ['auto', 'tmdb'])).toBe('auto')
  })

  it('uses cinematic Stremio banner artwork until the user chooses full cover art', () => {
    expect(get(stremioHeroArtwork)).toBe('backdrop')
  })

  it('collapses duplicate AniList access only when composing merged catalogs', () => {
    expect(mergedCatalogProviders(['tmdb', 'auto', 'anilist', 'jvm'])).toEqual(['tmdb', 'auto', 'jvm'])
    expect(mergedCatalogProviders(['anilist', 'tmdb'])).toEqual(['anilist', 'tmdb'])
  })

  it('adds Merged as a peer screen only when it combines distinct catalogs', () => {
    expect(catalogScreens(['auto'])).toEqual(['auto'])
    expect(catalogScreens(['auto', 'anilist'])).toEqual(['auto', 'anilist'])
    expect(catalogScreens(['auto', 'tmdb'])).toEqual(['auto', 'tmdb', 'merged'])
    expect(nextCatalogScreen('tmdb', ['auto', 'tmdb'])).toBe('merged')
    expect(nextCatalogScreen('merged', ['auto', 'tmdb'])).toBe('auto')
  })

  it('shows newly installed JVM sources by default and preserves explicit filters', () => {
    expect(isJvmCatalogSourceEnabled('aniyomi:one', {})).toBe(true)
    expect(isJvmCatalogSourceEnabled('aniyomi:one', { 'aniyomi:one': false })).toBe(false)
    expect(isJvmCatalogSourceEnabled('aniyomi:one', { 'aniyomi:one': true })).toBe(true)
    expect(isJvmCatalogSourceEnabled('aniyomi:one', 'malformed')).toBe(true)
  })

  it('resolves Adaptive to the last selected enabled platform', () => {
    expect(resolveCatalogStartup('adaptive', 'tmdb', ['auto', 'tmdb'])).toBe('tmdb')
    expect(resolveCatalogStartup('adaptive', 'kitsu', ['auto', 'tmdb'])).toBe('auto')
  })

  it('keeps a fixed default independent of the last selected platform', () => {
    expect(resolveCatalogStartup('anilist', 'tmdb', ['anilist', 'tmdb'])).toBe('anilist')
  })

  it('restores Merged through the same fixed or Adaptive startup policy', () => {
    expect(resolveCatalogScreenStartup('merged', 'auto', ['auto', 'tmdb'])).toBe('merged')
    expect(resolveCatalogScreenStartup('adaptive', 'merged', ['auto', 'tmdb'])).toBe('merged')
    expect(resolveCatalogScreenStartup('merged', 'merged', ['auto'])).toBe('auto')
  })

  it('places the automatic catalog switcher in the Izumi logo on desktop and Android', () => {
    expect(resolveCatalogSwitcherPlacement('automatic', false)).toBe('integrated')
    expect(resolveCatalogSwitcherPlacement('automatic', true)).toBe('integrated')
    expect(resolveCatalogSwitcherPlacement('below', false)).toBe('below')
    expect(resolveCatalogSwitcherPlacement('integrated', true)).toBe('integrated')
  })

  it('records explicit switches as Adaptive startup state', () => {
    const previousCurrent = get(catalogProvider)
    const previousLast = get(catalogLastProvider)
    try {
      selectCatalogProvider('tmdb')
      expect(get(catalogProvider)).toBe('tmdb')
      expect(get(catalogLastProvider)).toBe('tmdb')
    } finally {
      catalogProvider.set(previousCurrent)
      catalogLastProvider.set(previousLast)
    }
  })

  it('selects Merged without replacing the concrete provider used by playback', () => {
    const previousProvider = get(catalogProvider)
    const previousScreen = get(catalogScreen)
    const previousLastScreen = get(catalogLastScreen)
    try {
      catalogProvider.set('tmdb')
      selectCatalogScreen('merged')
      expect(get(catalogScreen)).toBe('merged')
      expect(get(catalogProvider)).toBe('tmdb')
      expect(get(catalogLastScreen)).toBe('merged')
    } finally {
      catalogProvider.set(previousProvider)
      catalogScreen.set(previousScreen)
      catalogLastScreen.set(previousLastScreen)
    }
  })
})

describe('custom screens', () => {
  const movie = { id: 'movienight', name: 'Movie night' }

  it('repairs stored screens: valid ids, trimmed names, no duplicates, bounded count', () => {
    expect(normalizeCustomScreens([{ id: 'abc', name: '  Movie   night ' }, { id: 'abc', name: 'Again' }, { id: 'BAD id', name: 'x' }, { id: 'n', name: '' }, null]))
      .toEqual([{ id: 'abc', name: 'Movie night' }])
    expect(normalizeCustomScreens('nope')).toEqual([])
    const many = Array.from({ length: 20 }, (_, index) => ({ id: `s${index}`, name: `Screen ${index}` }))
    expect(normalizeCustomScreens(many)).toHaveLength(CUSTOM_SCREEN_LIMIT)
    expect(normalizeCustomScreens([{ id: 'long', name: 'x'.repeat(80) }])[0].name).toHaveLength(32)
  })

  it('names custom screens and treats them like Merged', () => {
    expect(customScreenId('movienight')).toBe('custom:movienight')
    expect(isCustomScreen('custom:movienight')).toBe(true)
    expect(isCustomScreen('merged')).toBe(false)
    expect(isMergedScreen('custom:movienight')).toBe(true)
    expect(isMergedScreen('merged')).toBe(true)
    expect(isMergedScreen('tmdb')).toBe(false)
    expect(catalogLabel('custom:movienight', [movie])).toBe('Movie night')
    expect(catalogLabel('custom:gone', [movie])).toBe('Custom screen')
  })

  it('lists custom screens after the built-in ones, even with one platform', () => {
    expect(catalogScreens(['auto'], [movie])).toEqual(['auto', 'custom:movienight'])
    expect(catalogScreens(['auto', 'tmdb'], [movie])).toEqual(['auto', 'tmdb', 'merged', 'custom:movienight'])
    expect(nextCatalogScreen('merged', ['auto', 'tmdb'], [movie])).toBe('custom:movienight')
    expect(nextCatalogScreen('custom:movienight', ['auto', 'tmdb'], [movie])).toBe('auto')
    expect(previousCatalogScreen('auto', ['auto', 'tmdb'], [movie])).toBe('custom:movienight')
  })

  it('restores a custom screen at startup only while it still exists', () => {
    expect(resolveCatalogScreenStartup('custom:movienight', 'auto', ['auto'], [movie])).toBe('custom:movienight')
    expect(resolveCatalogScreenStartup('adaptive', 'custom:movienight', ['auto'], [movie])).toBe('custom:movienight')
    expect(resolveCatalogScreenStartup('adaptive', 'custom:movienight', ['auto'], [])).toBe('auto')
  })

  it('selects a custom screen without replacing the concrete provider, and hides it from the companion', () => {
    const previousProvider = get(catalogProvider)
    const previousScreen = get(catalogScreen)
    const previousLastScreen = get(catalogLastScreen)
    try {
      catalogProvider.set('tmdb')
      selectCatalogScreen('custom:movienight')
      expect(get(catalogScreen)).toBe('custom:movienight')
      expect(get(catalogProvider)).toBe('tmdb')
      expect(get(catalogLastScreen)).toBe('custom:movienight')
      expect(companionScreen('custom:movienight')).toBe('tmdb')
      expect(companionScreen('merged')).toBe('merged')
    } finally {
      catalogProvider.set(previousProvider)
      catalogScreen.set(previousScreen)
      catalogLastScreen.set(previousLastScreen)
    }
  })
})
