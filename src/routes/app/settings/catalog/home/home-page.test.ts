import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')
const catalogPage = readFileSync(fileURLToPath(new URL('../+page.svelte', import.meta.url)), 'utf8')
const interfacePage = readFileSync(fileURLToPath(new URL('../../interface/+page.svelte', import.meta.url)), 'utf8')

describe('Home row customization screen', () => {
  it('is entered from Catalog rather than general Interface settings', () => {
    expect(catalogPage).toContain('/app/settings/catalog/home?provider=')
    expect(catalogPage).toContain('Customize Home')
    expect(interfacePage).not.toContain('DEFAULT_HOME_ROWS')
    expect(interfacePage).not.toContain('homeRowOrder')
  })

  it('switches providers and separates ordered and available rows', () => {
    expect(source).toContain('role="tablist"')
    expect(source).toContain('On your Home')
    expect(source).toContain('Available rows')
    expect(source).toContain('move(row.id, -1)')
    expect(source).toContain('move(row.id, 1)')
    expect(source).toContain('add(row.id)')
    expect(source).toContain('hide(row.id)')
  })

  it('offers a per-provider reset', () => {
    expect(source).toContain('resetCatalogHomeLayout(selected)')
  })
})
