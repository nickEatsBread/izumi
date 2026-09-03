import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('Accounts settings information architecture', () => {
  it('puts connected trackers before optional public profiles and sync behaviour', () => {
    const trackers = source.indexOf('title="Tracker accounts"')
    const stremio = source.indexOf('title="Stremio add-on sync"')
    const listProviders = source.indexOf('<ListProviderAccounts />')
    const publicProfiles = source.indexOf('title="Public libraries"')
    const sync = source.indexOf('title="List behaviour"')
    expect(trackers).toBeGreaterThan(0)
    expect(stremio).toBeGreaterThan(trackers)
    expect(stremio).toBeLessThan(listProviders)
    expect(trackers).toBeLessThan(listProviders)
    expect(listProviders).toBeLessThan(publicProfiles)
    expect(publicProfiles).toBeLessThan(sync)
  })

  it('uses dense shared rows instead of one floating card per service', () => {
    expect(source.match(/<SettingsRow/g)?.length).toBeGreaterThanOrEqual(7)
    expect(source).not.toContain('mb-6 rounded-md border border-border p-4')
    expect(source).not.toContain('Read-only (no login)')
  })

  it('shows every tracker with a consistent provider badge and status', () => {
    for (const provider of ['anilist', 'mal', 'kitsu', 'simkl']) {
      expect(source).toContain(`<TrackerProviderBadge provider="${provider}"`)
    }
    expect(source).toContain('connectedCount')
  })

  it('keeps credential and public-profile forms collapsed until needed', () => {
    expect(source).toContain("let publicProfileOpen = $state<PublicProfile | null>(null)")
    expect(source).toContain('let kitsuFormOpen = $state(false)')
    expect(source).toContain("onActivate={() => togglePublicProfile('anilist')}")
    expect(source).toContain("onActivate={() => togglePublicProfile('mal')}")
  })

  it('keeps the Kitsu password ephemeral and explains that protection beside the form', () => {
    expect(source).toContain('const password = kitsuPassword')
    expect(source).toContain("kitsuPassword = ''")
    expect(source).toContain('Your password is exchanged once and never saved.')
  })

  it('enables the local automatic Watchlist at an editable episode threshold', () => {
    expect(source).toContain('settingKey="automatically-add-watched-shows"')
    expect(source).toContain('onActivate={() => ($autoWatchlistEnabled = !$autoWatchlistEnabled)}')
    expect(source).toContain('settingKey="episodes-before-watchlist"')
    expect(source).toContain('min="1"')
    expect(source).toContain('interactive={false}')
  })

  it('keeps Stremio authentication add-on-only and the password ephemeral', () => {
    expect(source).toContain('settingKey="stremio-addon-account"')
    expect(source).toContain('Other Izumi sources are excluded.')
    expect(source).toContain('const password = stremioPassword')
    expect(source).toContain("stremioPassword = ''")
    expect(source).toContain('await syncStremioAddons()')
    expect(source).toContain('Your password is exchanged once and never saved.')
  })

  it('uses mobile-first controls that only become horizontal on wider screens', () => {
    expect(source.match(/flex flex-col gap-2 sm:flex-row/g)).toHaveLength(4)
    expect(source).toContain('grid gap-2 sm:grid-cols-2')
    expect(source).toContain('text-base sm:text-sm')
  })
})
