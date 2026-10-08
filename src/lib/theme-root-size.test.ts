// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { precheckThemeCss } from '$lib/themes/css-policy'
import { parsePresentation } from '$lib/themes/presentation'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('phone root size and the brand pin', () => {
  let stop: () => void = () => {}
  let theme: typeof import('./theme')
  let studio: typeof import('$lib/settings/theme-studio')
  beforeAll(async () => {
    window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    theme = await import('./theme')
    studio = await import('$lib/settings/theme-studio')
    stop = theme.startThemeSync()
  })
  afterAll(() => stop())
  const root = () => document.documentElement.style

  it("sets the phone root from a theme's mobile.rootSize and drops it again", () => {
    expect(root().getPropertyValue('--theme-phone-root')).toBe('')
    const presentation = parsePresentation({ mobile: { rootSize: 16 } }, 4)
    studio.themeStudioPreview.set({ ...studio.defaultStudioTheme(1), fontScale: 1.1, presentation })
    expect(root().getPropertyValue('--theme-phone-root')).toBe('16px')
    // The brand's rem follows the design's font scale through the reserved copy.
    expect(root().getPropertyValue('--izumi-safe-font-scale')).toBe('1.1')
    studio.themeStudioPreview.set({ ...studio.defaultStudioTheme(1), presentation: parsePresentation({ mobile: { density: 'compact' } }, 4) })
    expect(root().getPropertyValue('--theme-phone-root')).toBe('')
    studio.themeStudioPreview.set(null)
    expect(root().getPropertyValue('--theme-phone-root')).toBe('')
    expect(root().getPropertyValue('--izumi-safe-font-scale')).toBe('1')
  })

  it("reads the root size in the phone media query only, and keeps izumi's own 14.5 px without it", () => {
    const css = read('./../app.css')
    expect(css).toContain('@media (max-width: 640px) { :root { font-size: calc(var(--theme-phone-root, 14.5px) * var(--theme-font-scale)); } }')
    expect(css).toContain('html { font-size: calc(16px * var(--theme-font-scale)); }')
    // The brand's rem is what 1rem is with izumi's own roots, on phones and elsewhere.
    expect(css).toContain(':root { --izumi-safe-rem: calc(16px * var(--izumi-safe-font-scale, 1)); }')
    expect(css).toContain('@media (max-width: 640px) { :root { --izumi-safe-rem: calc(14.5px * var(--izumi-safe-font-scale, 1)); } }')
  })

  it('sizes every izumi mark and wordmark from the brand rem', () => {
    expect(read('./components/Wordmark.svelte')).toContain('height: calc(2 * var(--izumi-safe-rem));')
    expect(read('./components/BrandText.svelte')).toContain('font-size: calc(1.125 * var(--izumi-safe-rem));')
    const logo = read('./components/catalog/CatalogBrandLogo.svelte')
    expect(logo).toContain('height: calc(1.75 * var(--izumi-safe-rem));')
    expect(logo).toContain("className = '',")
    const home = read('../routes/app/home/+page.svelte')
    expect(home).toContain('.home-wordmark { height: calc(1.25 * var(--izumi-safe-rem)); }')
    expect(home).not.toContain('home-wordmark h-5')
    expect(read('./../app.css')).toContain('[data-theme-protected].catalog-brand-wordmark { height: calc(1.25 * var(--izumi-safe-rem)); }')
    // The sidebar's "izumi" text takes its size from BrandText, not a rem utility.
    expect(read('./components/shell/Sidebar.svelte')).not.toMatch(/<BrandText className="[^"]*text-lg/)
  })

  it('keeps the brand rem out of reach of theme stylesheets', () => {
    expect(() => precheckThemeCss(':scope{--izumi-safe-rem:20px}')).toThrow('reserved')
    expect(() => precheckThemeCss(':scope{--izumi-safe-font-scale:2}')).toThrow('reserved')
  })
})
