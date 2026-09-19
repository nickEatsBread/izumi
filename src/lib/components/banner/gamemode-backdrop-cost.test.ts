import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../../../app.css', import.meta.url)), 'utf8')
const hero = readFileSync(fileURLToPath(new URL('./Hero.svelte', import.meta.url)), 'utf8')

describe('Game mode backdrop cost', () => {
  it('neutralises the mesh theme blur under html.gamemode', () => {
    // The mesh backdrop is a full-viewport `filter: blur()` layer; the generic Game-mode rule only
    // strips backdrop-filter, so the blur survived on the Deck iGPU.
    const rule = css.match(/html\.gamemode \.theme-studio-backdrop \{[^}]*\}/)
    expect(rule, 'gamemode rule for .theme-studio-backdrop').toBeTruthy()
    expect(rule![0]).toMatch(/filter:\s*none\s*!important/)
    expect(rule![0]).toMatch(/transform:\s*none\s*!important/)
  })

  it('does not run main-thread infinite animations in Game mode', () => {
    // No compositor promotion there, so an infinite transform animation is a repaint per frame.
    expect(css).toMatch(/html\.gamemode \.skeloader::before \{\s*animation:\s*none;?\s*\}/)
    const artwork = readFileSync(
      fileURLToPath(new URL('../onboarding/SetupArtwork.svelte', import.meta.url)),
      'utf8',
    )
    expect(artwork).toMatch(/:global\(html\.gamemode\) \.poster-column \{\s*animation:\s*none;?\s*\}/)
  })

  it('ticks the Hero countdown clock slowly unless the label shows seconds', () => {
    expect(hero).not.toContain('setInterval(() => (clock = Date.now()), 1_000)')
    expect(hero).toMatch(/heroClockTickMs/)
  })
})
