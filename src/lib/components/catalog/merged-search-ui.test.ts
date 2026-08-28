import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const mergedSearch = read('./MergedCatalogSearchPage.svelte')
const searchRoute = read('../../../routes/app/search/+page.svelte')
const providerSearch = read('./CatalogSearchPage.svelte')

describe('merged catalog search', () => {
  it('defaults to every catalog and reveals filters after scoping', () => {
    expect(searchRoute).toContain("let mergedScope = $state<MergedScope>")
    expect(searchRoute).toContain('All catalogs')
    expect(searchRoute).toContain("mergedScope === 'all'")
    expect(searchRoute).toContain('<MergedCatalogSearchPage bind:query={mergedQuery} />')
    expect(searchRoute).toContain('<CatalogSearchPage selection={mergedScope} embedded onQueryChange=')
    expect(searchRoute).toContain('<FilterBar bind:filters />')
  })

  it('keeps all-catalog search intentionally title-only', () => {
    expect(mergedSearch).toContain('searchMergedCatalogs($catalogProviders, settled, pageNumber')
    expect(mergedSearch).toContain('A fast title search with no cross-provider filters')
    expect(mergedSearch).not.toContain('SelectMenu')
    expect(providerSearch).toContain("if (embedded) params.set('provider', activeSelection)")
  })
})
