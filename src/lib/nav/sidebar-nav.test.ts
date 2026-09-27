// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initDpadNav } from './index'

// The side rail is fixed to the viewport. Walking it on a Deck ran the whole-page geometry search
// (measuring every card on the page, the stall the Home rows already avoid) and "revealed" its
// lower rows by smooth-scrolling the page underneath, which cannot move a fixed row at all.

// jsdom has no layout: every element reports the rect in its `data-rect` (left,top,width,height),
// and each measurement is recorded so the tests can see what a move had to lay out.
const measured: Element[] = []
function rectOf(this: Element): DOMRect {
  measured.push(this)
  const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

const rail = `
  <nav data-nav-sidebar data-slot="nav.side">
    <a href="/app/home" data-focusable data-rect="0,84,56,44">Home</a>
    <a href="/app/schedule" data-focusable data-rect="0,132,56,44">Schedule</a>
    <a href="/app/search" data-focusable data-rect="0,180,56,44">Search</a>
    <a href="/app/library" data-focusable data-rect="0,228,56,44">Library</a>
    <div data-rect="0,276,56,200"></div>
    <button data-focusable data-rect="0,480,56,44">Incognito</button>
    <a href="/app/settings" data-focusable data-rect="0,528,56,44">Settings</a>
    <button data-focusable data-rect="0,580,56,48">Account</button>
  </nav>`

const content = `
  <main>
    <div data-nav-row>
      <div data-nav-row-items>
        ${Array.from({ length: 12 }, (_, index) => `<a href="/app/anime/${index + 1}" data-focusable data-rect="${80 + index * 130},120,120,180">Card ${index + 1}</a>`).join('')}
      </div>
    </div>
    <div data-nav-row>
      <div data-nav-row-items>
        ${Array.from({ length: 12 }, (_, index) => `<a href="/app/anime/${index + 101}" data-focusable data-rect="${80 + index * 130},340,120,180">Card ${index + 101}</a>`).join('')}
      </div>
    </div>
  </main>`

const el = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-focusable]')].find((node) => node.textContent?.trim() === label)!
const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const contentMeasured = () => measured.filter((node) => node.closest('main'))

let scrollBy: ReturnType<typeof vi.fn>
let scrollTo: ReturnType<typeof vi.fn>

beforeAll(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 640 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  initDpadNav()
})

beforeEach(() => {
  Element.prototype.getBoundingClientRect = rectOf
  scrollBy = vi.fn()
  scrollTo = vi.fn()
  window.scrollBy = scrollBy as unknown as typeof window.scrollBy
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  document.body.innerHTML = rail + content
  measured.length = 0
})

afterEach(() => { document.body.replaceChildren() })

describe('d-pad through the side rail', () => {
  it('walks the rail without measuring the page behind it', () => {
    el('Home').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Schedule'))
    press('ArrowDown')
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Library'))
    press('ArrowUp')
    expect(document.activeElement).toBe(el('Search'))
    expect(contentMeasured()).toEqual([])
  })

  it('never scrolls the page for the rail rows near the bottom of the screen', () => {
    el('Library').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Incognito'))
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Settings'))
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Account'))
    press('ArrowUp')
    expect(document.activeElement).toBe(el('Settings'))
    expect(scrollBy).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('stops at either end of the rail', () => {
    el('Home').focus()
    press('ArrowUp')
    expect(document.activeElement).toBe(el('Home'))
    el('Account').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Account'))
  })

  it('does not scroll the page when Left from a row enters the rail', () => {
    el('Card 1').focus()
    press('ArrowLeft')
    expect(document.activeElement?.closest('[data-nav-sidebar]')).not.toBeNull()
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('still leaves the rail to the right, onto the page', () => {
    el('Schedule').focus()
    press('ArrowRight')
    expect(document.activeElement?.closest('main')).not.toBeNull()
  })

  it('keeps an open picker inside the rail confined to its own trap', () => {
    el('Home').insertAdjacentHTML('beforebegin', `
      <div data-nav-trap>
        <button data-focusable data-rect="0,40,56,40">AniList</button>
        <button data-focusable data-rect="0,300,220,40">Kitsu</button>
      </div>`)
    el('AniList').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Kitsu'))
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Kitsu'))
  })

  it('leaves a top bar to the spatial search, where Up and Down do not walk the bar', () => {
    document.body.innerHTML = `
      <nav data-nav-sidebar data-slot="nav.top">
        <a href="/app/home" data-focusable data-rect="100,30,40,40">Home</a>
        <a href="/app/schedule" data-focusable data-rect="150,30,40,40">Schedule</a>
      </nav>` + content
    el('Home').focus()
    press('ArrowDown')
    expect(document.activeElement).not.toBe(el('Schedule'))
  })
})
