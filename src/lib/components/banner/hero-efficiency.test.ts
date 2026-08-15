import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const hero = readFileSync(fileURLToPath(new URL('./Hero.svelte', import.meta.url)), 'utf8')

describe('home hero efficiency', () => {
  it('advances with one timer and animates progress without per-frame Svelte updates', () => {
    expect(hero).not.toContain('requestAnimationFrame(tick)')
    expect(hero).toContain('setTimeout(() => go((i + 1) % n), DURATION)')
    expect(hero).toContain('animation: hero-progress-fill 15s linear forwards')
    expect(hero).toContain('transform: scaleX(1)')
  })
})
