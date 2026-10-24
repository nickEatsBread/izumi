import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const component = readFileSync(fileURLToPath(new URL('./TraktAccountSettings.svelte', import.meta.url)), 'utf8')

describe('native Trakt account settings', () => {
  it('uses the website callback and keeps all credentials scoped to the active profile', () => {
    expect(component).toContain('startTraktBrowserAuth')
    expect(component).toContain('izumi.watch/link/trakt')
    expect(component).toContain('completeTraktBrowserAuth')
    expect(component).toContain('inside the active profile')
    expect(component).toContain('never includes it in profile sync')
  })

  it('exposes loading, cancellation, error, and connected states', () => {
    expect(component).toContain('Waiting for browser approval')
    expect(component).toContain('onclick={cancel}')
    expect(component).toContain('role="alert"')
    expect(component).toContain('Open profile')
  })

  it('shows the official Trakt logo mark', () => {
    expect(component).toContain('src="/brand/trakt.svg"')
    expect(component).not.toContain('>TRAKT</span>')
  })

  it('renders one row that sits in the Trackers and lists card', () => {
    expect(component).not.toContain('SettingsGroup')
    expect(component).toContain('learnMore="Native history, Watchlist, rating sync, and a dedicated recommendation hub for this Izumi profile."')
    expect(component).not.toMatch(/text-\[1[01]px\]/)
  })
})
