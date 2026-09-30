// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initDpadNav } from './index'
import { PAD_KEY, dispatchPadKey, isPadEvent, padAdjust, resetPadControlsForTests } from './pad-controls'
import { isNavigable, isRovingTab } from './focusable'
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

describe('pad sliders and roving tabs (commit 4)', () => {
  // jsdom has no layout: rects come from `data-rect` (left,top,width,height), as in
  // fixed-dialog-reveal.test.ts. Every helper lives inside this block so it cannot collide with the
  // helpers the earlier commits declared at the top of this file.
  const rectOf = function (this: Element): DOMRect {
    const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
  }
  const byLabel = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-focusable]')]
    .find((node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === label)!
  /** A keyboard-style arrow: dispatched at the element, bubbling to window, not pad-marked. */
  const keyboard = (target: Element, key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }
  const record = (el: Element) => {
    const events: string[] = []
    el.addEventListener('input', () => events.push('input'))
    el.addEventListener('change', () => events.push('change'))
    return events
  }
  const sliderPage = (attributes: string) => `
    <main>
      <button data-focusable data-rect="40,40,200,40">Above</button>
      <input data-focusable aria-label="Slider" type="range" ${attributes} data-rect="40,120,200,24">
      <button data-focusable data-rect="300,120,120,40">Beside</button>
      <button data-focusable data-rect="40,200,200,40">Below</button>
    </main>`
  // Sources (sources/+page.svelte:324-336): one tab stop, the inactive tabs parked at tabindex -1.
  const tabsPage = `
    <main>
      <button data-focusable data-rect="40,20,200,40">Check for Updates</button>
      <div role="tablist" aria-label="Source settings">
        <button type="button" role="tab" data-focusable aria-selected="true" tabindex="0" data-rect="40,100,200,40">Manage</button>
        <button type="button" role="tab" data-focusable aria-selected="false" tabindex="-1" data-rect="250,100,200,40">Playback</button>
        <button type="button" role="tab" data-focusable aria-selected="false" tabindex="-1" data-rect="460,100,200,40">Ordering</button>
      </div>
      <button data-focusable data-rect="40,200,200,40">Add source</button>
      <button data-focusable data-rect="460,200,200,40">Priority</button>
    </main>`
  // The player's Move subtitles editor (SubtitleEditor.svelte:155-180): a legacy data-nav-trap over
  // the video, so nav keeps working while playback runs.
  const editorPage = `
    <main><button data-focusable data-rect="40,300,200,40">Behind</button></main>
    <div data-nav-trap role="dialog" aria-modal="true" aria-label="Subtitle position editor" tabindex="-1">
      <button data-focusable aria-label="Cancel subtitle changes" data-rect="20,10,40,40"></button>
      <button data-focusable data-rect="900,10,80,40">Save</button>
      <input data-focusable aria-label="Subtitle vertical position" type="range" min="5" max="100" step="1" value="50" data-rect="200,60,600,32">
    </div>`
  // sources/+page.svelte `moveTab` (:275-288): Left/Right focus the neighbour tab (wrapping) and click
  // it. The click selects through an async goto, so aria-selected/tabindex are still stale when the
  // same key bubbles on to the window listeners.
  const installMoveTab = () => {
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    const clicked: string[] = []
    for (const tab of tabs) {
      tab.addEventListener('click', () => clicked.push(tab.textContent!.trim()))
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
        next.focus()
        next.click()
      })
    }
    return clicked
  }

  beforeAll(() => {
    // Commit 1 made a second init replace the first handler, so this never double-steps.
    initDpadNav()
  })

  beforeEach(() => {
    Element.prototype.getBoundingClientRect = rectOf
    window.scrollBy = vi.fn() as unknown as typeof window.scrollBy
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
    HTMLElement.prototype.scrollBy = vi.fn() as unknown as HTMLElement['scrollBy']
    HTMLElement.prototype.scrollTo = vi.fn() as unknown as HTMLElement['scrollTo']
    isTv.set(false)
    playing.set(false)
    resetPadControlsForTests()
  })

  afterEach(() => {
    isTv.set(false)
    playing.set(false)
    document.body.replaceChildren()
  })

  it('padAdjust steps an enabled slider once and fires input then change', () => {
    document.body.innerHTML = sliderPage('min="0.5" max="2" step="0.1" value="1"')
    const slider = byLabel('Slider') as HTMLInputElement
    const events = record(slider)
    expect(padAdjust(slider, 'right', false)).toBe(true)
    expect(slider.value).toBe('1.1')
    expect(events).toEqual(['input', 'change'])
    expect(padAdjust(slider, 'left', false)).toBe(true)
    expect(padAdjust(slider, 'left', false)).toBe(true)
    expect(slider.value).toBe('0.9')
    expect(events).toEqual(['input', 'change', 'input', 'change', 'input', 'change'])
  })

  it('padAdjust consumes a press at either bound without firing anything', () => {
    document.body.innerHTML = sliderPage('min="0.5" max="2" step="0.1" value="2"')
    const slider = byLabel('Slider') as HTMLInputElement
    const events = record(slider)
    expect(padAdjust(slider, 'right', false)).toBe(true)
    expect(slider.value).toBe('2')
    slider.value = '0.5'
    expect(padAdjust(slider, 'left', false)).toBe(true)
    expect(slider.value).toBe('0.5')
    expect(events).toEqual([])
  })

  it('padAdjust leaves Up/Down, other elements and disabled sliders alone, inverts RTL, and restarts acceleration on a new direction', () => {
    document.body.innerHTML = `
      <input id="ltr" type="range" min="0" max="400" step="1" value="200">
      <div dir="rtl"><input id="rtl" type="range" min="0" max="10" step="1" value="5"></div>
      <input id="off" type="range" min="0" max="10" value="5" disabled>
      <button id="button">Button</button>`
    const ltr = document.getElementById('ltr') as HTMLInputElement
    const rtl = document.getElementById('rtl') as HTMLInputElement
    const off = document.getElementById('off') as HTMLInputElement
    expect(padAdjust(ltr, 'up', false)).toBe(false)
    expect(padAdjust(ltr, 'down', false)).toBe(false)
    expect(ltr.value).toBe('200')
    expect(padAdjust(document.getElementById('button'), 'right', false)).toBe(false)
    expect(padAdjust(null, 'right', false)).toBe(false)
    expect(padAdjust(off, 'right', false)).toBe(false)
    expect(off.value).toBe('5')
    expect(padAdjust(rtl, 'right', false)).toBe(true)
    expect(rtl.value).toBe('4')
    // A press and five repeats step by one; the sixth repeat jumps by ceil(400 / 40) = 10.
    padAdjust(ltr, 'right', false)
    for (let repeat = 0; repeat < 6; repeat++) padAdjust(ltr, 'right', true)
    expect(ltr.value).toBe('216')
    // Reversing while still held starts over at single steps.
    padAdjust(ltr, 'left', true)
    expect(ltr.value).toBe('215')
  })

  it('a pad Right steps the focused slider; focus stays and the key is consumed', () => {
    document.body.innerHTML = sliderPage('min="0.5" max="2" step="0.1" value="1"')
    const slider = byLabel('Slider') as HTMLInputElement
    const events = record(slider)
    slider.focus()
    const event = dispatchPadKey('ArrowRight')
    expect(slider.value).toBe('1.1')
    expect(events).toEqual(['input', 'change'])
    expect(document.activeElement).toBe(slider)
    expect(event.defaultPrevented).toBe(true)
  })

  it('a pad press at a bound is consumed: no events and focus stays (UI scale holds at 2.0)', () => {
    document.body.innerHTML = sliderPage('min="0.5" max="2" step="0.1" value="2"')
    const slider = byLabel('Slider') as HTMLInputElement
    const events = record(slider)
    slider.focus()
    const event = dispatchPadKey('ArrowRight')
    expect(event.defaultPrevented).toBe(true)
    expect(slider.value).toBe('2')
    expect(events).toEqual([])
    expect(document.activeElement).toBe(slider)
  })

  it('Up and Down leave a slider without touching its value', () => {
    document.body.innerHTML = sliderPage('min="0.5" max="2" step="0.1" value="1"')
    const slider = byLabel('Slider') as HTMLInputElement
    const events = record(slider)
    slider.focus()
    dispatchPadKey('ArrowDown')
    expect(document.activeElement).toBe(byLabel('Below'))
    slider.focus()
    dispatchPadKey('ArrowUp')
    expect(document.activeElement).toBe(byLabel('Above'))
    expect(slider.value).toBe('1')
    expect(events).toEqual([])
  })

  it('a held Right accelerates after six repeats; a fresh press starts over', () => {
    document.body.innerHTML = sliderPage('min="0" max="400" step="1" value="0"')
    const slider = byLabel('Slider') as HTMLInputElement
    slider.focus()
    const values: string[] = []
    dispatchPadKey('ArrowRight')
    values.push(slider.value)
    for (let repeat = 1; repeat <= 7; repeat++) {
      dispatchPadKey('ArrowRight', { repeat: true })
      values.push(slider.value)
    }
    dispatchPadKey('ArrowRight')
    values.push(slider.value)
    expect(values).toEqual(['1', '2', '3', '4', '5', '6', '16', '26', '27'])
    expect(document.activeElement).toBe(slider)
  })

  it('on TV the pad Left/Right still move focus off a slider', () => {
    isTv.set(true)
    document.body.innerHTML = sliderPage('min="0.5" max="2" step="0.1" value="1"')
    const slider = byLabel('Slider') as HTMLInputElement
    slider.focus()
    dispatchPadKey('ArrowRight')
    expect(document.activeElement).toBe(byLabel('Beside'))
    expect(slider.value).toBe('1')
  })

  it('steps the Move subtitles slider during playback, inside the editor trap', () => {
    document.body.innerHTML = editorPage
    playing.set(true)
    const editorSlider = byLabel('Subtitle vertical position') as HTMLInputElement
    const events = record(editorSlider)
    editorSlider.focus()
    dispatchPadKey('ArrowRight')
    expect(editorSlider.value).toBe('51')
    expect(events).toEqual(['input', 'change'])
    expect(document.activeElement).toBe(editorSlider)
  })

  it('reaches the inactive tabs of a roving tablist (Sources) with the pad', () => {
    document.body.innerHTML = tabsPage
    byLabel('Manage').focus()
    dispatchPadKey('ArrowRight')
    expect(document.activeElement).toBe(byLabel('Playback'))
    dispatchPadKey('ArrowRight')
    expect(document.activeElement).toBe(byLabel('Ordering'))
    dispatchPadKey('ArrowLeft')
    expect(document.activeElement).toBe(byLabel('Playback'))
  })

  it('reaches them on TV too (additive, not gated)', () => {
    isTv.set(true)
    document.body.innerHTML = tabsPage
    byLabel('Manage').focus()
    dispatchPadKey('ArrowRight')
    expect(document.activeElement).toBe(byLabel('Playback'))
  })

  it('isRovingTab: only tabs whose tablist parks the others at tabindex -1; disabled ones stay out', () => {
    document.body.innerHTML = tabsPage + `
      <div role="tablist" aria-label="Plain"><button role="tab" aria-selected="true">All</button><button role="tab" aria-selected="false">Movies</button></div>`
    expect(isRovingTab(byLabel('Manage'))).toBe(true)
    expect(isRovingTab(byLabel('Playback'))).toBe(true)
    expect(isRovingTab(document.querySelector('[aria-label="Plain"] [role="tab"]')!)).toBe(false)
    expect(isRovingTab(byLabel('Add source'))).toBe(false)
    expect(isNavigable(byLabel('Playback'))).toBe(true)
    byLabel('Ordering').setAttribute('disabled', '')
    expect(isNavigable(byLabel('Ordering'))).toBe(false)
  })

  it('a keyboard Right on a focused slider is left to the slider off TV (web standard)', () => {
    document.body.innerHTML = sliderPage('min="0.5" max="2" step="0.1" value="1"')
    const slider = byLabel('Slider')
    slider.focus()
    const event = keyboard(slider, 'ArrowRight')
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(slider)
  })

  it('on TV a keyboard Right still moves focus off the slider', () => {
    isTv.set(true)
    document.body.innerHTML = sliderPage('min="0.5" max="2" step="0.1" value="1"')
    const slider = byLabel('Slider')
    slider.focus()
    const event = keyboard(slider, 'ArrowRight')
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(byLabel('Beside'))
  })

  it('a keyboard Down on a roving tab still leaves the strip', () => {
    document.body.innerHTML = tabsPage
    installMoveTab()
    byLabel('Manage').focus()
    const event = keyboard(byLabel('Manage'), 'ArrowDown')
    expect(document.activeElement).toBe(byLabel('Add source'))
    expect(event.defaultPrevented).toBe(true)
  })

  it('a keyboard Right on a roving tab is the page’s own single step; nav stands down', () => {
    document.body.innerHTML = tabsPage
    const clicked = installMoveTab()
    byLabel('Manage').focus()
    keyboard(byLabel('Manage'), 'ArrowRight')
    expect(document.activeElement).toBe(byLabel('Playback'))
    expect(clicked).toEqual(['Playback'])
  })

  it('entering the tablist from outside lands on the selected tab, not the nearest one', () => {
    document.body.innerHTML = tabsPage
    byLabel('Priority').focus()
    dispatchPadKey('ArrowUp')
    expect(document.activeElement).toBe(byLabel('Manage'))
  })

  it('an explicit data-nav-up onto an inactive tab also lands on the selected one', () => {
    document.body.innerHTML = tabsPage
    byLabel('Ordering').setAttribute('data-nav-id', 'ordering-tab')
    byLabel('Add source').setAttribute('data-nav-up', 'ordering-tab')
    byLabel('Add source').focus()
    dispatchPadKey('ArrowUp')
    expect(document.activeElement, 'explicit data-nav-up').toBe(byLabel('Manage'))
  })
})
