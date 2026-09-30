// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTv } from '$lib/platform'
import { deadEndScrollDelta, initDpadNav, regionOf } from './index'
import { dispatchPadKey } from './pad-controls'

// Settings on the Deck (spec §3.4, §4). The category rail is its own nav region, so the end of a
// page never drops into it and Left lands on the current category; a tap on a rail link brings the
// first press back to the rail instead of its Search button; horizontal strips, a capped list
// inside the page and text-only dead ends scroll the right thing.

// jsdom has no layout: rects come from `data-rect` (left,top,width,height) and a scroller's
// vertical extent from `data-scroll` (clientHeight,scrollHeight).
function rectOf(this: Element): DOMRect {
  const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}
const extent = (node: Element, index: number) => Number((node.getAttribute('data-scroll') ?? '0,0').split(',')[index])

const paneScrolls: Array<{ el: Element; options: ScrollToOptions }> = []
let windowScrollBy: ReturnType<typeof vi.fn>

const el = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-focusable]')].find((node) => node.textContent?.trim() === label)!
const press = (key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  return event
}
const tap = (node: Element) => node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
const blur = () => (document.activeElement as HTMLElement | null)?.blur()

const appSidebar = `
  <nav data-nav-sidebar data-slot="nav.side">
    <a href="/app/home" data-focusable data-rect="0,100,56,44">Home</a>
    <a href="/app/settings" data-focusable data-rect="0,160,56,44">Settings</a>
  </nav>`

// The desktop Settings rail: the Search button above the categories, Sources is the current one.
const settingsRail = `
  <aside data-nav-region="settings">
    <button data-focusable data-rect="72,70,200,40">Search settings</button>
    <nav data-nav-scroll-container>
      <a href="/app/settings/player" data-focusable data-rect="72,130,200,36">Player</a>
      <a href="/app/settings/subtitles" data-focusable data-rect="72,170,200,36">Subtitles</a>
      <a href="/app/settings/sources" data-focusable data-nav-region-default aria-current="page" data-rect="72,210,200,36">Sources</a>
      <a href="/app/settings/downloads" data-focusable data-rect="72,250,200,36">Downloads</a>
      <a href="/app/settings/about" data-focusable data-rect="72,290,200,36">About</a>
    </nav>
  </aside>`

// A short page: its last control sits above the lower rail links, where a cone-less Down used to
// fall into the rail.
const shortPage = `
  <div data-nav-surface="settings">
    <button data-focusable data-rect="320,80,400,48">Add source</button>
    <button data-focusable data-rect="320,140,400,48">Refresh sources</button>
  </div>`

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
  window.scrollBy = windowScrollBy as unknown as typeof window.scrollBy
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  isTv.set(false)
  // Forget the region of the previous test's last focus or tap.
  tap(document.body)
})

afterEach(() => { document.body.replaceChildren() })

describe('nav regions', () => {
  it('names the region of an element: the sidebar, a data-nav-region, or null for the page', () => {
    document.body.innerHTML = appSidebar + settingsRail + shortPage
    expect(regionOf(el('Home'))).toBe(document.querySelector('[data-nav-sidebar]'))
    expect(regionOf(el('Player'))).toBe(document.querySelector('[data-nav-region="settings"]'))
    expect(regionOf(el('Add source'))).toBeNull()
    expect(regionOf(null)).toBeNull()
  })

  it('never drops from the end of a settings page into the rail', () => {
    document.body.innerHTML = appSidebar + settingsRail + shortPage
    el('Refresh sources').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Refresh sources'))
  })

  it('walks the rail inside itself and stops at its ends', () => {
    document.body.innerHTML = appSidebar + settingsRail + shortPage
    el('Sources').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Downloads'))
    press('ArrowDown')
    press('ArrowDown')
    expect(document.activeElement).toBe(el('About'))
    el('Player').focus()
    press('ArrowUp')
    expect(document.activeElement).toBe(el('Search settings'))
  })

  it('lands Left on the current category and Right back on the page', () => {
    document.body.innerHTML = appSidebar + settingsRail + shortPage
    el('Refresh sources').focus()
    press('ArrowLeft')
    expect(document.activeElement).toBe(el('Sources'))
    press('ArrowRight')
    expect(document.activeElement).toBe(el('Refresh sources'))
  })

  it('still crosses from the rail into the app sidebar', () => {
    document.body.innerHTML = appSidebar + settingsRail + shortPage
    el('Player').focus()
    press('ArrowLeft')
    expect(document.activeElement?.closest('[data-nav-sidebar]')).not.toBeNull()
  })

  it('keeps Theme Studio moves inside the panel instead of the page under it', () => {
    document.body.innerHTML = `
      <aside data-nav-region="theme-studio">
        <button data-focusable data-rect="80,300,100,40">Colours</button>
        <button data-focusable data-rect="80,360,300,40">Brand accent</button>
      </aside>
      <main><button data-focusable data-rect="500,420,300,48">Page control</button></main>`
    el('Brand accent').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Brand accent'))
    press('ArrowUp')
    expect(document.activeElement).toBe(el('Colours'))
  })
})

describe('first press with nothing focused (body fallback step 3)', () => {
  it('returns to the current category after a tap on a rail link', () => {
    document.body.innerHTML = appSidebar + settingsRail + shortPage
    el('Add source').focus()
    tap(el('Subtitles'))
    blur()
    expect(document.activeElement).toBe(document.body)
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Sources'))
  })

  it('lands on the page, not the rail Search button, after a tap on the page', () => {
    document.body.innerHTML = appSidebar + settingsRail + shortPage
    el('Sources').focus()
    tap(el('Refresh sources'))
    blur()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Add source'))
  })

  it('keeps the page-first landing after the app sidebar', () => {
    document.body.innerHTML = appSidebar + settingsRail + shortPage
    el('Home').focus()
    tap(el('Home'))
    blur()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Add source'))
  })
})

describe('scroll helpers', () => {
  it('scrolls a horizontal strip (data-nav-scroll-x) itself, not the window', () => {
    document.body.innerHTML = `
      <div data-nav-surface="settings">
        <nav data-nav-scroll-x data-rect="320,300,300,48">
          <button data-focusable data-rect="320,300,110,48">Connections</button>
          <button data-focusable data-rect="440,300,110,48">Lists</button>
          <button data-focusable data-rect="560,300,110,48">Behaviour</button>
          <button data-focusable data-rect="680,300,110,48">Advanced</button>
        </nav>
      </div>`
    el('Behaviour').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(el('Advanced'))
    expect(paneScrolls.map((scroll) => scroll.el)).toEqual([document.querySelector('[data-nav-scroll-x]')])
    expect(paneScrolls[0].options).toMatchObject({ top: 0, left: 224 })
    expect(windowScrollBy).not.toHaveBeenCalled()
  })

  const packageList = (marker: string) => `
    <div data-nav-surface="settings">
      <ul ${marker} data-rect="320,500,400,600">
        ${[520, 580, 640, 700, 760, 820].map((top, index) => `<li><button data-focusable data-rect="360,${top},320,40">Package ${index + 1}</button></li>`).join('')}
      </ul>
    </div>`

  it('reveals an item of a nested scroller through the window when the list runs below the fold', () => {
    document.body.innerHTML = packageList('data-nav-scroll-container="nested"')
    el('Package 5').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Package 6'))
    expect(windowScrollBy).toHaveBeenCalledTimes(1)
    expect(windowScrollBy.mock.calls[0][0]).toMatchObject({ top: 204 })
  })

  it('leaves an ordinary scroll container to itself (no window pass)', () => {
    document.body.innerHTML = packageList('data-nav-scroll-container')
    el('Package 5').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Package 6'))
    expect(windowScrollBy).not.toHaveBeenCalled()
  })
})

describe('dead-end scroll', () => {
  it('computes a step of 40% of the port, clamped so the item stays in view', () => {
    expect(deadEndScrollDelta({ itemStart: 600, itemEnd: 648, portStart: 0, portEnd: 800, direction: 1 })).toBe(320)
    expect(deadEndScrollDelta({ itemStart: 120, itemEnd: 168, portStart: 0, portEnd: 800, direction: 1 })).toBe(120)
    expect(deadEndScrollDelta({ itemStart: 0, itemEnd: 48, portStart: 0, portEnd: 800, direction: 1 })).toBe(0)
    expect(deadEndScrollDelta({ itemStart: 100, itemEnd: 148, portStart: 0, portEnd: 800, direction: -1 })).toBe(-320)
    expect(deadEndScrollDelta({ itemStart: 700, itemEnd: 760, portStart: 0, portEnd: 800, direction: -1 })).toBe(-40)
    expect(deadEndScrollDelta({ itemStart: 750, itemEnd: 800, portStart: 0, portEnd: 800, direction: -1 })).toBe(0)
  })

  const page = (top: number) => `
    <div data-nav-surface="settings">
      <button data-focusable data-rect="320,${Math.max(0, top - 300)},400,48">Earlier</button>
      <button data-focusable data-rect="320,${top},400,48">Last</button>
    </div>`

  it('scrolls the page along on a pad Down past the last control', () => {
    document.body.innerHTML = page(600)
    el('Last').focus()
    const event = dispatchPadKey('ArrowDown')
    expect(document.activeElement).toBe(el('Last'))
    expect(event.defaultPrevented).toBe(true)
    expect(windowScrollBy).toHaveBeenCalledTimes(1)
    expect(windowScrollBy.mock.calls[0][0]).toMatchObject({ top: 320 })
  })

  it('never scrolls the focused control out of view', () => {
    document.body.innerHTML = page(120)
    el('Last').focus()
    dispatchPadKey('ArrowDown')
    expect(windowScrollBy.mock.calls[0][0]).toMatchObject({ top: 120 })
    windowScrollBy.mockClear()
    document.body.innerHTML = page(0)
    el('Last').focus()
    const event = dispatchPadKey('ArrowDown')
    expect(windowScrollBy).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('scrolls back up on a pad Up past the first control', () => {
    document.body.innerHTML = page(600)
    el('Earlier').focus()
    dispatchPadKey('ArrowUp')
    expect(windowScrollBy.mock.calls[0][0]).toMatchObject({ top: -320 })
  })

  it('is controller-only, off TV, and only inside a settings surface', () => {
    document.body.innerHTML = page(600)
    el('Last').focus()
    press('ArrowDown')
    expect(windowScrollBy).not.toHaveBeenCalled()
    isTv.set(true)
    dispatchPadKey('ArrowDown')
    expect(windowScrollBy).not.toHaveBeenCalled()
    isTv.set(false)
    document.body.innerHTML = `<main><button data-focusable data-rect="320,600,400,48">Last</button></main>`
    el('Last').focus()
    dispatchPadKey('ArrowDown')
    expect(windowScrollBy).not.toHaveBeenCalled()
  })

  it('scrolls the body of an open <dialog>', () => {
    document.body.innerHTML = `
      <dialog open data-rect="200,100,600,600">
        <div style="overflow-y: auto" data-scroll="500,900" data-rect="200,150,600,500">
          <button data-focusable data-rect="220,200,200,40">First in dialog</button>
          <button data-focusable data-rect="220,560,200,40">Last in dialog</button>
        </div>
      </dialog>`
    el('Last in dialog').focus()
    dispatchPadKey('ArrowDown')
    expect(document.activeElement).toBe(el('Last in dialog'))
    expect(paneScrolls).toHaveLength(1)
    expect(paneScrolls[0].el).toBe(document.querySelector('dialog > div'))
    expect(paneScrolls[0].options).toMatchObject({ top: 200 })
    expect(windowScrollBy).not.toHaveBeenCalled()
  })

  it('never scrolls the page behind a fixed modal that is not a native <dialog>', () => {
    // The add-on configurator: a position:fixed overlay with no scrolling body, rendered inline
    // inside the Sources page, so inside the settings surface.
    document.body.innerHTML = `
      <div data-nav-surface="settings">
        <div data-nav-trap style="position: fixed; top: 0; left: 0; right: 0; bottom: 0">
          <button data-focusable data-rect="320,300,200,40">First</button>
          <button data-focusable data-rect="320,600,200,40">Last</button>
        </div>
      </div>`
    el('Last').focus()
    const event = dispatchPadKey('ArrowDown')
    expect(document.activeElement).toBe(el('Last'))
    expect(windowScrollBy).not.toHaveBeenCalled()
    expect(paneScrolls).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    // Nor a page scroller the overlay happens to sit inside: it is behind the modal too.
    document.body.innerHTML = `
      <div data-nav-surface="settings">
        <div data-nav-scroll-container style="overflow-y: auto" data-rect="300,0,700,800" data-scroll="800,2000">
          <div data-nav-trap style="position: fixed; top: 0; left: 0; right: 0; bottom: 0">
            <button data-focusable data-rect="320,300,200,40">First</button>
            <button data-focusable data-rect="320,600,200,40">Last</button>
          </div>
        </div>
      </div>`
    el('Last').focus()
    const inside = dispatchPadKey('ArrowDown')
    expect(document.activeElement).toBe(el('Last'))
    expect(windowScrollBy).not.toHaveBeenCalled()
    expect(paneScrolls).toEqual([])
    expect(inside.defaultPrevented).toBe(false)
  })
})
