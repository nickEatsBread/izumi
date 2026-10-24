import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const component = readFileSync(fileURLToPath(new URL('./LetterboxdAccountSettings.svelte', import.meta.url)), 'utf8')

describe('Letterboxd account settings', () => {
  it('uses supported RSS and export paths instead of pretending an OAuth integration exists', () => {
    expect(component).toContain('official per-profile RSS feed')
    expect(component).toContain('https://letterboxd.com/user/exportdata/')
    expect(component).toContain('no scraping or unofficial sign-in')
    expect(component).not.toContain('client_secret')
  })

  it('clears a previous profile feed when the username changes', () => {
    expect(component).toContain('$letterboxdFeedCache = []')
    expect(component).toContain('$letterboxdFeedUpdatedAt = 0')
  })

  it('renders one row that sits in the Trackers and lists card', () => {
    expect(component).not.toContain('SettingsGroup')
    expect(component).toContain('learnMore="A supported public-diary and data-export experience; no scraping or unofficial sign-in."')
    expect(component).not.toMatch(/text-\[1[01]px\]/)
  })
})
