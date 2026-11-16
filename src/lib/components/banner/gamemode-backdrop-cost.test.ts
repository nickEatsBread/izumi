import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../../../app.css', import.meta.url)), 'utf8')
const hero = readFileSync(fileURLToPath(new URL('./Hero.svelte', import.meta.url)), 'utf8')

describe('backdrop and loading cost', () => {
  it('pauses the shimmer of rows held below the fold', () => {
    expect(css).not.toMatch(/html\.gamemode \.skeloader::before \{\s*animation:\s*none/)
    expect(css).toMatch(/\.deferred-skeleton \.skeloader::before \{\s*animation-play-state:\s*paused;?\s*\}/)
  })

  it('lets a placeholder\'s own position utilities beat the shimmer class', () => {
    // Unlayered, `.skeloader { position: relative }` beat `absolute inset-0` and every loading
    // banner's shimmer layer was 0 px tall: Home loaded with no banner placeholder at all.
    expect(css).toContain('@layer components { .skeloader { position: relative; overflow: hidden; background: hsl(var(--muted)); } }')
  })

  it('ticks the Hero countdown clock slowly unless the label shows seconds', () => {
    expect(hero).not.toContain('setInterval(() => (clock = Date.now()), 1_000)')
    expect(hero).toMatch(/heroClockTickMs/)
  })
})
