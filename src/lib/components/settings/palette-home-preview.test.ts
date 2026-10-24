import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { hasAttr, markupElementsFromSource, staticAttr } from '../../../test/svelte-markup'

// Vitest has no Svelte plugin, so these read the component source (parsed by the Svelte compiler).
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('SelectMenu preview card', () => {
  const source = read('./SelectMenu.svelte')
  const card = markupElementsFromSource(source, 'SelectMenu.svelte').find((el) => hasAttr(el, 'data-select-preview'))!

  it('follows the hovered and the focused option, only for a menu that has a preview', () => {
    expect(source).toContain('onpointerenter={preview ? () => (previewValue = option.value) : undefined}')
    expect(source).toContain('onfocus={preview ? () => (previewValue = option.value) : undefined}')
    expect(source).toContain("if (next) { query = ''; previewValue = undefined; measure() }")
  })

  it('is a decorative, portalled card that only exists while the menu is open', () => {
    expect(card.ancestors).toEqual([expect.objectContaining({ name: 'div' })])
    expect(source.indexOf('data-select-preview')).toBeGreaterThan(source.indexOf('{#if open}'))
    expect(source.indexOf('data-select-preview')).toBeLessThan(source.lastIndexOf('{/if}\n</div>'))
    for (const name of ['use:portal', 'inert']) expect(hasAttr(card, name)).toBe(true)
    expect(staticAttr(card, 'aria-hidden')).toBe('true')
    expect(source).toContain('class="pointer-events-none fixed overflow-hidden border border-border bg-background')
  })

  it('sits left of the menu where it fits, never on phones, above the controller backdrop', () => {
    expect(source).toContain('if (!rect || $isMobile || width < 160) { previewBox = undefined; return }')
    expect(source).toContain('previewBox = { left: rect.left / zoom - PREVIEW_GAP - width')
    expect(source).toContain("$settingsControllerMode ? 'z-[166] rounded-2xl shadow-2xl' : 'z-[80] rounded-md shadow-xl'")
  })
})

describe('Theme row Home preview', () => {
  it('passes a Home preview for every palette but the read-only Custom entry', () => {
    const page = read('../../../routes/app/settings/appearance/+page.svelte')
    expect(page).toContain("{#snippet palettePreview(value: string)}{#if value !== 'custom'}<PaletteHomePreview preset={value as Exclude<ThemePreset, 'custom'>} />{/if}{/snippet}")
    expect(page).toContain('onChange={(value) => ($themePreset = value as ThemePreset)} preview={palettePreview} />')
  })

  const preview = read('./PaletteHomePreview.svelte')
  const elements = markupElementsFromSource(preview, 'PaletteHomePreview.svelte')

  it('scopes the palette to a protected root, System resolving like the app does', () => {
    expect(staticAttr(elements[0], 'class')).toContain('aspect-[16/10]')
    expect(hasAttr(elements[0], 'data-theme-protected')).toBe(true)
    expect(preview).toContain("resolvedThemeTokens(preset, matchMedia('(prefers-color-scheme: dark)').matches)")
    expect(preview).toContain('`--izumi-safe-${name.replace(')
  })

  it('keeps the brand mark and gives themes and the d-pad nothing to hook', () => {
    expect(preview).toContain('<CatalogBrandLogo platform={$catalogScreen} />')
    for (const el of elements) {
      for (const name of ['data-part', 'data-slot', 'data-focusable', 'href', 'tabindex']) expect(hasAttr(el, name), `${el.name}:${el.line} ${name}`).toBe(false)
      expect(['a', 'button', 'input']).not.toContain(el.name)
    }
  })
})
