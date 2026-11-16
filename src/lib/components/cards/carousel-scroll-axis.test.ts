// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

vi.mock('$lib/player/session', async () => {
  const { writable } = await import('svelte/store')
  return { gameMode: writable(false), playing: writable(false) }
})

const { dragScroll } = await import('$lib/nav/actions')
const { gameMode } = await import('$lib/player/session')
const { wheelScrollAcross } = await import('$lib/settings/ui')

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const carousel = read('./Carousel.svelte')
const css = read('../../../app.css')

// On Home a vertical swipe or two-finger scroll that started over a row moved the row instead of the
// page. Two causes: the track set only overflow-x, so it computed `overflow-y: auto` and any vertical
// overflow (cards mid load-in, a press transform) made it a vertical scroller; and on desktop a wheel or
// touchpad event with any sideways component was given to the scrollable row, which took the dx and
// dropped the dy.
describe('row tracks never scroll vertically', () => {
  it('clamps the track to the horizontal axis', () => {
    expect(carousel).toContain('class="flex gap-3 overflow-x-scroll overflow-y-hidden pb-2"')
  })

  it('keeps grid rows unclipped on both axes', () => {
    const style = carousel.slice(carousel.indexOf('<style>'))
    const grid = style.slice(style.indexOf('.theme-grid {'), style.indexOf('}', style.indexOf('.theme-grid {')))
    expect(grid).toContain('overflow: visible;')
    expect(grid).not.toContain('overflow-x: visible')
  })
})

describe('desktop rows are not native scrollers', () => {
  const block = css.match(/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\n\}/)?.[0] ?? ''

  it('pins rows on hover + fine-pointer desktops, outside Game mode', () => {
    expect(block).toContain('html:not(.gamemode) [data-carousel-scroller] { overflow: hidden; touch-action: pan-y; }')
    expect(block).not.toContain('any-pointer')
    // Phones keep native rows with snap; the phone block is untouched.
    expect(css).toMatch(/@media \(max-width: 640px\) and \(pointer: coarse\) \{\r?\n {2}\[data-carousel-scroller\] \{ scroll-snap-type: x proximity;/)
  })

  it('leaves Game-mode rows native, for Chromium to scroll and fling by touch', () => {
    expect(css).not.toContain('.gamemode [data-carousel-scroller] { overflow: hidden; }')
  })

  it('moves the row from the wheel for horizontal input, on by default', () => {
    expect(get(wheelScrollAcross)).toBe(true)
    const wheel = carousel.slice(carousel.indexOf('function onWheel'), carousel.indexOf('// Keep arrow visibility'))
    expect(wheel).toContain('const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)')
    expect(wheel).toContain('if (!horizontal || !e.deltaX) return')
  })

  it('steps the banner from a sideways wheel in Game mode too: a finger swipe sends no wheel events', () => {
    expect(read('../banner/Hero.svelte')).toContain('if (!$wheelScrollAcross || medias.length < 2')
    expect(carousel).toContain('    if (grid) return')
  })
})

// The first jsdom style resolution is slow on a loaded machine; the drags themselves are instant.
describe('mouse drag on a pinned row', { timeout: 20_000 }, () => {
  let cleanups: Array<() => void> = []
  afterEach(() => {
    for (const cleanup of cleanups) cleanup()
    cleanups = []
    gameMode.set(false)
    document.body.innerHTML = ''
  })

  // jsdom has no layout: give the row a writable scrollLeft.
  function row() {
    const node = document.createElement('div')
    node.style.overflowX = 'hidden'
    let left = 0
    Object.defineProperty(node, 'scrollLeft', { configurable: true, get: () => left, set: (value: number) => { left = value } })
    node.appendChild(document.createElement('a'))
    document.body.appendChild(node)
    const handle = dragScroll(node)
    cleanups.push(() => handle.destroy())
    return node
  }
  function drag(node: HTMLElement, pointerType: string, dx: number) {
    const target = node.firstElementChild!
    const init = { bubbles: true, cancelable: true, pointerId: 7, pointerType, button: 0, buttons: 1 }
    target.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: 200, clientY: 100 }))
    for (let step = 1; step <= 4; step++) target.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: 200 + (dx * step) / 4, clientY: 100 }))
    target.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientX: 200 + dx, clientY: 100 }))
    return node.scrollLeft
  }

  it('drags with the mouse and leaves a finger or pen to the browser', () => {
    const node = row()
    expect(drag(node, 'mouse', -120)).toBe(120)
    expect(drag(node, 'touch', -60)).toBe(120)
    expect(drag(node, 'pen', -60)).toBe(120)
  })

  it('never drives a row in Game mode, where rows scroll natively', () => {
    gameMode.set(true)
    expect(drag(row(), 'mouse', -120)).toBe(0)
  })
})
