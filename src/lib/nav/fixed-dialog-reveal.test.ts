// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initDpadNav } from './index'
import { oskOpen } from '$lib/player/session'

// Dialogs and the on-screen keyboard are fixed to the viewport. Revealing a control near a screen
// edge used to scroll the window, which cannot move a fixed control at all: it scrolled the page
// underneath (and the list editor popover, which follows its anchor on scroll, moved with it),
// while a row below the fold of the dialog's own scrolling body was never revealed.

// jsdom has no layout: rects come from `data-rect` (left,top,width,height) and a scroller's
// vertical extent from `data-scroll` (clientHeight,scrollHeight). Position and overflow are inline
// styles, which jsdom's getComputedStyle reads.
function rectOf(this: Element): DOMRect {
  const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}
const extent = (node: Element, index: number) => Number((node.getAttribute('data-scroll') ?? '0,0').split(',')[index])

const paneScrolls: Array<{ el: Element; options: ScrollToOptions }> = []
let windowScrollBy: ReturnType<typeof vi.fn>
let windowScrollTo: ReturnType<typeof vi.fn>

const el = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-focusable]')].find((node) => node.textContent?.trim() === label)!
const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

// A long page behind every dialog, scrolled part-way, so a window scroll would visibly move it.
const page = `
  <main>
    ${Array.from({ length: 6 }, (_, row) => `<a href="/app/anime/${row}" data-focusable data-rect="80,${row * 150 + 60},120,130">Card ${row}</a>`).join('')}
  </main>`

beforeAll(() => {
  // The Deck's Game-mode viewport.
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return extent(this, 0) } })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return extent(this, 1) } })
  initDpadNav()
})

beforeEach(() => {
  Element.prototype.getBoundingClientRect = rectOf
  paneScrolls.length = 0
  HTMLElement.prototype.scrollBy = function (this: HTMLElement, options?: ScrollToOptions | number) {
    paneScrolls.push({ el: this, options: options as ScrollToOptions })
  } as HTMLElement['scrollBy']
  HTMLElement.prototype.scrollTo = function () {} as HTMLElement['scrollTo']
  windowScrollBy = vi.fn()
  windowScrollTo = vi.fn()
  window.scrollBy = windowScrollBy as unknown as typeof window.scrollBy
  window.scrollTo = windowScrollTo as unknown as typeof window.scrollTo
})

afterEach(() => { document.body.replaceChildren(); oskOpen.set(false) })

describe('d-pad reveal inside fixed dialogs', () => {
  it('leaves the page alone while walking the on-screen keyboard docked at the bottom', () => {
    const keys = ['q', 'w', 'e', 'r']
    // The keyboard's keys are nav targets only while it is open (focusable.ts).
    oskOpen.set(true)
    document.body.innerHTML = page + `
      <div data-osk data-nav-trap aria-label="On-screen keyboard" style="position: fixed; left: 0; right: 0; bottom: 0">
        ${[560, 612, 664, 716].map((top, row) => `<div>${keys.map((key, column) =>
          `<button data-focusable data-rect="${40 + column * 60},${top},52,44">${key}${row}</button>`).join('')}</div>`).join('')}
      </div>`
    el('w1').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('w2'))
    press('ArrowDown')
    expect(document.activeElement).toBe(el('w3'))
    // Left/Right at the keyboard's left edge would ask for a horizontal window scroll too.
    press('ArrowLeft')
    expect(document.activeElement).toBe(el('q3'))
    expect(windowScrollBy).not.toHaveBeenCalled()
    expect(windowScrollTo).not.toHaveBeenCalled()
    expect(paneScrolls).toEqual([])
  })

  it('reveals a list editor row by scrolling the editor body, not the page', () => {
    document.body.innerHTML = page + `
      <div data-nav-trap role="dialog" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0">
        <div style="position: absolute" data-rect="100,300,352,480">
          <div class="editor-body" style="overflow-y: auto" data-rect="100,340,352,380" data-scroll="380,640">
            ${[350, 400, 450, 500, 550, 600, 650, 700].map((top, index) =>
              `<button data-focusable data-rect="110,${top},330,40">Field ${index}</button>`).join('')}
          </div>
          <div data-rect="100,720,352,60"><button data-focusable data-rect="380,730,60,40">Save</button></div>
        </div>
      </div>`
    el('Field 5').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Field 6'))
    expect(windowScrollBy).not.toHaveBeenCalled()
    const body = document.querySelector('.editor-body')
    expect(paneScrolls).toHaveLength(1)
    expect(paneScrolls[0].el).toBe(body)
    // A single press keeps the smooth, visible carry.
    expect(paneScrolls[0].options).toMatchObject({ left: 0, behavior: 'smooth' })
    expect(paneScrolls[0].options.top).toBeGreaterThan(0)
  })

  it('does not scroll anything for a footer button of a fixed dialog', () => {
    document.body.innerHTML = page + `
      <div data-nav-trap role="dialog" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0">
        <div data-rect="100,300,352,480">
          <button data-focusable data-rect="110,680,330,40">Score</button>
          <div data-rect="100,720,352,60"><button data-focusable data-rect="110,730,330,40">Save</button></div>
        </div>
      </div>`
    el('Score').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Save'))
    expect(windowScrollBy).not.toHaveBeenCalled()
    expect(paneScrolls).toEqual([])
  })

  it('scrolls a full-screen dialog that is itself the scroller', () => {
    document.body.innerHTML = page + `
      <div class="switcher" data-nav-trap role="dialog" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; overflow-y: auto" data-rect="0,0,1280,800" data-scroll="800,1400">
        <button data-focusable data-rect="500,560,200,120">Profile A</button>
        <button data-focusable data-rect="500,700,200,120">Profile B</button>
      </div>`
    el('Profile A').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Profile B'))
    expect(windowScrollBy).not.toHaveBeenCalled()
    expect(paneScrolls.map((scroll) => scroll.el)).toEqual([document.querySelector('.switcher')])
  })

  it('still scrolls the page for an open menu that sits in the page (not fixed)', () => {
    document.body.innerHTML = `
      <main>
        <div data-nav-trap style="position: relative">
          <button data-focusable data-rect="300,600,200,40">Option 1</button>
          <button data-focusable data-rect="300,650,200,40">Option 2</button>
          <button data-focusable data-rect="300,700,200,40">Option 3</button>
        </div>
      </main>`
    el('Option 2').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Option 3'))
    expect(windowScrollBy).toHaveBeenCalledTimes(1)
    expect(paneScrolls).toEqual([])
  })

  it('still scrolls the page to reveal ordinary page content', () => {
    document.body.innerHTML = page
    el('Card 3').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Card 4'))
    expect(windowScrollBy).toHaveBeenCalledTimes(1)
  })
})
