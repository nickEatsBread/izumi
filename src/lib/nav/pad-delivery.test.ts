// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initDpadNav } from './index'
import { PAD_KEY, dispatchPadKey, isPadEvent } from './pad-controls'
import { isNavigable } from './focusable'
import { controllerMode, inputType } from './input'
import { gameMode, playing } from '$lib/player/session'
import { isTv } from '$lib/platform'

// How controller keys reach the nav engine. The gamepad router dispatches marked keydowns on window
// (dispatchPadKey), and the nav engine walks only controls a pad can actually use.

// jsdom has no layout: every element reports the rect in its `data-rect` (left,top,width,height).
function rectOf(this: Element): DOMRect {
  const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

/** The [data-focusable] whose aria-label (else trimmed text) is `label`. */
const el = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-focusable]')]
    .find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === label)!

/** A keydown that carries the pad mark but is aimed at an element (real pad keys go to window). */
const markedKeyAt = (target: EventTarget, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  Object.defineProperty(event, PAD_KEY, { value: true })
  target.dispatchEvent(event)
  return event
}

beforeAll(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  initDpadNav()
})

beforeEach(() => {
  Element.prototype.getBoundingClientRect = rectOf
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  HTMLElement.prototype.scrollBy = vi.fn() as unknown as HTMLElement['scrollBy']
  HTMLElement.prototype.scrollTo = vi.fn() as unknown as HTMLElement['scrollTo']
  isTv.set(false)
  gameMode.set(false)
  controllerMode.set(false)
  playing.set(false)
  inputType.set('mouse')
})

afterEach(() => { document.body.replaceChildren() })

describe('dispatchPadKey', () => {
  it('dispatches one marked, cancelable, bubbling keydown on window and returns it', () => {
    const seen: KeyboardEvent[] = []
    const reachedAt: Array<EventTarget | null> = []
    const listener = (event: KeyboardEvent) => { seen.push(event); reachedAt.push(event.currentTarget) }
    window.addEventListener('keydown', listener)
    try {
      const plain = dispatchPadKey('d')
      const held = dispatchPadKey('ArrowDown', { repeat: true })
      expect(seen).toHaveLength(2)
      expect(seen[0]).toBe(plain)
      expect(seen[1]).toBe(held)
      // Aimed at the window object itself, never at a node. No identity check against `window` or
      // `document.defaultView`: vitest's jsdom environment points both at globalThis, while
      // `window.dispatchEvent` is bound to the real jsdom Window, so the target is that jsdom Window
      // and equals neither (in a browser all three are one object). What holds in both worlds: the
      // target exists, is not a Node, and the window listener met the event at the target itself,
      // not while it bubbled up from an element. currentTarget is recorded inside the listener
      // because it is reset to null once dispatch returns.
      expect(plain.target).toBeTruthy()
      expect(plain.target instanceof Node).toBe(false)
      expect(reachedAt[0]).toBe(plain.target)
      expect(reachedAt[1]).toBe(held.target)
      expect(plain.type).toBe('keydown')
      expect(plain.key).toBe('d')
      expect(plain.bubbles).toBe(true)
      expect(plain.cancelable).toBe(true)
      expect(plain.repeat).toBe(false)
      expect(held.repeat).toBe(true)
      expect(isPadEvent(plain)).toBe(true)
      expect(isPadEvent(held)).toBe(true)
    } finally {
      window.removeEventListener('keydown', listener)
    }
  })

  it('never marks an ordinary keydown', () => {
    const typed = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    window.dispatchEvent(typed)
    expect(isPadEvent(typed)).toBe(false)
  })
})

describe('navigable controls', () => {
  it('skips disabled selects, inputs, textareas and controls in a disabled fieldset', () => {
    document.body.innerHTML = `
      <main>
        <button data-focusable data-rect="100,100,200,40">Top</button>
        <select data-focusable disabled aria-label="Quality" data-rect="100,160,200,40"><option>1080p</option></select>
        <input data-focusable disabled aria-label="Seek" data-rect="100,220,200,40">
        <textarea data-focusable disabled aria-label="Notes" data-rect="100,280,200,40"></textarea>
        <fieldset disabled><button data-focusable data-rect="100,340,200,40">Locked</button></fieldset>
        <button data-focusable data-rect="100,400,200,40">Bottom</button>
      </main>`
    el('Top').focus()
    dispatchPadKey('ArrowDown')
    expect(document.activeElement).toBe(el('Bottom'))
    dispatchPadKey('ArrowUp')
    expect(document.activeElement).toBe(el('Top'))
  })

  it('skips controls inside an inert subtree', () => {
    document.body.innerHTML = `
      <main>
        <button data-focusable data-rect="100,100,200,40">Move up</button>
        <div inert><a href="/app/anime/1" data-focusable data-rect="100,160,200,40">Preview card</a></div>
        <button data-focusable data-rect="100,220,200,40">Next section</button>
      </main>`
    el('Move up').focus()
    dispatchPadKey('ArrowDown')
    expect(document.activeElement).toBe(el('Next section'))
  })

  it('steps over an inert row on the Game-mode row fast path', () => {
    gameMode.set(true)
    document.body.innerHTML = `
      <main>
        <section data-nav-row data-rect="0,100,1280,200">
          <div data-nav-row-items data-rect="80,100,1200,200">
            <a href="/app/anime/1" data-focusable data-rect="80,110,120,180">Row one card</a>
          </div>
        </section>
        <div inert>
          <section data-nav-row data-rect="0,320,1280,200">
            <div data-nav-row-items data-rect="80,320,1200,200">
              <a href="/app/anime/2" data-focusable data-rect="80,330,120,180">Preview row card</a>
            </div>
          </section>
        </div>
        <section data-nav-row data-rect="0,540,1280,200">
          <div data-nav-row-items data-rect="80,540,1200,200">
            <a href="/app/anime/3" data-focusable data-rect="80,550,120,180">Row three card</a>
          </div>
        </section>
      </main>`
    el('Row one card').focus()
    dispatchPadKey('ArrowDown')
    expect(document.activeElement).toBe(el('Row three card'))
  })
})

describe('isNavigable', () => {
  it('accepts only visible, tabbable, enabled controls outside inert subtrees', () => {
    document.body.innerHTML = `
      <button id="ok">Ok</button>
      <button id="disabled" disabled>Disabled</button>
      <select id="select" disabled><option>1</option></select>
      <fieldset disabled><input id="fieldset"></fieldset>
      <div inert><button id="inert">Inert</button></div>
      <button id="hidden" aria-hidden="true">Hidden</button>
      <button id="untabbable" tabindex="-1">Untabbable</button>
      <div id="plain" data-focusable>Plain div</div>`
    const byId = (id: string) => document.getElementById(id)!
    expect(isNavigable(byId('ok'))).toBe(true)
    for (const id of ['disabled', 'select', 'fieldset', 'inert', 'hidden', 'untabbable', 'plain']) {
      expect(isNavigable(byId(id)), id).toBe(false)
    }
  })
})

describe('pad arrows and text fields', () => {
  const fieldRow = `
    <main>
      <input type="text" aria-label="Name" data-focusable data-rect="100,100,300,40">
      <button data-focusable data-rect="440,100,120,40">Save</button>
    </main>`

  it('moves off a focused text field on a pad arrow, even one aimed at the field', () => {
    document.body.innerHTML = fieldRow
    el('Name').focus()
    const pad = markedKeyAt(el('Name'), 'ArrowRight')
    expect(document.activeElement).toBe(el('Save'))
    expect(pad.defaultPrevented).toBe(true)
  })

  it('leaves Left/Right to the caret for an unmarked key', () => {
    document.body.innerHTML = fieldRow
    el('Name').focus()
    const typed = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    el('Name').dispatchEvent(typed)
    expect(document.activeElement).toBe(el('Name'))
    expect(typed.defaultPrevented).toBe(false)
  })
})

describe('initDpadNav re-run (Vite HMR)', () => {
  it('replaces its keydown handler, so one press still moves one step', () => {
    initDpadNav()
    document.body.innerHTML = `
      <main>
        <button data-focusable data-rect="100,100,200,40">One</button>
        <button data-focusable data-rect="100,160,200,40">Two</button>
        <button data-focusable data-rect="100,220,200,40">Three</button>
      </main>`
    el('One').focus()
    dispatchPadKey('ArrowDown')
    expect(document.activeElement).toBe(el('Two'))
  })
})
