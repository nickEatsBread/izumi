// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { gameMode } from '$lib/player/session'
import { initDpadNav } from './index'

// Left or Right past a row's first or last card. An anchored row (a TV theme's Netflix-style rows)
// slides its earlier cards off the left edge, so the old geometric fallback picked one of another
// row's hidden cards and focus seemed to vanish. The press may only cross into a region beside the row.

function rectOf(this: Element): DOMRect {
  const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

// The row above is slid: its first three cards sit off screen to the left.
const rows = `
  <main>
    <section data-nav-row>
      <div data-nav-row-items>
        ${Array.from({ length: 8 }, (_, i) => `<a href="#" data-focusable data-rect="${-420 + i * 140},60,120,200">Above ${i + 1}</a>`).join('')}
      </div>
    </section>
    <section data-nav-row>
      <div data-nav-row-items>
        ${Array.from({ length: 8 }, (_, i) => `<a href="#" data-focusable data-rect="${120 + i * 140},330,${i === 0 ? 480 : 120},200">Row ${i + 1}</a>`).join('')}
      </div>
    </section>
  </main>`

const topBar = `
  <nav data-nav-sidebar data-slot="nav.top" data-rect="0,0,1024,50">
    <a href="#" data-focusable data-rect="40,10,30,30">Sign in</a>
    <a href="#" data-focusable data-rect="300,10,80,30">Home</a>
  </nav>`

const sideRail = `
  <nav data-nav-sidebar data-slot="nav.side" data-rect="0,0,56,640">
    <a href="#" data-focusable data-rect="0,100,56,44">Rail Home</a>
    <a href="#" data-focusable data-rect="0,150,56,44">Rail Search</a>
  </nav>`

const el = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-focusable]')].find((node) => node.textContent?.trim() === label)!
const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

beforeAll(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 640 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  initDpadNav()
})
beforeEach(() => {
  gameMode.set(true)
  Element.prototype.getBoundingClientRect = rectOf
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})
afterEach(() => { document.body.replaceChildren() })
afterAll(() => gameMode.set(false))

describe('Left and Right past the end of a row', () => {
  it('stays on the first card under a top bar instead of jumping into another row or up into the bar', () => {
    document.body.innerHTML = topBar + rows
    el('Row 1').focus()
    press('ArrowLeft')
    expect(document.activeElement).toBe(el('Row 1'))
  })

  it('still enters a side rail beside the row', () => {
    document.body.innerHTML = sideRail + rows
    el('Row 1').focus()
    press('ArrowLeft')
    expect(document.activeElement?.closest('[data-nav-sidebar]')).not.toBeNull()
  })

  it('stays on the last card at the row’s other end', () => {
    document.body.innerHTML = topBar + rows
    el('Row 8').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(el('Row 8'))
  })

  it('keeps stepping card to card inside the row', () => {
    document.body.innerHTML = topBar + rows
    el('Row 2').focus()
    press('ArrowLeft')
    expect(document.activeElement).toBe(el('Row 1'))
  })
})
