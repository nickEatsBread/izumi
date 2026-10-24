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

describe('Appearance section', () => {
  it('is a SettingsSection page with no title of its own', () => {
    expect(sectionOf(file)).toBe('appearance')
    expect(page).not.toContain('data-settings-page-title')
  })

  it('renders the registry subcategories in order with Advanced last and folded', () => {
    const subcategories = subcategoriesOf(file)
    expect(subcategories.map((sub) => sub.id)).toEqual(settingsSection('appearance').subcategories.map((sub) => sub.id))
    const advanced = subcategories.at(-1)!
    expect(advanced.id).toBe('advanced')
    expect(advanced.summary).toBe('Wheel-scroll and mouse-drag carousels')
    expect(advanced.collapsible).toBe(false)
  })

  it('renders every Appearance search key inside its subcategory', () => {
    const entries = SETTINGS_SEARCH_INDEX.filter((item) => item.section === 'appearance' && item.key && new URL(item.href, BASE).pathname === '/app/settings/appearance')
    expect(entries.map((item) => item.key).sort()).toEqual([
      'android-tv-layout', 'haptics', 'high-contrast', 'larger-interaction-targets', 'motion', 'mouse-drag-carousels',
      'navigation-items', 'theme-preset', 'ui-scale', 'wheel-scroll-carousels',
    ])
    for (const item of entries) {
      expect([...keysIn(item.subcategory)], item.title).toContain(item.key)
      expect(item.advanced === true, item.title).toBe(item.subcategory === 'advanced')
    }
  })

  it('gives every row key a search entry', () => {
    const indexed = new Set(SETTINGS_SEARCH_INDEX.flatMap((item) => [item.key, item.fallbackKey]))
    for (const sub of subcategoriesOf(file)) for (const key of subcategoryKeys(file, sub)) expect(indexed.has(key), `${sub.id}: ${key}`).toBe(true)
  })

  it('keeps the platform gates of the moved rows', () => {
    expect(page).toMatch(/\{#if !\$isMobile\}\s*<SettingsRow settingKey="ui-scale"/)
    expect(readFileSync(here('../../+layout.svelte'), 'utf8')).toContain("rootStyle.zoom = $isMobile ? '1' : String($uiScale)")
    expect(page).toMatch(/\{#if \$isAndroid\}\s*<SettingsRow settingKey="haptics"/)
    expect(page).toMatch(/\{#if \$isMobile\}\s*<SettingsSubcategory id="navigation" plain>/)
    expect(page).toMatch(/\{#if \$isAndroid\}\s*<SettingsSubcategory id="tv">/)
  })

  it('turns the preset cards into one choice row and links Themes and Theme Studio', () => {
    expect(page).toContain('<SettingsChoiceRow settingKey="theme-preset"')
    expect(page).toContain("{ value: 'custom', label: 'Custom', description: 'From Themes or Theme Studio', disabled: true }")
    expect(page).toContain('href="/app/settings/themes"')
    expect(page).toContain('href="/app/settings/theme-studio"')
    expect(page).not.toContain('grid-cols-2')
    expect(page).not.toContain('<Toggle')
    expect(page).not.toContain("'../interface/+page.svelte'")
    expect(page).not.toContain("'../navigation/+page.svelte'")
  })

  it('keeps every description to one short line', () => {
    const en = JSON.parse(readFileSync(here('../../../../../messages/en.json'), 'utf8')) as Record<string, string>
    const hints = [...page.matchAll(/\sdescription=\{m\.(\w+)\(\)\}/g)].map(([, key]) => en[key])
    const branches = [...page.matchAll(/\sdescription=\{[^}]*\}/g)].flatMap(([expr]) => [...expr.matchAll(/'([^']*)'/g)].map(([, text]) => text))
    const literals = [...page.matchAll(/\sdescription="([^"]*)"/g)].map(([, text]) => text)
    expect(hints.length).toBeGreaterThan(0)
    expect(branches.length).toBeGreaterThan(0)
    for (const text of [...literals, ...hints, ...branches]) expect(text?.length ?? Infinity, text).toBeLessThanOrEqual(80)
  })
})
