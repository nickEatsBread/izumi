// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

// gamepad.ts may reach $app/navigation through the layered Back model; the mock keeps this file
// loading either way. The Tauri event bridge and the rating prompt's tracker imports are not needed
// to drive the translator through BROWSER_GAMEPAD_EVENT.
const mocks = vi.hoisted(() => ({ goto: vi.fn() }))
vi.mock('$app/navigation', () => ({ goto: mocks.goto }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {}, emit: async () => {} }))
vi.mock('$lib/player/series-rating', async () => {
  const { writable } = await import('svelte/store')
  return { seriesRatingPrompt: writable(null) }
})

import { startGamepadNav } from './gamepad'
import { BROWSER_GAMEPAD_EVENT } from './browser-gamepad'
import { padActivate } from './pad-controls'
import { pushNavLayer, resetNavLayersForTests } from './layers'
import {
  chooseNativePickerOption,
  closeNativePicker,
  focusPickerRow,
  nativePicker,
  pickerKeydown,
  resetNativePickerForTests,
  type NativePickerState,
} from './native-picker'
import { isTv } from '$lib/platform'
import { oskOpen, playing, streamPicker, streamPickerDismissedAt, type StreamPickerState } from '$lib/player/session'

// vitest has no Svelte plugin, so NativePickerSheet.svelte cannot be mounted. This fixture renders
// what it renders and registers what it registers (native-picker-sheet-contract.test.ts pins the
// component to the same layer options, close rule, row markers and key handler): a data-nav-trap
// panel of data-picker-row buttons (options carry data-hint-a="Select"), pushed as the
// 'native-picker' nav layer, plus the capture pickerKeydown.
let panel: HTMLElement | null = null
let removeLayer: (() => void) | null = null

function pickerButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.setAttribute('data-focusable', '')
  button.setAttribute('data-picker-row', '')
  button.addEventListener('click', onClick)
  return button
}

function renderSheet(state: NativePickerState | null) {
  removeLayer?.()
  removeLayer = null
  panel?.remove()
  panel = null
  if (!state) return
  const node = document.createElement('div')
  node.setAttribute('role', 'dialog')
  node.setAttribute('aria-modal', 'true')
  node.setAttribute('data-nav-trap', '')
  node.setAttribute('data-nav-escape', '')
  node.setAttribute('data-native-picker', '')
  for (const entry of state.options) {
    const row = pickerButton(entry.label, () => chooseNativePickerOption(entry.option))
    row.setAttribute('data-hint-a', 'Select')
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', String(entry.selected))
    row.disabled = entry.disabled
    node.append(row)
  }
  node.append(pickerButton('Cancel', () => closeNativePicker({ restore: true })))
  document.body.append(node)
  panel = node
  removeLayer = pushNavLayer({
    kind: 'native-picker',
    node: () => node,
    close: (reason) => closeNativePicker({ restore: reason === 'back' }),
    restore: 'none',
    opener: state.opener,
  })
  focusPickerRow(node)
}

const onKeyCapture = (event: KeyboardEvent) => { pickerKeydown(event, panel) }
const pad = (name: string) => {
  for (const pressed of [true, false]) {
    window.dispatchEvent(new CustomEvent(BROWSER_GAMEPAD_EVENT, { detail: { name, pressed } }))
  }
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const q = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!

const PAGE = `
  <label>Maximum content age<select id="age" data-focusable>
    <option>7</option><option selected>12</option><option>16</option><option disabled>18</option>
  </select></label>
  <button id="behind" data-focusable>Behind</button>`

describe('pad A on a native select', () => {
  let stopGamepad: () => void = () => {}
  let stopSheet: () => void = () => {}

  beforeAll(() => {
    stopGamepad = startGamepadNav()
    stopSheet = nativePicker.subscribe(renderSheet)
    window.addEventListener('keydown', onKeyCapture, { capture: true })
  })
  afterAll(() => {
    window.removeEventListener('keydown', onKeyCapture, { capture: true })
    stopSheet()
    stopGamepad()
  })
  beforeEach(() => {
    isTv.set(false)
    oskOpen.set(false)
    playing.set(false)
    streamPicker.set(null)
  })
  afterEach(() => {
    resetNativePickerForTests()
    resetNavLayersForTests()
    document.body.replaceChildren()
    isTv.set(false)
    streamPicker.set(null)
    playing.set(false)
    vi.restoreAllMocks()
  })

  it('opens the chooser on the current value instead of clicking the select', () => {
    document.body.innerHTML = PAGE
    const click = vi.fn()
    q('#age').addEventListener('click', click)
    q('#age').focus()
    pad('a')
    expect(get(nativePicker)?.select).toBe(q('#age'))
    expect(get(nativePicker)?.title).toBe('Maximum content age')
    expect(click).not.toHaveBeenCalled()
    expect(panel?.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.textContent).toBe('12')
  })

  it('walks the rows with the d-pad, skips a disabled one and commits once with A, then returns focus', async () => {
    document.body.innerHTML = PAGE
    const age = q<HTMLSelectElement>('#age')
    const change = vi.fn()
    age.addEventListener('change', change)
    age.focus()
    pad('a')
    pad('down')
    expect(document.activeElement?.textContent).toBe('16')
    pad('down')
    expect(document.activeElement?.textContent).toBe('Cancel')
    pad('up')
    expect(document.activeElement?.textContent).toBe('16')
    pad('a')
    expect(age.selectedIndex).toBe(2)
    expect(change).toHaveBeenCalledTimes(1)
    expect(get(nativePicker)).toBeNull()
    await settle()
    expect(document.activeElement).toBe(age)
  })

  it('closes only the chooser on B and puts focus back on the select', async () => {
    document.body.innerHTML = PAGE
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    q('#age').focus()
    pad('a')
    pad('b')
    expect(get(nativePicker)).toBeNull()
    expect(panel).toBeNull()
    expect(back).not.toHaveBeenCalled()
    await settle()
    expect(document.activeElement).toBe(q('#age'))
  })

  it('closes on keyboard Escape through the shared layer capture', async () => {
    document.body.innerHTML = PAGE
    q('#age').focus()
    pad('a')
    expect(get(nativePicker)?.select).toBe(q('#age'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(get(nativePicker)).toBeNull()
    await settle()
    expect(document.activeElement).toBe(q('#age'))
  })

  it('swallows X, the bumpers and Start while it is open', () => {
    document.body.innerHTML = PAGE
    const keys: string[] = []
    const record = (event: KeyboardEvent) => { keys.push(event.key) }
    window.addEventListener('keydown', record)
    try {
      q('#age').focus()
      pad('a')
      for (const name of ['x', 'l1', 'r1', 'start']) pad(name)
      expect(keys).not.toContain('d')
      expect(get(nativePicker)?.select).toBe(q('#age'))
      expect(panel?.contains(document.activeElement)).toBe(true)
    } finally {
      window.removeEventListener('keydown', record)
    }
  })

  it('keeps the plain click on TV, where the system dialog works', () => {
    isTv.set(true)
    document.body.innerHTML = PAGE
    const click = vi.fn()
    q('#age').addEventListener('click', click)
    q('#age').focus()
    pad('a')
    expect(click).toHaveBeenCalledTimes(1)
    expect(get(nativePicker)).toBeNull()
  })

  it('acts on the focused select when called without an argument', () => {
    document.body.innerHTML = PAGE
    q('#age').focus()
    expect(padActivate()).toBe(true)
    expect(get(nativePicker)?.select).toBe(q('#age'))
  })

  it('does nothing on a disabled or aria-disabled select and keeps the click for list boxes', () => {
    document.body.innerHTML = `
      <select id="off" disabled><option>A</option></select>
      <select id="aria" aria-disabled="true"><option>A</option></select>
      <select id="multi" multiple><option>A</option></select>
      <select id="list" size="3"><option>A</option></select>`
    const clicks = { off: vi.fn(), aria: vi.fn(), multi: vi.fn(), list: vi.fn() }
    for (const [id, click] of Object.entries(clicks)) q(`#${id}`).addEventListener('click', click)
    for (const id of Object.keys(clicks)) expect(padActivate(q(`#${id}`)), id).toBe(true)
    expect(clicks.off).not.toHaveBeenCalled()
    expect(clicks.aria).not.toHaveBeenCalled()
    expect(clicks.multi).toHaveBeenCalledTimes(1)
    expect(clicks.list).toHaveBeenCalledTimes(1)
    expect(get(nativePicker)).toBeNull()
  })

  it('keeps the plain click under a modal dialog, whose top layer would hide the chooser', () => {
    document.body.innerHTML = `
      <dialog id="modal" open aria-labelledby="modal-title">
        <h2 id="modal-title">Edit profile</h2>
        <label>Avatar<select id="avatar" data-focusable><option>Keep current avatar</option><option>Fox</option></select></label>
      </dialog>`
    const realMatches = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':modal' ? this.id === 'modal' : realMatches.call(this, selector)
    })
    const click = vi.fn()
    q('#avatar').addEventListener('click', click)
    q('#avatar').focus()
    pad('a')
    expect(click).toHaveBeenCalledTimes(1)
    expect(get(nativePicker)).toBeNull()
    expect(panel).toBeNull()
  })

  it('over Change source during playback, owns the d-pad and the first B, never the picker behind', async () => {
    document.body.innerHTML = `
      <div data-nav-trap id="source-picker">
        <select id="sort" data-focusable aria-label="Sort within cache tier">
          <option value="quality">Quality</option><option value="seeders">Seeders</option><option value="size">Size</option>
        </select>
        <button data-source-row data-focusable>Source 1</button>
      </div>`
    playing.set(true)
    streamPicker.set({ hidden: false } as unknown as StreamPickerState)
    const dismissedAt = get(streamPickerDismissedAt)
    const pickerNav = vi.fn()
    window.addEventListener('stream-picker-nav', pickerNav)
    try {
      q('#sort').focus()
      pad('a')
      expect(get(nativePicker)?.title).toBe('Sort within cache tier')
      pad('down')
      pad('left')
      pad('right')
      expect(document.activeElement?.textContent).toBe('Seeders')
      expect(pickerNav).not.toHaveBeenCalled()
      pad('b')
      expect(get(nativePicker)).toBeNull()
      expect(get(streamPicker)).not.toBeNull()
      expect(get(streamPickerDismissedAt)).toBe(dismissedAt)
      await settle()
      expect(document.activeElement).toBe(q('#sort'))
    } finally {
      window.removeEventListener('stream-picker-nav', pickerNav)
    }
  })
})
