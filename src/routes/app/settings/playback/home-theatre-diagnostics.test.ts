import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('home-theatre capability diagnostics', () => {
  it('keeps home-theatre audio and Dolby Vision in Advanced, before the external player', () => {
    const advanced = page.indexOf('<SettingsSubcategory id="advanced"')
    const homeTheatreAudio = page.indexOf('title="Home-theatre audio"')
    const dolbyVision = page.indexOf('title="Dolby Vision source handling"')
    const externalPlayer = page.indexOf('title="Enable external player"')

    expect(advanced).toBeGreaterThan(-1)
    expect(homeTheatreAudio).toBeGreaterThan(advanced)
    expect(dolbyVision).toBeGreaterThan(homeTheatreAudio)
    expect(externalPlayer).toBeGreaterThan(dolbyVision)
  })

  it('only renders the raw capability report when developer logging is enabled', () => {
    expect(page).toContain('developerLogging,')
    // The in-app player gate (spec §5.1) also hides it on the Android lite build, which has no in-app player.
    expect(page).toMatch(/\{#if \$developerLogging && \$inAppPlayerAvailable\}\s*<section[^>]*>[\s\S]*?Home-theatre capability diagnostics[\s\S]*?<\/section>\s*\{\/if\}/)
  })
})
