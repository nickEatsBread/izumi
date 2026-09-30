// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusNearestFocusable, revealAboveKeyboard } from './index'
import { oskDismissedAt, oskOpen } from '$lib/player/session'
import { isNavigable } from './focusable'
import { OSK_ROOT_SELECTOR, activeNavTrap } from './traps'

// The on-screen keyboard's helpers in the nav engine (nav/index.ts). jsdom has no layout: rects
// come from `data-rect` (left,top,width,height) and a scroller's vertical extent from `data-scroll`
// (clientHeight,scrollHeight), as in fixed-dialog-reveal.test.ts. Position and overflow are inline
// styles, which jsdom's getComputedStyle reads.
function rectOf(this: Element): DOMRect {
  const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}
const extent = (node: Element, index: number) => Number((node.getAttribute('data-scroll') ?? '0,0').split(',')[index])
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const originalRect = Element.prototype.getBoundingClientRect
const paneScrolls: Array<{ el: Element; options: ScrollToOptions }> = []
let windowScrollBy: ReturnType<typeof vi.fn>

beforeEach(() => {
  Element.prototype.getBoundingClientRect = rectOf
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return extent(this, 0) } })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return extent(this, 1) } })
  paneScrolls.length = 0
  HTMLElement.prototype.scrollBy = function (this: HTMLElement, options?: ScrollToOptions | number) {
    paneScrolls.push({ el: this, options: options as ScrollToOptions })
  } as HTMLElement['scrollBy']
  windowScrollBy = vi.fn()
  window.scrollBy = windowScrollBy as unknown as typeof window.scrollBy
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect
  document.documentElement.removeAttribute('data-scroll')
  document.body.replaceChildren()
  document.body.removeAttribute('style')
})

describe('revealAboveKeyboard', () => {
  it('scrolls the window to lift a page field above the keyboard', () => {
    document.documentElement.setAttribute('data-scroll', '800,2000')
    document.body.innerHTML = '<input id="f" data-rect="100,700,300,40">'
    const undo = revealAboveKeyboard(byId('f'), 500)
    // Field bottom 740 + 16 px gap - keyboard top 500.
    expect(windowScrollBy).toHaveBeenCalledWith({ top: 256, left: 0, behavior: 'auto' })
    expect(paneScrolls).toEqual([])
    undo()
    expect(document.body.style.paddingBottom).toBe('')
  })

  it('pads the page when it cannot scroll far enough, and the undo removes the padding', () => {
    document.documentElement.setAttribute('data-scroll', '800,900')
    document.body.innerHTML = '<input id="f" data-rect="100,700,300,40">'
    const undo = revealAboveKeyboard(byId('f'), 500)
    // 256 px needed, 100 px of scroll left.
    expect(document.body.style.paddingBottom).toBe('156px')
    expect(windowScrollBy).toHaveBeenCalledWith({ top: 256, left: 0, behavior: 'auto' })
    undo()
    expect(document.body.style.paddingBottom).toBe('')
  })

  it("scrolls the field's own scroll container, not the window", () => {
    document.body.innerHTML = `
      <div id="pane" data-nav-scroll-container style="overflow-y: auto" data-rect="0,0,1280,800" data-scroll="800,1400">
        <input id="f" data-rect="100,700,300,40">
      </div>`
    revealAboveKeyboard(byId('f'), 500)
    expect(paneScrolls).toEqual([{ el: byId('pane'), options: { top: 256, left: 0, behavior: 'auto' } }])
    expect(windowScrollBy).not.toHaveBeenCalled()
    expect(byId('pane').style.paddingBottom).toBe('')
  })

  it('scrolls the scrolling body of a fixed dialog, padding it when it does not overflow yet', () => {
    document.body.innerHTML = `
      <div id="dialog" data-nav-trap style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; overflow-y: auto" data-rect="0,0,1280,800" data-scroll="800,800">
        <input id="f" data-rect="100,700,300,40">
      </div>`
    const undo = revealAboveKeyboard(byId('f'), 500)
    expect(byId('dialog').style.paddingBottom).toBe('256px')
    expect(paneScrolls).toEqual([{ el: byId('dialog'), options: { top: 256, left: 0, behavior: 'auto' } }])
    expect(windowScrollBy).not.toHaveBeenCalled()
    undo()
    expect(byId('dialog').style.paddingBottom).toBe('')
  })

  it('leaves a field already above the keyboard, or in a fixed layer that cannot scroll, alone', () => {
    document.body.innerHTML = `
      <input id="high" data-rect="100,200,300,40">
      <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0"><input id="stuck" data-rect="100,700,300,40"></div>`
    revealAboveKeyboard(byId('high'), 500)
    revealAboveKeyboard(byId('stuck'), 500)
    expect(windowScrollBy).not.toHaveBeenCalled()
    expect(paneScrolls).toEqual([])
  })

  it("never pushes a tall field's top out of its pane", () => {
    document.documentElement.setAttribute('data-scroll', '800,4000')
    document.body.innerHTML = '<textarea id="t" data-rect="100,100,600,640"></textarea>'
    revealAboveKeyboard(byId('t'), 500)
    // The overlap is 256, but the top may only rise to the 16 px gap: 100 - 16.
    expect(windowScrollBy).toHaveBeenCalledWith({ top: 84, left: 0, behavior: 'auto' })
  })
})

describe('focusNearestFocusable', () => {
  it('focuses the control nearest the rect, never a keyboard key', () => {
    document.body.innerHTML = `
      <button id="above" data-focusable data-rect="100,100,200,40">Above</button>
      <button id="far" data-focusable data-rect="100,500,200,40">Far</button>
      <div data-osk data-nav-trap><button id="key" data-focusable data-rect="100,210,200,40">q</button></div>`
    expect(focusNearestFocusable({ left: 100, top: 200, width: 200, height: 40 })).toBe(byId('above'))
    expect(document.activeElement).toBe(byId('above'))
  })

  it('stays inside the open dialog', () => {
    document.body.innerHTML = `
      <button id="page" data-focusable data-rect="100,220,200,40">Page</button>
      <div data-nav-trap role="dialog"><button id="inside" data-focusable data-rect="100,600,200,40">Inside</button></div>`
    expect(focusNearestFocusable({ left: 100, top: 200, width: 200, height: 40 })).toBe(byId('inside'))
  })

  it('returns null and moves nothing when no control is navigable', () => {
    document.body.innerHTML = '<button id="plain">Not marked</button>'
    expect(focusNearestFocusable({ left: 0, top: 0, width: 10, height: 10 })).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })
})

describe('the keyboard in the nav engine', () => {
  afterEach(() => oskOpen.set(false))

  it('its keys are nav targets only while it is open, so fading keys are never landed on', () => {
    document.body.innerHTML = '<div data-osk data-nav-trap><button id="key" data-focusable>q</button></div>'
    expect(isNavigable(byId('key'))).toBe(false)
    oskOpen.set(true)
    expect(isNavigable(byId('key'))).toBe(true)
  })

  it('only a [data-osk] root is the keyboard trap', () => {
    expect(OSK_ROOT_SELECTOR).toBe('[data-osk][data-nav-trap]')
    document.body.innerHTML = `
      <div id="dialog" data-nav-trap></div>
      <div id="legacy" data-nav-trap aria-label="On-screen keyboard"></div>
      <div id="osk" data-osk data-nav-trap></div>`
    oskOpen.set(true)
    expect(activeNavTrap()).toBe(byId('osk'))
    byId('osk').remove()
    expect(activeNavTrap()).toBe(byId('dialog'))
  })

  it('publishes when the pad last closed it, for the player to ignore that B edge', () => {
    expect(typeof oskDismissedAt.subscribe).toBe('function')
    let stamp = 0
    oskDismissedAt.subscribe((value) => { stamp = value })()
    expect(stamp).toBe(-1e9)
  })
})
