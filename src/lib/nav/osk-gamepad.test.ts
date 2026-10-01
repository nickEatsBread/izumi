// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {}, emit: async () => {} }))
// The rating prompt's module pulls in the tracker stack; the translator only reads its store.
vi.mock('$lib/player/series-rating', async () => {
  const { writable } = await import('svelte/store')
  return { seriesRatingPrompt: writable(null) }
})

import { get } from 'svelte/store'
import { gameMode, oskDismissedAt, oskOpen, playing, streamPicker, type StreamPickerState } from '$lib/player/session'
import { isTv } from '$lib/platform'
import { BROWSER_GAMEPAD_EVENT } from './browser-gamepad'
import { startGamepadNav } from './gamepad'
import { controllerMode, initDpadNav, inputType } from './index'
import { oskInsert, oskSession, openOskForField, resetOskForTests, startOsk } from './osk'

// The controller translator (gamepad.ts) driving the on-screen keyboard, through the browser
// gamepad event the Deck's Rust reader shares its payload with. jsdom has no layout: rects come
// from `data-rect` (left,top,width,height), as in fixed-dialog-reveal.test.ts.
function rectOf(this: Element): DOMRect {
  const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}
const originalRect = Element.prototype.getBoundingClientRect
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const press = (name: string) => {
  window.dispatchEvent(new CustomEvent(BROWSER_GAMEPAD_EVENT, { detail: { name, pressed: true } }))
  window.dispatchEvent(new CustomEvent(BROWSER_GAMEPAD_EVENT, { detail: { name, pressed: false } }))
}

// A text field between two buttons, with a control either side of it.
const PAGE = `
  <main>
    <button id="before" data-focusable data-rect="100,100,300,40">Before</button>
    <button id="left" data-focusable data-rect="0,200,80,40">Left</button>
    <input id="name" data-focusable aria-label="Name" data-rect="100,200,300,40">
    <button id="right" data-focusable data-rect="420,200,80,40">Right</button>
    <button id="after" data-focusable data-rect="100,300,300,40">After</button>
  </main>`

/** What OnScreenKeyboard.svelte renders for an open session, with focus moved onto its first key. */
function mountKeys(): HTMLElement {
  const keys = document.createElement('div')
  keys.setAttribute('data-osk', '')
  keys.setAttribute('data-nav-trap', '')
  keys.setAttribute('aria-label', 'On-screen keyboard')
  keys.style.position = 'fixed'
  for (const [index, key] of ['q', 'w', 'e'].entries()) {
    const button = document.createElement('button')
    button.id = `key-${key}`
    button.textContent = key
    button.setAttribute('data-focusable', '')
    button.setAttribute('data-rect', `${100 + index * 60},600,52,44`)
    button.addEventListener('click', () => oskInsert(key))
    keys.append(button)
  }
  document.body.append(keys)
  keys.querySelector<HTMLElement>('button')!.focus()
  return keys
}

let stopPad: () => void = () => {}
let stopOsk: () => void = () => {}

beforeAll(() => {
  initDpadNav()
})

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  Element.prototype.getBoundingClientRect = rectOf
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  HTMLElement.prototype.scrollBy = vi.fn() as unknown as HTMLElement['scrollBy']
  HTMLElement.prototype.scrollTo = vi.fn() as unknown as HTMLElement['scrollTo']
  gameMode.set(true)
  isTv.set(false)
  controllerMode.set(false)
  inputType.set('mouse')
  playing.set(false)
  streamPicker.set(null)
  oskDismissedAt.set(-1e9)
  resetOskForTests()
  document.body.innerHTML = PAGE
  stopOsk = startOsk()
  stopPad = startGamepadNav()
})

afterEach(() => {
  stopPad()
  stopOsk()
  resetOskForTests()
  Element.prototype.getBoundingClientRect = originalRect
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('the pad over text fields (decision 3)', () => {
  it('the d-pad passes over a field in all four directions without opening the keyboard', () => {
    byId('before').focus()
    press('down')
    expect(document.activeElement).toBe(byId('name'))
    press('down')
    expect(document.activeElement).toBe(byId('after'))
    press('up')
    press('right')
    expect(document.activeElement).toBe(byId('right'))
    press('left')
    expect(document.activeElement).toBe(byId('name'))
    press('left')
    expect(document.activeElement).toBe(byId('left'))
    expect(get(oskSession)).toBeNull()
    expect(get(oskOpen)).toBe(false)
  })

  it('A opens the keyboard on the focused field; B closes it and returns focus to the field', () => {
    byId('name').focus()
    press('a')
    expect(get(oskSession)).toMatchObject({ kind: 'field', field: byId('name') })
    const keys = mountKeys()
    const pressedAt = performance.now()
    press('b')
    expect(get(oskSession)).toBeNull()
    expect(document.activeElement).toBe(byId('name'))
    expect(get(oskDismissedAt)).toBeGreaterThanOrEqual(pressedAt)
    keys.remove() // the view unmounts the keys
    press('down')
    expect(document.activeElement).toBe(byId('after'))
  })

  it('X deletes, Y types a space, A types the focused key; other buttons are swallowed', () => {
    const field = byId<HTMLInputElement>('name')
    field.value = 'abc'
    field.focus()
    press('a')
    mountKeys()
    press('x')
    expect(field.value).toBe('ab')
    press('y')
    expect(field.value).toBe('ab ')
    for (const name of ['start', 'select', 'l1', 'r1', 'l2', 'r2']) press(name)
    expect(field.value).toBe('ab ')
    expect(get(oskSession)).not.toBeNull()
    expect(document.activeElement).toBe(byId('key-q'))
    press('a')
    expect(field.value).toBe('ab q')
  })

  it('B closes the keyboard before Change source, and the next B closes the picker', () => {
    streamPicker.set({ media: {}, episode: 1, streams: [], cachedCount: 0 } as unknown as StreamPickerState)
    openOskForField(byId<HTMLInputElement>('name'))
    const keys = mountKeys()
    press('b')
    expect(get(oskSession)).toBeNull()
    expect(get(streamPicker)).not.toBeNull()
    keys.remove()
    press('b')
    expect(get(streamPicker)).toBeNull()
  })

  it('during playback the d-pad walks the keys instead of seeking', () => {
    playing.set(true)
    openOskForField(byId<HTMLInputElement>('name'))
    mountKeys()
    press('right')
    expect(document.activeElement).toBe(byId('key-w'))
    press('left')
    expect(document.activeElement).toBe(byId('key-q'))
  })
})

// gamepad.ts reaches $app/navigation through the layered Back (nav/back.ts → settings/back.ts).
// vi.hoisted and vi.mock are hoisted above the imports, wherever they are written.
const navigationMocks = vi.hoisted(() => ({ goto: vi.fn() }))
vi.mock('$app/navigation', () => ({ goto: navigationMocks.goto }))
