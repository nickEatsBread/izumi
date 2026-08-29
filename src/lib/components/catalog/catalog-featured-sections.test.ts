import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TMDB_HOME_ROWS } from '$lib/catalog/home-options'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('featured TMDB home sections', () => {
  const row = read('./CatalogSectionRow.svelte')
  const home = read('./CatalogHome.svelte')
  const merged = read('./MergedCatalogHome.svelte')
  const provider = read('../../catalog/providers/tmdb.ts')
  const search = read('./CatalogSearchPage.svelte')
  const streamingRow = read('./StreamingProviderRow.svelte')
  const streamingHub = read('./StreamingProviderHub.svelte')

  it('offers ranking and regional streaming rows to the Home editor without Collections', () => {
    expect(TMDB_HOME_ROWS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'top10-movies', defaultEnabled: true }),
      expect.objectContaining({ id: 'streaming-providers', defaultEnabled: true }),
    ]))
    expect(TMDB_HOME_ROWS.some((entry) => entry.id === 'collections')).toBe(false)
    expect(provider).not.toContain('FEATURED_COLLECTION_IDS')
  })

  it('renders each row with a purpose-built visual treatment on separate and Merged homes', () => {
    expect(row).toContain("section.presentation === 'ranked'")
    expect(row).toContain("section.presentation === 'providers'")
    expect(row).toContain('<StreamingProviderRow')
    expect(row).toContain('Number ${index + 1}')
    expect(home).toContain('<CatalogSectionRow')
    expect(merged).toContain('<CatalogSectionRow')
  })

  it('uses live regional provider data and opens a personalized service hub', () => {
    expect(provider).toContain("['movie', 'tv']")
    expect(provider).toContain('/watch/providers/${kind}')
    expect(provider).toContain('Availability by JustWatch')
    expect(provider).toContain('/app/streaming/${provider.provider_id}')
    expect(streamingHub).toContain('Top 10 Movies on ${name} in ${regionName}')
    expect(streamingHub).toContain('Top 10 TV Shows on ${name} in ${regionName}')
    expect(streamingHub).toContain('watchProvider: id')
    expect(streamingHub).toContain('Kids & Family')
    expect(search).toContain('watchProviderName')
    expect(search).toContain('watchProvider,')
  })

  it('reveals service colour on hover and uses a branded selection transition', () => {
    expect(streamingRow).toContain('group-hover:grayscale-0')
    expect(streamingRow).toContain('streamingBrand(feature.title)')
    expect(streamingRow).toContain('provider-transition motion-{active.brand.motion}')
    expect(streamingRow).toContain('prefers-reduced-motion: reduce')
  })
})
