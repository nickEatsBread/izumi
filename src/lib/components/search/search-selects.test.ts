import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('search filter selects', () => {
  it('uses themed desktop menus instead of macOS native select chrome', () => {
    const bar = read('./FilterBar.svelte')
    const advanced = read('./AdvancedFilters.svelte')
    expect(bar).toContain("import SelectMenu from '$lib/components/settings/SelectMenu.svelte'")
    expect(bar).toContain('{:else}')
    expect(bar).toContain('ariaLabel="Season"')
    expect(bar).toContain('ariaLabel="Year"')
    expect(bar).toContain('ariaLabel="Sort"')
    expect(advanced).toContain('ariaLabel="Country"')
  })
})
