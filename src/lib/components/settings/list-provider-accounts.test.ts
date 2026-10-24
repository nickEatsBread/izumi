import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const accounts = readFileSync(new URL('../../../routes/app/settings/accounts/+page.svelte', import.meta.url), 'utf8')
const providers = readFileSync(new URL('../../stremio/list-providers.ts', import.meta.url), 'utf8')
describe('single service setup', () => {
  it('keeps one native Trakt connection and removes add-on account setup', () => {
    expect(accounts.match(/<TraktAccountSettings/g)).toHaveLength(1)
    expect(accounts).not.toContain('ListProviderAccounts')
    expect(existsSync(new URL('./ListProviderAccounts.svelte', import.meta.url))).toBe(false)
    expect(providers).not.toContain('mdblist')
  })
  it('routes optional add-on management to Sources without deleting existing installs', () => {
    expect(accounts).toContain('href="/app/settings/sources"')
    expect(accounts).toContain('href="/app/settings/library/home?provider=stremio"')
    expect(accounts).not.toContain('$addonUrls =')
  })
})
