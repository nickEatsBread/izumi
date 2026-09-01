import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('home-theatre capability diagnostics', () => {
  it('keeps home-theatre controls near the bottom of Player settings', () => {
    const externalPlayer = page.indexOf('Enable external player')
    const homeTheatreAudio = page.indexOf('Home-theatre audio')
    const dolbyVision = page.indexOf('Dolby Vision source handling')
    const gameMode = page.indexOf('>Game mode<')

    expect(homeTheatreAudio).toBeGreaterThan(externalPlayer)
    expect(dolbyVision).toBeGreaterThan(homeTheatreAudio)
    expect(gameMode).toBeGreaterThan(dolbyVision)
  })

  it('only renders the raw capability report when developer logging is enabled', () => {
    expect(page).toContain('developerLogging,')
    expect(page).toMatch(/\{#if \$developerLogging\}\s*<section[^>]*>[\s\S]*?Home-theatre capability diagnostics[\s\S]*?<\/section>\s*\{\/if\}/)
  })
})
