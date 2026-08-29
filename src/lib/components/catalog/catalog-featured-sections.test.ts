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

  it('offers ranking, collection, and regional streaming rows to the Home editor', () => {
    expect(TMDB_HOME_ROWS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'top10-movies', defaultEnabled: true }),
      expect.objectContaining({ id: 'collections', defaultEnabled: true }),
      expect.objectContaining({ id: 'streaming-providers', defaultEnabled: true }),
    ]))
  })

  it('renders each row with a purpose-built visual treatment on separate and Merged homes', () => {
    expect(row).toContain("section.presentation === 'ranked'")
    expect(row).toContain("section.presentation === 'collections'")
    expect(row).toContain("section.presentation === 'providers'")
    expect(row).toContain('Number ${index + 1}')
    expect(home).toContain('<CatalogSectionRow')
    expect(merged).toContain('<CatalogSectionRow')
  })

  it('uses live collection and regional provider data and opens provider-filtered browsing', () => {
    expect(provider).toContain("'/watch/providers/movie'")
    expect(provider).toContain('FEATURED_COLLECTION_IDS')
    expect(provider).toContain('Availability by JustWatch')
    expect(provider).toContain('watchProvider=${provider.provider_id}')
    expect(search).toContain('watchProviderName')
    expect(search).toContain('watchProvider,')
  })
})
