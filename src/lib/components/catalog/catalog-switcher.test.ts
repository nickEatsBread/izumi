import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./CatalogSwitcher.svelte', import.meta.url)), 'utf8')

describe('catalog switcher', () => {
  it('shows the active catalog before opening the picker', () => {
    expect(source).toContain('Catalog: ${activeLabel}. Choose catalog')
    expect(source).toContain('{activeLabel}</span>')
    expect(source).toContain('aria-expanded={open}')
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
