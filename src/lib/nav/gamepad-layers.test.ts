// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {}, emit: async () => {} }))
vi.mock('$lib/player/series-rating', async () => {
  const { writable } = await import('svelte/store')
  return { seriesRatingPrompt: writable(null) }
})
vi.mock('$lib/search/global-search', async () => {
  const { writable } = await import('svelte/store')
  const globalSearchOpen = writable(false)
  return { globalSearchOpen, closeGlobalSearch: () => globalSearchOpen.set(false) }
})

import { startGamepadNav } from './gamepad'
import { BROWSER_GAMEPAD_EVENT } from './browser-gamepad'
import { isPadEvent } from './pad-controls'
import { pushNavLayer, resetNavLayersForTests, type NavLayer } from './layers'
import {
  advancedFiltersOpen, exitPrompt, listEditorOpen, onboardingNav, oskDismissedAt, oskOpen, playing, streamPicker, trackMenuOpen,
  type StreamPickerState,
} from '$lib/player/session'

const WINDOW_EVENTS = ['osk-close', 'list-editor-close', 'advanced-close', 'hero-nav', 'series-rating-close']
const padKeys: string[] = []
const events: string[] = []
const recordPadKey = (event: KeyboardEvent) => { if (isPadEvent(event)) padKeys.push(event.key) }
const recordEvent = (event: Event) => { events.push(event.type) }
const press = (name: string) => {
  window.dispatchEvent(new CustomEvent(BROWSER_GAMEPAD_EVENT, { detail: { name, pressed: true } }))
  window.dispatchEvent(new CustomEvent(BROWSER_GAMEPAD_EVENT, { detail: { name, pressed: false } }))
}
function openLayer(): NavLayer {
  document.body.insertAdjacentHTML('beforeend', '<div id="layer" data-nav-trap data-nav-escape><button data-focusable id="option">Option</button></div>')
  const layer: NavLayer = { kind: 'test', node: () => document.getElementById('layer'), close: vi.fn(), restore: 'none' }
  pushNavLayer(layer)
  document.getElementById('option')!.focus()
  return layer
}

let stop: () => void = () => {}
beforeEach(() => {
  // The repeat loop reads requestAnimationFrame when startGamepadNav() builds it.
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  resetNavLayersForTests()
  for (const store of [oskOpen, listEditorOpen, advancedFiltersOpen, trackMenuOpen, exitPrompt, playing]) store.set(false)
  onboardingNav.set(null)
  streamPicker.set(null)
  padKeys.length = 0
  events.length = 0
  window.addEventListener('keydown', recordPadKey)
  for (const type of WINDOW_EVENTS) window.addEventListener(type, recordEvent)
  history.replaceState(null, '', '/app/settings/player')
  stop = startGamepadNav()
})
afterEach(() => {
  stop()
  window.removeEventListener('keydown', recordPadKey)
  for (const type of WINDOW_EVENTS) window.removeEventListener(type, recordEvent)
  resetNavLayersForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('controller B and A with a nav layer open', () => {
  it('B closes only a dropdown open inside the list editor', () => {
    listEditorOpen.set(true)
    const layer = openLayer()
    press('b')
    expect(layer.close).toHaveBeenCalledTimes(1)
    expect(layer.close).toHaveBeenCalledWith('back')
    expect(events).not.toContain('list-editor-close')
  })

  it('B closes only a dropdown open inside advanced filters', () => {
    advancedFiltersOpen.set(true)
    const layer = openLayer()
    press('b')
    expect(layer.close).toHaveBeenCalledWith('back')
    expect(events).not.toContain('advanced-close')
  })

  it('B closes only a dropdown open inside the first-run wizard', () => {
    const back = vi.fn()
    onboardingNav.set({ canGoBack: true, back, introRunning: false })
    const layer = openLayer()
    press('b')
    expect(layer.close).toHaveBeenCalledWith('back')
    expect(back).not.toHaveBeenCalled()
    expect(get(exitPrompt)).toBe(false)
  })

  it('A activates the focused control inside the layer', () => {
    listEditorOpen.set(true)
    openLayer()
    const click = vi.fn()
    document.getElementById('option')!.addEventListener('click', click)
    press('a')
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('swallows X, Start and the bumpers under a layer', () => {
    history.replaceState(null, '', '/app/home')
    document.body.insertAdjacentHTML('beforeend', '<nav data-nav-sidebar><a href="/app/search" data-focusable id="rail">Search</a></nav>')
    openLayer()
    press('x')
    press('start')
    press('l1')
    press('r1')
    expect(padKeys).toEqual([])
    expect(events).not.toContain('hero-nav')
    expect(document.activeElement?.id).toBe('option')
  })

  it('B with nothing open still walks history outside Home', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {})
    press('b')
    expect(back).toHaveBeenCalledTimes(1)
  })
})

describe('controller directions with a nav layer or the keyboard open', () => {
  it('reach the layer as pad arrows, even during playback', () => {
    openLayer()
    press('down')
    playing.set(true)
    press('left')
    expect(padKeys).toEqual(['ArrowDown', 'ArrowLeft'])
  })

  it('stay with the player for left/right when nothing is open', () => {
    playing.set(true)
    press('left')
    expect(padKeys).toEqual([])
  })

  it('reach the source picker during playback, never the seek', () => {
    playing.set(true)
    streamPicker.set({ hidden: false } as unknown as StreamPickerState)
    press('right')
    expect(padKeys).toEqual(['ArrowRight'])
  })

  it('go to the keyboard first, during playback too', () => {
    oskOpen.set(true)
    playing.set(true)
    press('left')
    press('up')
    expect(padKeys).toEqual(['ArrowLeft', 'ArrowUp'])
  })
})

describe('the keyboard and the pad owners above the layer', () => {
  it('the keyboard comes first: B closes it and leaves the layer open', () => {
    const layer = openLayer()
    oskOpen.set(true)
    const pressedAt = performance.now()
    press('b')
    // B closes the keyboard directly now (commit 6): the open flag clears and the time is stamped.
    expect(get(oskOpen)).toBe(false)
    expect(get(oskDismissedAt)).toBeGreaterThanOrEqual(pressedAt)
    expect(layer.close).not.toHaveBeenCalled()
  })

  it('the track menu preempts every open layer', () => {
    const layer = openLayer()
    trackMenuOpen.set(true)
    expect(layer.close).toHaveBeenCalledWith('preempted')
  })

  it('the exit prompt preempts every open layer', () => {
    const layer = openLayer()
    exitPrompt.set(true)
    expect(layer.close).toHaveBeenCalledWith('preempted')
  })
})
