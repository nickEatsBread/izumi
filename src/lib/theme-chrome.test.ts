import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('theme chrome application', () => {
  it('applies density, true black, label hiding and seekbar variables on the document', () => {
    const theme = read('./theme.ts')
    expect(theme).toContain('dataset.themeDensity')
    expect(theme).toContain('dataset.themeNav')
    expect(theme).toContain('theme-true-black')
    expect(theme).toContain('theme-hide-labels')
    expect(theme).toContain('theme-shell-compact')
    expect(theme).toContain('--theme-seekbar-height')
    expect(theme).toContain('--theme-seekbar-color')
  })
  it('keeps recovery editor chrome on named variables rather than loose hex', () => {
    const editor = read('./components/themes/ThemeLayoutEditor.svelte')
    expect(editor.slice(editor.indexOf('<style>'))).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(editor).toContain('themeCoverage')
    expect(editor).toContain('templateOutline')
  })
  it('wires continue and search families through the shared card resolver', () => {
    expect(read('./components/cards/ContinueCard.svelte')).toContain("resolveCard($themePresentation, 'continue')")
    expect(read('./components/search/SearchResults.svelte')).toContain("setContext(CARD_FAMILY, 'search')")
    expect(read('./components/cards/SmallCard.svelte')).toContain('resolveCard($themePresentation, cardFamily')
  })
})
