import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// The row's edge arrows are a mouse affordance: they sit at `opacity-0` and are revealed by
// `group-hover/carousel:opacity-100`. Touch WebViews latch :hover on the last-tapped subtree,
// so on a phone a tap on a card leaves the arrows painted — and because they are `z-[60]` they
// then sit ABOVE the source picker (`z-40`) that the same tap opened. Mobile drag-scrolls the
// row instead, so the arrows must not be rendered there at all.

const src = readFileSync(fileURLToPath(new URL('./Carousel.svelte', import.meta.url)), 'utf8')
const card = readFileSync(fileURLToPath(new URL('./SmallCard.svelte', import.meta.url)), 'utf8')

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

  it('exposes row boundaries for low-cost controller navigation', () => {
    expect(src).toContain('<section data-nav-row')
    expect(src).toContain('data-carousel-scroller data-nav-row-items')
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

  it('dismisses a hover trailer before wheel-scrolling the row', () => {
    const wheel = src.slice(src.indexOf('function onWheel'), src.indexOf('// Keep arrow visibility'))
    expect(wheel.indexOf('dismissPreview()')).toBeGreaterThan(-1)
    expect(wheel.indexOf('dismissPreview()')).toBeLessThan(wheel.indexOf('scroller.scrollLeft +='))
  })

  it('moves the row only for horizontal input and leaves vertical input to the page', () => {
    const wheel = src.slice(src.indexOf('function onWheel'), src.indexOf('// Keep arrow visibility'))
    expect(wheel).toContain('const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)')
    expect(wheel).toContain('if (!horizontal || !e.deltaX) return')
    expect(wheel).toContain('const delta = e.deltaX * unit')
    expect(wheel).toContain('scroller.scrollLeft += delta')
    expect(wheel).not.toContain('scroller.scrollLeft += e.deltaY')
    expect(src).toContain('data-carousel-scroller')
  })

  it('requires actual pointer movement before another preview can open', () => {
    expect(card).toContain("window.addEventListener('carousel-nav', () => { needsPointerMove = true })")
    expect(card).toContain("window.addEventListener('carousel-nav', close)")
    expect(card).toContain('onpointermove={openAfterPointerMove}')
    expect(card).not.toContain('suppressedUntil')
  })

  it('forwards wheel input received by the portalled preview to its originating row', () => {
    expect(card).toContain('if (Math.abs(e.deltaY) >= Math.abs(e.deltaX))')
    expect(card).toContain("window.dispatchEvent(new Event('carousel-nav'))")
    expect(card).toContain("el.closest<HTMLElement>('[data-carousel-scroller]')")
    expect(card).toContain("const consumed = !row.dispatchEvent(new WheelEvent('wheel'")
    expect(card).toContain('if (consumed)')
    expect(card).toContain('onwheel={forwardPreviewWheel}')
  })
})
