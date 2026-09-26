import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('theme top bar', () => {
  it('shows text links and a centred text brand when the theme asks', () => {
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain("const topBar = $derived($themePresentation?.shell?.top ?? {})")
    expect(bar).toContain("topBar.labels ?? 'icons'")
    expect(bar).toContain("topBar.brand === 'center'")
    expect(bar).toContain("$themePresentation?.brand === 'text'")
  })

  it('puts a search field in the bar instead of the Search link', () => {
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain('<TopSearchField')
    expect(bar).toContain("topBar.search === 'field-center'")
    expect(bar).toContain("topBar.search === 'field-end'")
    const field = read('./TopSearchField.svelte')
    expect(field).toContain('data-part="search.field"')
    expect(field).toContain('/app/search?search=')
  })
})
