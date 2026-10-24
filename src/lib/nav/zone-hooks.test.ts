// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTv } from '$lib/platform'
import { initDpadNav, pivotScrollDelta, resetNavLandingForTests, setNavMoveOwner } from './index'
import { dispatchPadKey, resetPadControlsForTests } from './pad-controls'

// Two generic engine hooks for controller Settings (spec §5.1-5.2): a surface that owns some arrow
// moves, and a scroller that keeps its focused row at a fixed height (NuvioTV's 42% pivot).

function rectOf(this: Element): DOMRect {
  const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}
const el = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-focusable]')]
  .find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === label)!
const press = (key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  return event
}
const scrolls: Array<{ el: Element; options: ScrollToOptions }> = []

beforeAll(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 540 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 960 })
  initDpadNav()
})

beforeEach(() => {
  Element.prototype.getBoundingClientRect = rectOf
  scrolls.length = 0
  HTMLElement.prototype.scrollBy = function (this: HTMLElement, options?: ScrollToOptions | number) {
    scrolls.push({ el: this, options: options as ScrollToOptions })
  } as HTMLElement['scrollBy']
  HTMLElement.prototype.scrollTo = function () {} as HTMLElement['scrollTo']
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  resetNavLandingForTests()
  resetPadControlsForTests()
  isTv.set(false)
})

afterEach(() => document.body.replaceChildren())

describe('pivotScrollDelta', () => {
  const port = { portStart: 0, portEnd: 500, pivot: 0.42 }
  it('moves the item centre to the pivot height', () => {
    expect(pivotScrollDelta({ ...port, itemStart: 380, itemEnd: 430 })).toBe(195)
    expect(pivotScrollDelta({ ...port, itemStart: 600, itemEnd: 650 })).toBe(415)
    expect(pivotScrollDelta({ ...port, itemStart: -40, itemEnd: 10 })).toBe(-225)
  })
  it('skips a shift under 12 px while the item is fully in view, never for a clipped one', () => {
    expect(pivotScrollDelta({ ...port, itemStart: 205, itemEnd: 225 })).toBe(0)
    // 495-515 is clipped by the 500 px port, so its 10 px shift is kept.
    expect(pivotScrollDelta({ ...port, itemStart: 495, itemEnd: 515, pivot: 0.99 })).toBe(10)
  })
})

describe('data-nav-scroll-pivot', () => {
  it('keeps the focused row centre at 42% of the scroller on a vertical move', () => {
    document.body.innerHTML = `
      <div data-nav-scroll-container data-nav-scroll-pivot="0.42" data-rect="240,0,600,500">
        <button data-focusable data-rect="260,40,500,50">First row</button>
        <button data-focusable data-rect="260,380,500,50">Second row</button>
      </div>`
    const pane = document.querySelector('[data-nav-scroll-container]')!
    el('First row').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Second row'))
    expect(scrolls).toEqual([{ el: pane, options: { top: 195, left: 0, behavior: 'smooth' } }])
  })
})

describe('setNavMoveOwner', () => {
  const page = (trap = false) => `
    <main ${trap ? 'data-nav-trap' : ''}>
      <button data-focusable data-rect="40,40,200,40">Start</button>
      <button data-focusable data-rect="300,40,200,40">Beside</button>
      <button data-focusable data-rect="40,400,200,40">Far</button>
      <input data-focusable aria-label="Slider" type="range" min="0" max="10" step="1" value="5" data-rect="40,200,200,24">
    </main>`
  let stop: () => void = () => {}
  afterEach(() => stop())

  it('focuses the element the owner returns', () => {
    document.body.innerHTML = page()
    stop = setNavMoveOwner((active, dir) => (dir === 'right' && active === el('Start') ? el('Far') : undefined))
    el('Start').focus()
    const event = press('ArrowRight')
    expect(document.activeElement).toBe(el('Far'))
    expect(event.defaultPrevented).toBe(true)
  })

  it('swallows the press when the owner returns null', () => {
    document.body.innerHTML = page()
    stop = setNavMoveOwner(() => null)
    el('Start').focus()
    expect(press('ArrowRight').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(el('Start'))
  })

  it('leaves the move to the engine on undefined, and once removed', () => {
    document.body.innerHTML = page()
    stop = setNavMoveOwner(() => undefined)
    el('Start').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(el('Beside'))
    stop()
    stop = setNavMoveOwner(() => el('Far'))
    stop()
    el('Start').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(el('Beside'))
  })

  it('is never asked inside a trap', () => {
    document.body.innerHTML = page(true)
    stop = setNavMoveOwner(() => el('Far'))
    el('Start').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(el('Beside'))
  })

  it('comes after the slider step, so Left/Right still step a focused slider', () => {
    document.body.innerHTML = page()
    stop = setNavMoveOwner(() => el('Far'))
    const slider = el('Slider') as HTMLInputElement
    slider.focus()
    dispatchPadKey('ArrowRight')
    expect(document.activeElement).toBe(slider)
    expect(slider.value).toBe('6')
  })
})
