import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Game-mode featured carousel height', () => {
  it('gives the home carousel a little more vertical room', () => {
    const source = readFileSync(new URL('./Hero.svelte', import.meta.url), 'utf8')

    expect(source).toContain('class:game-home-hero={$gameMode && showOverlay}')
    expect(source).toMatch(/\.game-home-hero\s*\{\s*height:\s*52vh;/)
  })
})
