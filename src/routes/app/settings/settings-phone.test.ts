import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importClosure } from '../../../test/svelte-markup'
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from '$lib/settings/sections'
import { settingsPageTitle } from '$lib/settings/hierarchy'

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const read = (relative: string) => readFileSync(here(relative), 'utf8').replace(/\r\n/g, '\n')
const nav = read('../../../lib/components/settings/SettingsNav.svelte')
const section = read('../../../lib/components/settings/SettingsSection.svelte')

describe('phone settings', () => {
  it('lists 11 sections under the 5 group headings with short static subtitles', () => {
    expect(SETTINGS_GROUPS.map((group) => group.label)).toEqual(['Watch', 'Library', 'Look', 'You', 'System'])
    expect(SETTINGS_SECTIONS).toHaveLength(11)
    for (const each of SETTINGS_SECTIONS) {
      expect(each.subtitle.length, each.id).toBeGreaterThan(0)
      expect(each.subtitle.length, each.id).toBeLessThanOrEqual(48)
      // No live counts; a digit inside a word ("P2P") is a name, not a value.
      expect(each.subtitle, each.id).not.toMatch(/\b\d+\b/)
    }
    expect(nav).toContain('.subtitle')
    expect(nav).not.toMatch(/text-\[1[01]px\]/)
  })

  it('titles each Look, You and System page in the sticky back-header', () => {
    expect(settingsPageTitle('/app/settings/appearance')).toBe('Appearance')
    expect(settingsPageTitle('/app/settings/accounts')).toBe('Accounts and profiles')
    expect(settingsPageTitle('/app/settings/devices')).toBe('Devices and backup')
    expect(settingsPageTitle('/app/settings/network')).toBe('Network and P2P')
    expect(settingsPageTitle('/app/settings/about')).toBe('About')
    expect(settingsPageTitle('/app/settings/about/changelog')).toBe('Changelog')
  })

  it('hides the section header in the phone child, where the back-header names the section', () => {
    expect(section).toContain(':global(.settings-child) [data-settings-section-header] { display: none; }')
  })

  it('renders no old page title inside a section any more, so the transitional rule is gone', () => {
    for (const each of SETTINGS_SECTIONS) {
      for (const file of importClosure([here(`./${each.id}/+page.svelte`)])) {
        if (file.endsWith('SettingsSection.svelte')) continue
        expect(readFileSync(file, 'utf8'), `${each.id}: ${file}`).not.toContain('data-settings-page-title')
      }
    }
    expect(section).not.toContain(':global([data-settings-page-title])')
  })
})
