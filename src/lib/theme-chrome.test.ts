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
    expect(theme).toContain('theme-shell-fade')
    expect(theme).toContain('theme-press-sink')
    expect(theme).toContain('--theme-seekbar-height')
    expect(theme).toContain('--theme-seekbar-color')
  })
  it('keeps recovery editor chrome on named variables rather than loose hex', () => {
    const editor = read('./components/themes/ThemeLayoutEditor.svelte')
    expect(editor.slice(editor.indexOf('<style>'))).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(editor).toContain('themeCoverage')
    expect(editor).toContain('templateOutline')
  })
  it('paints custom home heroes as full-bleed banners, not boxed cards', () => {
    const hero = read('./components/banner/Hero.svelte')
    expect(hero).toContain('theme-custom-hero')
    expect(hero).not.toContain('background: hsl(var(--card))')
    expect(hero).toContain('($isMobile ? heroTheme.mobileHeight : heroTheme.height) ?? 46')
    expect(hero).toContain('theme-banner-scale')
  })
  it('wires continue and search families through the shared card resolver', () => {
    expect(read('./components/cards/ContinueCard.svelte')).toContain("resolveCard($themePresentation, 'continue')")
    expect(read('./components/search/SearchResults.svelte')).toContain("setContext(CARD_FAMILY, 'search')")
    expect(read('./components/cards/SmallCard.svelte')).toContain('resolveCard($themePresentation, cardFamily')
    expect(read('./components/cards/SmallCard.svelte')).toContain("nav === 'top' || nav === 'bottom' ? 0 : SIDEBAR_W")
    expect(read('./components/themes/ThemeNode.svelte')).toContain('theme-artwork')
    expect(read('./components/banner/Hero.svelte')).toContain('.theme-overlay > .theme-artwork')
  })
  it('renders template part names as data-part on every node kind', () => {
    const node = read('./components/themes/ThemeNode.svelte')
    expect(node.match(/data-part=\{item\.part\}/g)?.length).toBe(6)
  })
  it('gives hero templates the slide counter and a ticking countdown', () => {
    const hero = read('./components/banner/Hero.svelte')
    expect(hero).toContain('slide: i + 1, slides: medias.length')
    expect(hero).toMatch(/\}, 0, clock\) : \{\}\)/)
  })
})
