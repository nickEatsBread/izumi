import { describe, expect, it } from 'vitest'
import { catalogLabel, nextCatalogProvider, normalizeCatalogProviders, previousCatalogProvider } from './catalog'

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
})
