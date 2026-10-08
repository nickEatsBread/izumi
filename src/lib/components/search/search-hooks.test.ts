import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const bar = read('./FilterBar.svelte')
const results = read('./SearchResults.svelte')
const page = read('../../../routes/app/search/+page.svelte')
const catalog = read('../catalog/CatalogSearchPage.svelte')
const merged = read('../catalog/MergedCatalogSearchPage.svelte')

// A stylesheet reaches every part of the Search page through hooks, never through its DOM shape
// (`[data-slot="search.results"] > div:has(...)`, `search.filters > div > div > button`).
describe('Search page styling hooks', () => {
  it('names the field the way the search overlay names its own', () => {
    expect(bar).toContain('<input\n    data-part="search.field"')
    expect(catalog).toContain('<input data-part="search.field" bind:value={query}')
    expect(merged).toContain('data-part="search.field"\n      bind:value={query}')
    for (const file of [bar, catalog, merged]) expect(file).not.toContain('data-part="input"')
  })

  it('names every filter control, with its state', () => {
    for (const filter of ['genres', 'format', 'status']) expect(bar).toContain(`filter="${filter}"`)
    for (const filter of ['season', 'year', 'sort']) {
      expect(bar).toContain(`data-part="search.filter" data-filter="${filter}"`)
      expect(bar).toContain(`filter="${filter}" className=`)
    }
    expect(bar).toContain('<button data-part="search.filter" data-filter="advanced" data-active={advCount > 0 || undefined}')
    expect(bar).toContain('<button data-part="search.filter" data-filter="clear"')
    const multi = read('./MultiSelect.svelte')
    expect(multi).toContain("data-part={filter ? 'search.filter' : undefined}")
    expect(multi).toContain('data-active={(filter && selected.length > 0) || undefined}')
    const select = read('../settings/SelectMenu.svelte')
    expect(select).toContain("data-part={filter ? 'search.filter' : undefined}")
    expect(select).toContain('data-active={(filter && value !== options[0]?.value) || undefined}')
    for (const filter of ['type', 'sort', 'source', 'genre']) expect(catalog).toContain(`filter="${filter}"`)
    expect(catalog).toContain('data-filter="advanced"')
  })

  it('names the results grid, on the virtual grid itself, and its loading placeholders', () => {
    expect(read('../VirtualGrid.svelte')).toContain('<div bind:this={root} class={className} data-part={part} data-variant={variant} data-virtual-grid')
    expect(results).toContain('<VirtualGrid\n    part="search.grid"\n    variant="list"')
    expect(results).toContain('<VirtualGrid\n    part="search.grid"\n    variant="grid"')
    expect(results).toContain('<div data-part="search.grid" data-variant="grid" data-state="loading"')
    for (const file of [catalog, merged]) {
      expect(file).toContain('part="search.grid"')
      expect(file).toContain('data-part="search.grid" data-variant="grid" data-state="loading"')
    }
  })

  it('carries a localized page title, hidden until a theme shows it', () => {
    expect(page).toContain("import { m } from '$lib/paraglide/messages.js'")
    expect(page).toContain('<h1 data-part="search.title" class="sr-only">{m.nav_search()}</h1>')
    expect(page).toContain('<h1 data-part="search.title" data-variant="explore" class="mb-4 text-2xl font-black">')
    expect(page).toContain('<h1 data-part="search.title" class="text-2xl font-black">{m.nav_search()}</h1>')
    expect(catalog).toContain('{#if !embedded}<h1 data-part="search.title" class="sr-only">{m.nav_search()}</h1>{/if}')
  })
})

describe('the Search page header (search.header)', () => {
  it('wraps the title and the filter bar in one box on the AniList page', () => {
    const header = page.slice(page.indexOf('<div data-slot="search.header" class="contents">\n      {#if filters.studioId'), page.indexOf('<div class="mt-6">\n      {#key key}\n        <SearchResults'))
    expect(header).toContain('data-part="search.title" data-variant="explore"')
    expect(header).toContain('<h1 data-part="search.title" class="sr-only">{m.nav_search()}</h1>')
    expect(header).toContain('<FilterBar bind:filters />')
  })
  it('wraps the filter bar of an AniList scope on the all-catalogs page', () => {
    expect(page).toContain('<div data-slot="search.header" class="contents"><FilterBar bind:filters /></div>')
  })
  it("wraps the title, the streaming service and the filters on another catalog's page", () => {
    const header = catalog.slice(catalog.indexOf('<div data-slot="search.header" class="contents">'), catalog.indexOf('{#if (isTmdb || isStremio) && (media.length || resultTotal != null)}'))
    expect(header).toContain('data-part="search.title"')
    expect(header).toContain('Streaming service')
    expect(header).toContain('data-part="search.filters"')
  })
  it('wraps the field on the all-catalogs search', () => {
    const header = merged.slice(merged.indexOf('<div data-slot="search.header" class="contents">'), merged.indexOf('{#if failedProviders.length'))
    expect(header).toContain('data-part="search.field"')
  })
  it('renders one header per page', () => {
    for (const file of [catalog, merged]) expect(file.match(/data-slot="search\.header"/g)).toHaveLength(1)
    // The AniList page and an AniList scope of the all-catalogs page are separate branches.
    expect(page.match(/data-slot="search\.header"/g)).toHaveLength(2)
  })
  // A wrapper box would become the scroll range of a title or field a stylesheet already made
  // sticky (they stopped sticking past the filter bar). Until a theme gives the header a box
  // (`display: block`), it generates none.
  it('adds no box of its own until a theme gives it one', () => {
    for (const file of [page, catalog, merged]) {
      const headers = file.match(/<div data-slot="search\.header"[^>]*>/g) ?? []
      expect(headers.length).toBeGreaterThan(0)
      for (const header of headers) expect(header).toBe('<div data-slot="search.header" class="contents">')
    }
  })
})
