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
})
