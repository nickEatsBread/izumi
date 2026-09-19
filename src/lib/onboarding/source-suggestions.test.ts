import { describe, expect, it } from 'vitest'
import { addonSuggestions, packageSuggestions, type SourceSuggestion } from './source-suggestions'
import type { CommunityAddon } from '$lib/stremio/community-store'
import type { ExtensionCatalogPackage } from '$lib/extensions/catalog'

const addon = (slug: string, stars: number, name: string, description?: string): CommunityAddon => ({
  uuid: `uuid-${slug}`,
  slug,
  manifestUrl: `https://example.invalid/${slug}/manifest.json`,
  configureUrl: null,
  stars,
  categories: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  manifest: { id: slug, name, version: '1.0.0', description, resources: [], types: [], catalogs: [] } as CommunityAddon['manifest'],
})

const pkg = (id: string, name: string, sources: string[]): ExtensionCatalogPackage => ({
  id,
  name,
  version: '1.0.0',
  nsfw: false,
  backend: 'izumi-js',
  sources: sources.map((source) => ({ id: source, name: source })),
  package: `https://example.invalid/${id}.izumi-ext`,
  packageSha256: 'a'.repeat(64),
  packageBytes: 1024,
})

describe('addon suggestions', () => {
  it('keeps the directory order and caps the list', () => {
    const result = addonSuggestions([addon('a', 30, 'Alpha'), addon('b', 20, 'Beta'), addon('c', 10, 'Gamma')], 2)
    expect(result.map((entry: SourceSuggestion) => entry.name)).toEqual(['Alpha', 'Beta'])
    expect(result[0]).toMatchObject({
      kind: 'addon',
      id: 'https://example.invalid/a/manifest.json',
      url: 'https://example.invalid/a/manifest.json',
    })
  })

  it('falls back to a star count when an addon has no description', () => {
    expect(addonSuggestions([addon('a', 42, 'Alpha')], 6)[0].description).toBe('42 stars')
    expect(addonSuggestions([addon('b', 42, 'Beta', 'Does a thing')], 6)[0].description).toBe('Does a thing')
  })

  it('drops entries the directory returned without a usable manifest URL', () => {
    const broken = { ...addon('a', 1, 'Alpha'), manifestUrl: '' }
    expect(addonSuggestions([broken, addon('b', 1, 'Beta')], 6).map((entry) => entry.name)).toEqual(['Beta'])
  })

  it('says one star rather than 1 stars', () => {
    expect(addonSuggestions([addon('a', 1, 'Alpha')], 6)[0].description).toBe('1 star')
  })
})

describe('package suggestions', () => {
  it('describes a package by the sources it carries', () => {
    const result = packageSuggestions([pkg('one', 'One', ['x', 'y'])], 6)
    expect(result[0]).toMatchObject({ kind: 'extension', id: 'one', name: 'One', description: '2 sources' })
  })

  it('says one source rather than 1 sources', () => {
    expect(packageSuggestions([pkg('one', 'One', ['x'])], 6)[0].description).toBe('1 source')
  })

  it('never suggests an adult package', () => {
    const adult = { ...pkg('two', 'Two', ['x']), nsfw: true }
    expect(packageSuggestions([adult, pkg('three', 'Three', ['y'])], 6).map((entry) => entry.name)).toEqual(['Three'])
  })

  it('survives a catalog package that declares no sources', () => {
    const malformed = { ...pkg('four', 'Four', []), sources: undefined } as unknown as ExtensionCatalogPackage
    expect(packageSuggestions([malformed], 6)[0].description).toBe('0 sources')
  })
})
