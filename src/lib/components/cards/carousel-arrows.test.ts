import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// The row's edge arrows are a mouse affordance: they sit at `opacity-0` and are revealed by
// `group-hover/carousel:opacity-100`. Touch WebViews latch :hover on the last-tapped subtree,
// so on a phone a tap on a card leaves the arrows painted — and because they are `z-[60]` they
// then sit ABOVE the source picker (`z-40`) that the same tap opened. Mobile drag-scrolls the
// row instead, so the arrows must not be rendered there at all.

const src = readFileSync(fileURLToPath(new URL('./Carousel.svelte', import.meta.url)), 'utf8')

/** Each arrow button paired with the `{#if}` condition that guards it. */
function arrowGuards(): Array<{ direction: string; condition: string }> {
  return [...src.matchAll(/\{#if ([^}]+)\}\s*<button aria-label="Scroll (left|right)"/g)].map((match) => ({
    direction: match[2],
    condition: match[1],
  }))
}

describe('Carousel edge arrows', () => {
  it('derives the mobile signal from the shared platform store', () => {
    expect(src).toContain("import { isMobile } from '$lib/platform'")
    expect(src).toContain('const mob = $derived($isMobile)')
  })

  it('guards both arrows', () => {
    expect(arrowGuards().map((guard) => guard.direction)).toEqual(['left', 'right'])
  })

  it('does not render the arrows on mobile', () => {
    for (const { direction, condition } of arrowGuards())
      expect(condition, `the ${direction} arrow renders on mobile`).toContain('!mob')
  })

  it('keeps the existing game-mode and scrollability guards', () => {
    for (const { direction, condition } of arrowGuards()) {
      expect(condition, `the ${direction} arrow lost its game-mode guard`).toContain('!gm')
      expect(condition).toContain(direction === 'left' ? 'canLeft' : 'canRight')
    }
  })
})
