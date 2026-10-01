import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { settingsPageTitle } from '$lib/settings/hierarchy'

const license = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')
const about = readFileSync(fileURLToPath(new URL('../+page.svelte', import.meta.url)), 'utf8')
const layout = readFileSync(fileURLToPath(new URL('../../+layout.svelte', import.meta.url)), 'utf8')

describe('About license information', () => {
  it('shows a simple License Information hyperlink beneath the information card', () => {
    expect(about).toContain('href="/app/settings/about/license-information"')
    expect(about).toContain('>License Information</a>')
    expect(about).not.toContain('Credits')
    expect(about).not.toContain('This product uses the TMDB API')
  })

  it('keeps license information and required TMDB attribution on the nested screen', () => {
    expect(license).toContain('GNU Affero General Public License v3.0 or later')
    expect(license).toContain('https://github.com/nickEatsBread/izumi/blob/main/LICENSE')
    expect(license).toContain('This product uses the TMDB API but is not endorsed or certified by TMDB.')
  })

  it('titles the nested route before the broader About prefix', () => {
    // The phone header takes its title from the shared route table, where the longest prefix wins.
    expect(layout).toContain('settingsPageTitle($page.url.pathname)')
    expect(settingsPageTitle('/app/settings/about/license-information')).toBe('License Information')
    expect(settingsPageTitle('/app/settings/about')).toBe('About')
  })
})
