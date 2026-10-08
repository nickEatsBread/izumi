// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

vi.mock('$lib/player/session', async () => {
  const { writable } = await import('svelte/store')
  return { gameMode: writable(false), playing: writable(false) }
})
vi.mock('$lib/platform', async () => {
  const { writable } = await import('svelte/store')
  return { isAndroid: writable(false), isMacOS: writable(false), isWindows: writable(true) }
})

const { dragScroll, gameModeCarouselTouch } = await import('$lib/nav/actions')
const { gameMode } = await import('$lib/player/session')
const { isWindows } = await import('$lib/platform')
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

  it('pins rows on hover + fine-pointer desktops, touchscreen laptops included', () => {
    expect(block).toContain('[data-carousel-scroller] { overflow: hidden; touch-action: pan-y; }')
    expect(block).not.toContain('any-pointer')
    // Phones keep native rows with snap; the phone block is untouched.
    expect(css).toMatch(/@media \(max-width: 640px\) and \(pointer: coarse\) \{\r?\n {2}\[data-carousel-scroller\] \{ scroll-snap-type: x proximity;/)
  })

  it('leaves the Game-mode rule byte-identical and first', () => {
    const pinned = css.indexOf('.gamemode [data-carousel-scroller] { overflow: hidden; }')
    expect(pinned).toBeGreaterThan(-1)
    expect(css.indexOf('.gamemode [data-carousel-scroller]')).toBe(pinned)
  })

  it('moves the row from the wheel for horizontal input, on by default', () => {
    expect(get(wheelScrollAcross)).toBe(true)
    const wheel = carousel.slice(carousel.indexOf('function onWheel'), carousel.indexOf('// Keep arrow visibility'))
    expect(wheel).toContain('const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)')
    expect(wheel).toContain('if (!horizontal || !e.deltaX) return')
  })

  it('keeps the banner from stepping twice for one Game-mode finger swipe now the wheel is on by default', () => {
    expect(read('../banner/Hero.svelte')).toContain('if (!$wheelScrollAcross || $gameMode || medias.length < 2')
  })

  it('ignores the wheel events WebKitGTK synthesizes from a finger drag on the row', () => {
    expect(carousel).toContain("node.addEventListener('pointerdown', onTrackPointerDown)")
    expect(carousel).toContain('if (grid || pressed) return')
    const down = carousel.slice(carousel.indexOf('function onTrackPointerDown'), carousel.indexOf('// Horizontal wheel/trackpad input'))
    expect(down).toContain("if (e.pointerType === 'mouse' && !$gameMode) return")
    expect(down).toContain("window.addEventListener('pointerup', release, true)")
    expect(down).toContain("window.addEventListener('pointercancel', release, true)")
  })
})

// The first jsdom style resolution is slow on a loaded machine; the drags themselves are instant.
describe('the carousel touch driver on pinned rows', { timeout: 20_000 }, () => {
  let cleanups: Array<() => void> = []
  afterEach(() => {
    for (const cleanup of cleanups) cleanup()
    cleanups = []
    gameMode.set(false)
    isWindows.set(true)
    document.body.innerHTML = ''
  })

  // jsdom has no layout: give the row a writable scrollLeft and the overflow the stylesheet would.
  function row(overflowX: 'hidden' | 'scroll') {
    const node = document.createElement('div')
    node.style.overflowX = overflowX
    let left = 0
    Object.defineProperty(node, 'scrollLeft', { configurable: true, get: () => left, set: (value: number) => { left = value } })
    node.appendChild(document.createElement('a'))
    document.body.appendChild(node)
    return node
  }
  const attach = (node: HTMLElement, ...actions: Array<(node: HTMLElement) => { destroy(): void }>) => {
    for (const action of actions) { const handle = action(node); cleanups.push(() => handle.destroy()) }
  }
  function drag(node: HTMLElement, pointerType: string, dx: number, dy: number) {
    const target = node.firstElementChild!
    const init = { bubbles: true, cancelable: true, pointerId: 7, pointerType, button: 0, buttons: 1 }
    target.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: 200, clientY: 100 }))
    let cancelled = false
    for (let step = 1; step <= 4; step++) {
      target.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: 200 + (dx * step) / 4, clientY: 100 + (dy * step) / 4 }))
      const touch = new TouchEvent('touchmove', { bubbles: true, cancelable: true })
      target.dispatchEvent(touch)
      cancelled ||= touch.defaultPrevented
    }
    target.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientX: 200 + dx, clientY: 100 + dy }))
    return { left: node.scrollLeft, cancelled }
  }

  it('drags a pinned row sideways with a finger or pen outside Game mode', () => {
    const node = row('hidden')
    attach(node, dragScroll, gameModeCarouselTouch)
    expect(drag(node, 'touch', -120, 6).left).toBe(120)
    node.scrollLeft = 0
    expect(drag(node, 'pen', -90, 0).left).toBe(90)
  })

  it('leaves a vertical finger drag to the page', () => {
    const node = row('hidden')
    attach(node, dragScroll, gameModeCarouselTouch)
    expect(drag(node, 'touch', -20, -160).left).toBe(0)
  })

  it('leaves the mouse with dragScroll and a finger on a pinned row with the driver', () => {
    const node = row('hidden')
    attach(node, gameModeCarouselTouch)
    expect(drag(node, 'mouse', -120, 0).left).toBe(0)
    const mouseRow = row('hidden')
    attach(mouseRow, dragScroll)
    expect(drag(mouseRow, 'mouse', -120, 0).left).toBe(120)
    expect(drag(mouseRow, 'touch', -60, 0).left).toBe(120)
  })

  it('leaves a phone row, which stays a native scroller, to the browser', () => {
    const node = row('scroll')
    attach(node, gameModeCarouselTouch)
    expect(drag(node, 'touch', -120, 0).left).toBe(0)
  })

  it('still drives every pointer in Game mode', () => {
    gameMode.set(true)
    const node = row('hidden')
    attach(node, gameModeCarouselTouch)
    expect(drag(node, 'mouse', -120, 0).left).toBe(120)
  })

  it('cancels the touch sequence of a horizontal drag only where touch-action is ignored (Linux)', () => {
    const windows = row('hidden')
    attach(windows, gameModeCarouselTouch)
    expect(drag(windows, 'touch', -120, 0).cancelled).toBe(false)
    isWindows.set(false)
    const linux = row('hidden')
    attach(linux, gameModeCarouselTouch)
    expect(drag(linux, 'touch', -120, 0)).toEqual({ left: 120, cancelled: true })
    expect(drag(linux, 'touch', 0, -120).cancelled).toBe(false)
  })
})
