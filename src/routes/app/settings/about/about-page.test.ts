import { existsSync, readFileSync } from 'node:fs'
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

describe('About section', () => {
  it('is a SettingsSection page with no title of its own', () => {
    expect(sectionOf(file)).toBe('about')
    expect(page).not.toContain('data-settings-page-title')
  })

  it('renders Version, Changelog, Licenses, Reset and a folded Advanced in order', () => {
    const subcategories = subcategoriesOf(file)
    expect(subcategories.map((sub) => sub.id)).toEqual(settingsSection('about').subcategories.map((sub) => sub.id))
    const advanced = subcategories.at(-1)!
    expect(advanced.summary).toBe('Release channel, developer logging, diagnostics, DevTools')
    expect(advanced.collapsible).toBe(false)
  })

  it('renders every About search key inside its subcategory', () => {
    const entries = SETTINGS_SEARCH_INDEX.filter((item) => item.section === 'about' && item.key)
    expect(entries.map((item) => item.key).sort()).toEqual([
      'app-version', 'developer-logging', 'developer-tools', 'diagnostics-report', 'release-channel', 'reset-defaults', 'setup-assistant', 'updates',
    ])
    for (const item of entries) {
      expect(new URL(item.href, BASE).pathname, item.title).toBe('/app/settings/about')
      expect([...keysIn(item.subcategory)], item.title).toContain(item.key)
      expect(item.advanced === true, item.title).toBe(item.subcategory === 'advanced')
    }
  })

  it('gives every row key a search entry', () => {
    const indexed = new Set(SETTINGS_SEARCH_INDEX.flatMap((item) => [item.key, item.fallbackKey]))
    for (const sub of subcategoriesOf(file)) for (const key of subcategoryKeys(file, sub)) expect(indexed.has(key), `${sub.id}: ${key}`).toBe(true)
  })

  it('links the Changelog and License sub-pages', () => {
    expect(page).toContain('href="/app/settings/about/changelog"')
    expect(page).toContain('href="/app/settings/about/license-information"')
    expect(existsSync(here('./changelog/+page.svelte'))).toBe(true)
  })

  it('keeps release channel, developer logging and DevTools desktop-only', () => {
    expect(page).toMatch(/\{#if !\$isAndroid\}\s*<SettingsChoiceRow settingKey="release-channel"/)
    expect(page).toMatch(/\{#if !\$isAndroid\}\s*<SettingsRow settingKey="developer-tools"/)
  })

  it('confirms before a reset, offers the backup first, and runs the setup assistant', () => {
    expect(page).toContain('expanded={confirmReset}')
    expect(page).toContain('href="/app/settings/devices#backup"')
    expect(page).toContain('settingKey="setup-assistant"')
    expect(page).toContain('onclick={restartOnboarding}')
    const interfacePage = here('../interface/+page.svelte')
    if (existsSync(interfacePage)) expect(readFileSync(interfacePage, 'utf8')).not.toContain('restartOnboarding')
  })

  it('keeps every description to one short line', () => {
    for (const [, text] of page.matchAll(/\sdescription="([^"]*)"/g)) expect(text.length, text).toBeLessThanOrEqual(80)
    expect(page).not.toContain('<Toggle')
  })
})
