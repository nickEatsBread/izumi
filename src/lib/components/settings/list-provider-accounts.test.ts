import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const component = readFileSync(fileURLToPath(new URL('./ListProviderAccounts.svelte', import.meta.url)), 'utf8')
const accounts = readFileSync(fileURLToPath(new URL('../../../routes/app/settings/accounts/+page.svelte', import.meta.url)), 'utf8')
const sources = readFileSync(fileURLToPath(new URL('../../../routes/app/settings/sources/+page.svelte', import.meta.url)), 'utf8')

describe('list provider accounts UI', () => {
  it('places Trakt and MDBList account management on Accounts rather than Sources', () => {
    expect(accounts).toContain('<ListProviderAccounts />')
    expect(component).toContain('title="List providers"')
    expect(component).toContain('{#each LIST_PROVIDERS as provider')
    expect(sources).not.toContain('Catalog integrations')
    expect(sources).not.toContain('CATALOG_INTEGRATIONS')
  })

  it('discovers manifest catalogs and exposes each as an addable Home element', () => {
    expect(component).toContain('stremioHomeRowOptionsForSources')
    expect(component).toContain('insertHomeRow')
    expect(component).toContain('Add to Home')
    expect(component).toContain('/app/settings/catalog/home?provider=stremio')
  })

  it('replaces, enables, reconfigures, and disconnects private provider manifests', () => {
    expect(component).toContain('replaceAddonBase')
    expect(component).toContain('enableCatalogPlatform()')
    expect(component).toContain('Reconfigure')
    expect(component).toContain('Disconnect')
  })
})
