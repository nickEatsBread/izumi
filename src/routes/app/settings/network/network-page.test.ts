import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { settingsSection } from '$lib/settings/sections'
import { SETTINGS_SEARCH_INDEX } from '$lib/settings/search'
import { sectionOf, subcategoriesOf, subcategoryKeys } from '../../../../test/settings-sections'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const file = here('./+page.svelte')
const page = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const keysIn = (id: string) => subcategoryKeys(file, subcategoriesOf(file).find((sub) => sub.id === id)!)
const BASE = 'https://izumi.invalid'

describe('Network and P2P section', () => {
  it('is a SettingsSection page with no title of its own', () => {
    expect(sectionOf(file)).toBe('network')
    expect(page).not.toContain('data-settings-page-title')
  })

  it('renders P2P status and limits, then a folded Advanced', () => {
    const subcategories = subcategoriesOf(file)
    expect(subcategories.map((sub) => sub.id)).toEqual(settingsSection('network').subcategories.map((sub) => sub.id))
    expect(subcategories.at(-1)!.summary).toBe('DNS over HTTPS, VPN binding, SOCKS5 proxy, seeding')
  })

  it('renders every Network search key inside its subcategory', () => {
    const entries = SETTINGS_SEARCH_INDEX.filter((item) => item.section === 'network' && item.key)
    expect([...new Set(entries.map((item) => item.key))].sort()).toEqual([
      'continue-seeding-after-playback', 'require-socks5-proxy', 'torrent-download-limit', 'torrent-upload-limit',
      'use-dns-over-https', 'vpn-adapter-binding',
    ])
    for (const item of entries) {
      expect(new URL(item.href, BASE).pathname, item.title).toBe('/app/settings/network')
      expect([...keysIn(item.subcategory)], item.title).toContain(item.key)
      expect(item.advanced === true, item.title).toBe(item.subcategory === 'advanced')
    }
  })

  it('gives every row key a search entry', () => {
    const indexed = new Set(SETTINGS_SEARCH_INDEX.flatMap((item) => [item.key, item.fallbackKey]))
    for (const sub of subcategoriesOf(file)) for (const key of subcategoryKeys(file, sub)) expect(indexed.has(key), `${sub.id}: ${key}`).toBe(true)
  })

  it('keeps the platform gates', () => {
    expect(page).toMatch(/\{#if !\$isAndroid\}\s*<SettingsChoiceRow settingKey="vpn-adapter-binding"/)
    expect(page).toMatch(/\{#if \$isAndroid\}\s*<SettingsRow settingKey="continue-seeding-after-playback"/)
  })

  it('no longer owns the sync relay', () => {
    expect(page).not.toContain('syncRelayMode')
    expect(page).not.toContain('setSyncRelay')
    expect(page).not.toContain('<Toggle')
  })

  it('keeps every description to one short line', () => {
    for (const [, text] of page.matchAll(/\sdescription="([^"]*)"/g)) expect(text.length, text).toBeLessThanOrEqual(80)
  })
})
