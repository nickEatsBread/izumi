import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./CatalogSwitcher.svelte', import.meta.url)), 'utf8')

describe('catalog switcher', () => {
  it('supports compact and labelled triggers while exposing the active catalog', () => {
    expect(source).toContain('Catalog: ${activeLabel}. Choose catalog')
    expect(source).toContain("display?: 'brand' | 'icon' | 'value' | 'rail'")
    expect(source).toContain("display === 'icon'")
    expect(source).toContain('size-11 place-items-center overflow-hidden rounded-full')
    expect(source).toContain('scale-110')
    expect(source).toContain('{activeLabel}</span>')
    expect(source).toContain('aria-expanded={open}')
  })

  it('offers both an explicit rail row and a restrained integrated brand trigger', () => {
    expect(source).toContain("display === 'rail'")
    expect(source).toContain('Catalog: {activeLabel}</span>')
    expect(source).toContain("expanded ? 'opacity-100' : 'opacity-0'")
    expect(source).toContain("display === 'brand'")
    expect(source).toContain('<CatalogBrandLogo platform={$catalogProvider} />')
    expect(source).toContain('showWordmark')
    // Integrated mode must keep the mark clean instead of layering another provider badge on it.
    expect(source).not.toContain('CatalogProviderBadge')
  })

  it('does not let positioning utilities push the Home hero down', () => {
    expect(source).toContain('<div bind:this={root} class={className}')
    expect(source).toContain(`relative {display === 'rail' ? 'w-full' : 'w-fit'}`)
    expect(source).not.toContain('class="relative {className}"')
  })

  it('offers direct selection from only the enabled catalogs', () => {
    expect(source).toContain('const choices = $derived($enabledCatalogProviders)')
    expect(source).toContain('{#each choices as provider (provider)}')
    expect(source).toContain('selectCatalogProvider(provider)')
    expect(source).toContain('aria-selected={provider === $catalogProvider}')
  })

  it('adapts the same selection model to a mobile bottom sheet', () => {
    expect(source).toContain("$isMobile ? 'dialog' : undefined")
    expect(source).toContain("'fixed inset-x-0 bottom-0")
    expect(source).toContain('role="listbox"')
  })

  it('keeps catalog configuration one step away', () => {
    expect(source).toContain('href="/app/settings/catalog"')
    expect(source).toContain('Manage catalogs')
  })
})
