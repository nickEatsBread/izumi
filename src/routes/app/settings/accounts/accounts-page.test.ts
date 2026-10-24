import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { settingsSection } from '$lib/settings/sections'
import { SETTINGS_SEARCH_INDEX } from '$lib/settings/search'
import { sectionOf, subcategoriesOf, subcategoryKeys } from '../../../../test/settings-sections'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const read = (path: string) => readFileSync(here(path), 'utf8').replace(/\r\n/g, '\n')
const file = here('./+page.svelte')
const source = read('./+page.svelte')
const switcher = read('../../../../lib/components/profiles/ProfileSwitcher.svelte')
const keysIn = (id: string) => subcategoryKeys(file, subcategoriesOf(file).find((sub) => sub.id === id)!)
const BASE = 'https://izumi.invalid'

describe('Accounts and profiles section', () => {
  it('is a SettingsSection page with no title of its own', () => {
    expect(sectionOf(file)).toBe('accounts')
    expect(source).not.toContain('data-settings-page-title')
  })

  it('renders Trackers and lists, Keys, Profiles and Content in order, with no tabs', () => {
    expect(subcategoriesOf(file).map((sub) => sub.id)).toEqual(settingsSection('accounts').subcategories.map((sub) => sub.id))
    expect(source).not.toContain('data-page-tabs')
    expect(source).not.toContain('SettingsGroup')
  })

  it('renders every Accounts search key inside its subcategory', () => {
    const entries = SETTINGS_SEARCH_INDEX.filter((item) => item.section === 'accounts' && item.key)
    expect(entries.length).toBeGreaterThanOrEqual(14)
    for (const item of entries) {
      expect(new URL(item.href, BASE).pathname, item.title).toBe('/app/settings/accounts')
      expect([...keysIn(item.subcategory)], item.title).toContain(item.key)
    }
  })

  it('gives every row key a search entry', () => {
    const indexed = new Set(SETTINGS_SEARCH_INDEX.flatMap((item) => [item.key, item.fallbackKey]))
    for (const sub of subcategoriesOf(file)) for (const key of subcategoryKeys(file, sub)) expect(indexed.has(key), `${sub.id}: ${key}`).toBe(true)
  })

  it('puts connected trackers before optional imports and list behaviour', () => {
    const trackers = source.indexOf('settingKey="anilist-account"')
    const trakt = source.indexOf('<TraktAccountSettings />')
    const stremio = source.indexOf('settingKey="stremio-addon-account"')
    const letterboxd = source.indexOf('<LetterboxdAccountSettings />')
    const publicProfiles = source.indexOf('settingKey="anilist-public-profile"')
    const behaviour = source.indexOf('settingKey="automatically-add-watched-shows"')
    expect(trackers).toBeGreaterThan(0)
    expect(trakt).toBeGreaterThan(trackers)
    expect(stremio).toBeGreaterThan(trakt)
    expect(letterboxd).toBeGreaterThan(stremio)
    expect(publicProfiles).toBeGreaterThan(letterboxd)
    expect(behaviour).toBeGreaterThan(publicProfiles)
  })

  it('shows every tracker with a consistent provider badge', () => {
    for (const provider of ['anilist', 'mal', 'kitsu', 'simkl']) expect(source).toContain(`<TrackerProviderBadge provider="${provider}"`)
  })

  it('keeps credential and public-profile forms collapsed until needed', () => {
    expect(source).toContain('let publicProfileOpen = $state<PublicProfile | null>(null)')
    expect(source).toContain('let kitsuFormOpen = $state(false)')
    expect(source).toContain("onActivate={() => togglePublicProfile('anilist')}")
    expect(source).toContain("onActivate={() => togglePublicProfile('mal')}")
  })

  it('keeps the Kitsu and Stremio passwords ephemeral and says so beside the form', () => {
    expect(source).toContain('const password = kitsuPassword')
    expect(source).toContain("kitsuPassword = ''")
    expect(source).toContain('const password = stremioPassword')
    expect(source).toContain("stremioPassword = ''")
    expect(source).toContain('await syncStremioAddons()')
    expect(source).toContain('Other Izumi sources are excluded.')
    expect(source).toContain('Your password is exchanged once and never saved.')
  })

  it('enables the local automatic Watchlist at an editable episode threshold', () => {
    expect(source).toContain('settingKey="automatically-add-watched-shows"')
    expect(source).toContain('onActivate={() => ($autoWatchlistEnabled = !$autoWatchlistEnabled)}')
    expect(source).toContain('settingKey="episodes-before-watchlist"')
    expect(source).toContain('min="1"')
    expect(source).toContain('interactive={false}')
  })

  it('uses mobile-first controls that only become horizontal on wider screens', () => {
    expect(source.match(/flex flex-col gap-2 sm:flex-row/g)).toHaveLength(4)
    expect(source).toContain('grid gap-2 sm:grid-cols-2')
    expect(source).toContain('text-base sm:text-sm')
  })

  it('lists every key with its status and a link to where it is edited', () => {
    expect(source).toContain('{#each KEY_HUB as entry (entry.id)}')
    expect(source).toContain('href={keyHubHref(entry)}')
    expect(source).toContain("'Saved · hidden'")
    expect(source).toContain("'Not set'")
    expect(source).not.toContain('<CredentialField')
  })

  it('opens the household manager from Profiles and from the profile switcher', () => {
    expect(source).toContain('settingKey="household-profiles"')
    expect(source).toContain('href="/app/settings/accounts?manage=profiles"')
    expect(source).toContain("const managingProfiles = $derived(page.url.searchParams.get('manage') === 'profiles')")
    expect(source).toContain('{#if managingProfiles}<ProfileManager />{/if}')
    expect(switcher).toContain("void goto('/app/settings/accounts?manage=profiles')")
  })

  it('moves adult content and auto-incognito into Content and off the Interface page', () => {
    expect([...keysIn('content')].sort()).toEqual(['incognito-for-18-titles', 'show-18-content'])
    expect(source).toContain('learnMore={m.settings_auto_incognito_more()}')
    const interfacePage = here('../interface/+page.svelte')
    if (existsSync(interfacePage)) expect(readFileSync(interfacePage, 'utf8')).not.toContain('$showAdult')
  })

  it('keeps every description to one short line', () => {
    for (const [, text] of source.matchAll(/\sdescription="([^"]*)"/g)) expect(text.length, text).toBeLessThanOrEqual(80)
    expect(source).not.toMatch(/text-\[1[01]px\]/)
  })
})
