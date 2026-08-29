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
  const detail = read('./CatalogMediaDetail.svelte')

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
    expect(row).toContain('Number ${position}')
    expect(home).toContain('<CatalogSectionRow')
    expect(merged).toContain('<CatalogSectionRow')
  })

  it('uses live regional provider data and opens a personalized service hub', () => {
    expect(provider).toContain("['movie', 'tv']")
    expect(provider).toContain('/watch/providers/${kind}')
    expect(provider).not.toContain('attribution:')
    expect(detail).not.toContain('media.watchProviders')
    expect(provider).toContain('/app/streaming/${provider.provider_id}')
    expect(streamingHub).toContain('Top 10 Movies on ${name} in ${regionName}')
    expect(streamingHub).toContain('Top 10 TV Shows on ${name} in ${regionName}')
    expect(streamingHub).toContain('watchProvider: id')
    expect(streamingHub).toContain('Kids & Family')
    expect(search).toContain('watchProviderName')
    expect(search).toContain('watchProvider,')
  })

  it('uses complete provider marks, lazy remote hover media, and direct navigation', () => {
    expect(streamingRow).toContain('streamingBrand(feature.title)')
    expect(streamingRow).toContain('populateStreamingServices(section.features ?? [])')
    expect(streamingRow).toContain('brand.mark ?? feature.image')
    expect(streamingRow).toContain('brand.mark || !failedMarks[feature.id]')
    expect(streamingRow).toContain('previewId === feature.id')
    expect(streamingRow).toContain('src={brand.preview}')
    expect(streamingRow).toContain('void goto(feature.href)')
    expect(streamingRow).not.toContain('provider-transition')
    expect(streamingRow).not.toContain('scene-a')
    expect(streamingRow).toContain('.brand-prime-video:hover .provider-mark')
    expect(streamingRow).toContain('origin-top')
    expect(streamingRow).not.toContain('hover:-translate-y-0.5')
    expect(streamingRow).toContain('prefers-reduced-motion: reduce')
  })

})
