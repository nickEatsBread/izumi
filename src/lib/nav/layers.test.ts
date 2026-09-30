// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import {
  closeAllNavLayers,
  closeTopNavLayer,
  navLayerDismissedAt,
  navLayerOpen,
  navLayerSerial,
  pushNavLayer,
  resetNavLayersForTests,
  topNavLayer,
  type NavLayer,
  type NavLayerCloseReason,
} from './layers'
import type { ActionReturn } from 'svelte/action'
import { isTv } from '$lib/platform'
import { inputType } from './input'
import { peekFocusHint, setFocusHint } from './focus-hint'
import { navEpoch, navInFlight, resetNavStateForTests } from './nav-state'
import { decideLayerFocusReturn, navLayer, resetOverlayForTests, type NavLayerOptions } from './overlay'

const html = (markup: string) => { document.body.innerHTML = markup }
const byId = (id: string) => document.getElementById(id) as HTMLElement
const layer = (id: string, overrides: Partial<NavLayer> = {}): NavLayer => ({
  kind: 'test',
  node: () => document.getElementById(id),
  close: vi.fn(),
  restore: 'none',
  ...overrides,
})
const escape = (target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
// MutationObserver callbacks are microtasks: one macrotask later every record has been delivered.
const flushObserver = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => { resetNavLayersForTests() })
afterEach(() => {
  vi.restoreAllMocks()
  resetNavLayersForTests()
  document.body.replaceChildren()
})

describe('nav layer stack', () => {
  it('returns the last pushed live layer and pops in order', () => {
    html('<div id="a" data-nav-trap></div><div id="b" data-nav-trap></div>')
    const removeA = pushNavLayer(layer('a'))
    const removeB = pushNavLayer(layer('b'))
    expect(topNavLayer()?.node()).toBe(byId('b'))
    removeB()
    expect(topNavLayer()?.node()).toBe(byId('a'))
    removeA()
    expect(topNavLayer()).toBeNull()
  })

  it('has an idempotent remover that stamps the dismissal once', () => {
    html('<div id="a" data-nav-trap></div>')
    const remove = pushNavLayer(layer('a'))
    vi.spyOn(performance, 'now').mockReturnValue(1234)
    remove()
    expect(get(navLayerDismissedAt)).toBe(1234)
    navLayerDismissedAt.set(-1e9)
    remove()
    expect(get(navLayerDismissedAt)).toBe(-1e9)
  })

  it('closes only the top layer, once, and counts a veto as consumed', () => {
    html('<div id="a" data-nav-trap></div><div id="b" data-nav-trap></div>')
    const a = layer('a')
    const b = layer('b', { close: vi.fn(() => false as const) })
    pushNavLayer(a)
    pushNavLayer(b)
    expect(closeTopNavLayer()).toBe(true)
    expect(b.close).toHaveBeenCalledTimes(1)
    expect(b.close).toHaveBeenCalledWith('back')
    expect(a.close).not.toHaveBeenCalled()
    expect(topNavLayer()?.node()).toBe(byId('b'))
  })

  it('reports nothing to close when no layer is open', () => {
    expect(closeTopNavLayer()).toBe(false)
  })

  it('stamps the dismissal when a close is accepted', () => {
    html('<div id="a" data-nav-trap></div>')
    pushNavLayer(layer('a'))
    vi.spyOn(performance, 'now').mockReturnValue(777)
    closeTopNavLayer('back')
    expect(get(navLayerDismissedAt)).toBe(777)
  })

  it('closes every layer top first and respects a veto', () => {
    html('<div id="a" data-nav-trap></div><div id="b" data-nav-trap></div>')
    const order: string[] = []
    pushNavLayer(layer('a', { close: vi.fn((reason: NavLayerCloseReason) => { order.push(`a:${reason}`) }) }))
    pushNavLayer(layer('b', { close: vi.fn((reason: NavLayerCloseReason) => { order.push(`b:${reason}`); return false as const }) }))
    closeAllNavLayers('navigate')
    expect(order).toEqual(['b:navigate', 'a:navigate'])
    expect(topNavLayer()?.node()).toBe(byId('b'))
  })

  it('skips disconnected, hidden and inert layers without pruning them', async () => {
    html('<div id="a" data-nav-trap></div><div id="b" data-nav-trap></div><div id="c" data-nav-trap></div>')
    pushNavLayer(layer('a'))
    pushNavLayer(layer('b'))
    pushNavLayer(layer('c'))
    byId('c').remove()
    byId('b').checkVisibility = () => false
    expect(topNavLayer()?.node()).toBe(byId('a'))
    byId('a').setAttribute('inert', '')
    expect(topNavLayer()).toBeNull()
    byId('a').removeAttribute('inert')
    await flushObserver()
    expect(topNavLayer()?.node()).toBe(byId('a'))
  })

  it('marks an entry closing when an outro makes it inert, once, and re-activates it', async () => {
    html('<div id="wrap"><div id="a" data-nav-trap></div></div>')
    const onClosing = vi.fn()
    pushNavLayer(layer('a', { onClosing }))
    expect(get(navLayerOpen)).toBe(true)
    byId('wrap').setAttribute('inert', '')
    await flushObserver()
    expect(onClosing).toHaveBeenCalledTimes(1)
    expect(get(navLayerOpen)).toBe(false)
    expect(get(navLayerDismissedAt)).toBeGreaterThan(-1e9)
    byId('wrap').setAttribute('inert', '')
    await flushObserver()
    expect(onClosing).toHaveBeenCalledTimes(1)
    byId('wrap').removeAttribute('inert')
    await flushObserver()
    expect(get(navLayerOpen)).toBe(true)
    expect(topNavLayer()?.node()).toBe(byId('a'))
  })

  it('fires onClosing from the remover when no outro ran', () => {
    html('<div id="a" data-nav-trap></div>')
    const onClosing = vi.fn()
    const remove = pushNavLayer(layer('a', { onClosing }))
    remove()
    remove()
    expect(onClosing).toHaveBeenCalledTimes(1)
    expect(get(navLayerOpen)).toBe(false)
  })

  it('counts pushes for the hand-off check', () => {
    html('<div id="a" data-nav-trap></div>')
    const before = navLayerSerial()
    pushNavLayer(layer('a'))
    expect(navLayerSerial()).toBe(before + 1)
  })

  it('limits the lookup to a scope', () => {
    html('<section id="scope"><div id="a" data-nav-trap></div></section><div id="b" data-nav-trap></div>')
    pushNavLayer(layer('a'))
    pushNavLayer(layer('b'))
    expect(topNavLayer(byId('scope'))?.node()).toBe(byId('a'))
  })
})

describe('shared Escape capture', () => {
  it('closes only the top layer, and no page or window listener sees the key', () => {
    html('<div id="a" data-nav-trap><button id="in-a">A</button></div><div id="b" data-nav-trap><button id="in-b">B</button></div>')
    const bubble = vi.fn()
    // Registered before any layer exists, like the shell's own keydown handler.
    window.addEventListener('keydown', bubble)
    const element = vi.fn()
    byId('in-b').addEventListener('keydown', element)
    const a = layer('a')
    const b = layer('b')
    pushNavLayer(a)
    pushNavLayer(b)
    byId('in-b').focus()
    escape(byId('in-b')) // keyboard Escape, aimed at the focused control
    escape() // window Escape: the TV activity, the phone bridge, the pad's legacy path
    expect(b.close).toHaveBeenCalledTimes(2)
    expect(b.close).toHaveBeenCalledWith('back')
    expect(a.close).not.toHaveBeenCalled()
    expect(bubble).not.toHaveBeenCalled()
    expect(element).not.toHaveBeenCalled()
    window.removeEventListener('keydown', bubble)
  })

  it('lets an Escape through when focus sits in an unrelated trap such as the keyboard', () => {
    html('<div id="a" data-nav-trap><button>A</button></div><div id="osk" data-nav-trap aria-label="On-screen keyboard"><button id="key">q</button></div>')
    const bubble = vi.fn()
    window.addEventListener('keydown', bubble)
    const a = layer('a')
    pushNavLayer(a)
    byId('key').focus()
    escape(byId('key'))
    expect(a.close).not.toHaveBeenCalled()
    expect(bubble).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', bubble)
  })

  it('closes the top layer when focus sits in a nested trap or in a layer underneath', () => {
    html('<div id="a" data-nav-trap><div data-nav-trap><button id="inner">x</button></div></div><div id="b" data-nav-trap><button>y</button></div>')
    const a = layer('a')
    pushNavLayer(a)
    byId('inner').focus()
    escape(byId('inner'))
    expect(a.close).toHaveBeenCalledTimes(1)
    const b = layer('b')
    pushNavLayer(b)
    escape(byId('inner'))
    expect(b.close).toHaveBeenCalledTimes(1)
    expect(a.close).toHaveBeenCalledTimes(1)
  })

  it('ignores an Escape another handler already consumed, and other keys', () => {
    html('<div id="a" data-nav-trap><button id="x">x</button></div>')
    const a = layer('a')
    pushNavLayer(a)
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    consumed.preventDefault()
    window.dispatchEvent(consumed)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(a.close).not.toHaveBeenCalled()
  })

  it('removes the capture once the stack is empty', () => {
    html('<div id="a" data-nav-trap></div>')
    const bubble = vi.fn()
    window.addEventListener('keydown', bubble)
    const remove = pushNavLayer(layer('a'))
    remove()
    escape()
    expect(bubble).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', bubble)
  })
})

describe('decideLayerFocusReturn', () => {
  const base = {
    restore: 'auto' as const,
    epochChanged: false,
    navInFlight: false,
    serialChanged: false,
    focusMoved: false,
    inputType: 'dpad' as const,
    isTv: false,
    openerFocusVisible: false,
  }

  it('restores for the d-pad, on TV, for a focus-visible opener and when forced', () => {
    expect(decideLayerFocusReturn(base)).toBe('restore')
    expect(decideLayerFocusReturn({ ...base, inputType: 'touch', isTv: true })).toBe('restore')
    expect(decideLayerFocusReturn({ ...base, inputType: 'mouse', openerFocusVisible: true })).toBe('restore')
    expect(decideLayerFocusReturn({ ...base, inputType: 'mouse', restore: 'always' })).toBe('restore')
  })

  it('leaves a hint when only the modality says no', () => {
    expect(decideLayerFocusReturn({ ...base, inputType: 'mouse' })).toBe('hint')
    expect(decideLayerFocusReturn({ ...base, inputType: 'touch' })).toBe('hint')
  })

  it('skips after a navigation, a hand-off, a real focus move, or when opted out', () => {
    expect(decideLayerFocusReturn({ ...base, epochChanged: true })).toBe('skip')
    expect(decideLayerFocusReturn({ ...base, navInFlight: true })).toBe('skip')
    expect(decideLayerFocusReturn({ ...base, serialChanged: true })).toBe('skip')
    expect(decideLayerFocusReturn({ ...base, focusMoved: true })).toBe('skip')
    expect(decideLayerFocusReturn({ ...base, restore: 'none' })).toBe('skip')
    expect(decideLayerFocusReturn({ ...base, restore: 'always', focusMoved: true })).toBe('skip')
  })
})

describe('navLayer action', () => {
  let frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 1
  const flushFrames = () => {
    for (let round = 0; round < 4 && frames.size; round += 1) {
      const due = [...frames.values()]
      frames.clear()
      due.forEach((callback) => callback(0))
    }
  }
  // navLayer is an `Action`, whose declared return is `void | ActionReturn`; it always returns one.
  const mount = (node: HTMLElement, options: NavLayerOptions) => navLayer(node, options) as ActionReturn<NavLayerOptions>
  const page = '<button id="opener" data-focusable>Sort</button><div id="menu"><button data-focusable id="option">Newest</button></div>'

  beforeEach(() => {
    frames = new Map()
    nextFrame = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrame++
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    resetOverlayForTests()
    resetNavStateForTests()
    setFocusHint(null)
    inputType.set('dpad')
    isTv.set(false)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('marks the node as a trap that closes on Escape and holds a layer until destroyed', () => {
    html(page)
    const onClose = vi.fn()
    const action = mount(byId('menu'), { onClose })
    expect(byId('menu').hasAttribute('data-nav-trap')).toBe(true)
    expect(byId('menu').hasAttribute('data-nav-escape')).toBe(true)
    expect(topNavLayer()?.node()).toBe(byId('menu'))
    expect(topNavLayer()?.kind).toBe('overlay')
    closeTopNavLayer()
    expect(onClose).toHaveBeenCalledWith('back')
    action.destroy?.()
    expect(topNavLayer()).toBeNull()
  })

  it('uses the latest onClose after an update', () => {
    html(page)
    const first = vi.fn()
    const second = vi.fn()
    const action = mount(byId('menu'), { onClose: first })
    action.update?.({ onClose: second })
    closeTopNavLayer()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('back')
    action.destroy?.()
  })

  it('focuses the first non-text control one frame after mount for the d-pad', () => {
    html('<div id="menu"><input data-focusable id="search"><button data-focusable id="first">One</button></div>')
    const action = mount(byId('menu'), { onClose: () => {} })
    expect(document.activeElement).toBe(document.body)
    flushFrames()
    expect(document.activeElement).toBe(byId('first'))
    action.destroy?.()
  })

  it('leaves focus alone under the mouse unless the layer always focuses', () => {
    inputType.set('mouse')
    html('<div id="menu"><button data-focusable id="first">One</button></div>')
    const plain = mount(byId('menu'), { onClose: () => {} })
    flushFrames()
    expect(document.activeElement).toBe(document.body)
    plain.destroy?.()
    html('<div id="menu"><button data-focusable id="first">One</button></div>')
    const always = mount(byId('menu'), { onClose: () => {}, initialFocus: 'always' })
    flushFrames()
    expect(document.activeElement).toBe(byId('first'))
    always.destroy?.()
  })

  it('never moves focus with initialFocus none, or when focus is already inside', () => {
    html('<div id="menu"><button data-focusable id="first">One</button><button data-focusable id="second">Two</button></div>')
    const none = mount(byId('menu'), { onClose: () => {}, initialFocus: 'none' })
    flushFrames()
    expect(document.activeElement).toBe(document.body)
    none.destroy?.()
    html('<div id="menu"><button data-focusable id="first">One</button><button data-focusable id="second">Two</button></div>')
    const inside = mount(byId('menu'), { onClose: () => {} })
    byId('second').focus()
    flushFrames()
    expect(document.activeElement).toBe(byId('second'))
    inside.destroy?.()
  })

  it('returns focus to the opener one frame after the layer is removed, for the d-pad', () => {
    html(page)
    byId('opener').focus()
    const action = mount(byId('menu'), { onClose: () => {}, initialFocus: 'none' })
    byId('option').focus()
    byId('menu').remove()
    action.destroy?.()
    expect(document.activeElement).toBe(document.body)
    flushFrames()
    expect(document.activeElement).toBe(byId('opener'))
  })

  it('returns focus at outro start, when the node turns inert', async () => {
    html(page)
    byId('opener').focus()
    const action = mount(byId('menu'), { onClose: () => {}, initialFocus: 'none' })
    byId('option').focus()
    byId('menu').setAttribute('inert', '')
    await flushObserver()
    flushFrames()
    expect(document.activeElement).toBe(byId('opener'))
    action.destroy?.()
  })

  it('keeps focus in a layer whose outro was reversed', async () => {
    html(page)
    byId('opener').focus()
    const action = mount(byId('menu'), { onClose: () => {}, initialFocus: 'none' })
    byId('option').focus()
    byId('menu').setAttribute('inert', '')
    await flushObserver()
    byId('menu').removeAttribute('inert')
    await flushObserver()
    flushFrames()
    expect(document.activeElement).toBe(byId('option'))
    action.destroy?.()
  })

  it('leaves a hint instead of moving focus after a touch close', () => {
    inputType.set('touch')
    html(page)
    byId('opener').focus()
    const action = mount(byId('menu'), { onClose: () => {}, initialFocus: 'none' })
    byId('option').focus()
    byId('menu').remove()
    action.destroy?.()
    flushFrames()
    expect(document.activeElement).toBe(document.body)
    expect(peekFocusHint()).toBe(byId('opener'))
  })

  it('skips the return once a navigation started or while one is in flight', () => {
    html(page)
    byId('opener').focus()
    const first = mount(byId('menu'), { onClose: () => {}, initialFocus: 'none' })
    byId('option').focus()
    navEpoch.update((epoch) => epoch + 1)
    byId('menu').remove()
    first.destroy?.()
    flushFrames()
    expect(document.activeElement).toBe(document.body)

    html(page)
    byId('opener').focus()
    const second = mount(byId('menu'), { onClose: () => {}, initialFocus: 'none' })
    byId('option').focus()
    navInFlight.set(true)
    byId('menu').remove()
    second.destroy?.()
    flushFrames()
    expect(document.activeElement).toBe(document.body)
  })

  it('never takes focus back from where the user moved it, or when opted out', () => {
    html(page + '<button id="other" data-focusable>Other</button>')
    byId('opener').focus()
    const moved = mount(byId('menu'), { onClose: () => {}, initialFocus: 'none' })
    byId('menu').remove()
    moved.destroy?.()
    byId('other').focus()
    flushFrames()
    expect(document.activeElement).toBe(byId('other'))

    html(page)
    byId('opener').focus()
    const optedOut = mount(byId('menu'), { onClose: () => {}, initialFocus: 'none', returnFocus: 'none' })
    byId('option').focus()
    byId('menu').remove()
    optedOut.destroy?.()
    flushFrames()
    expect(document.activeElement).toBe(document.body)
    expect(peekFocusHint()).toBeNull()
  })

  it('hands the opener on when a closing layer is replaced by another', () => {
    html('<button id="opener" data-focusable>Store</button><div id="sheet"><button data-focusable id="replace">Replace…</button></div><div id="confirm"><button data-focusable id="yes">Replace</button></div>')
    byId('opener').focus()
    const sheet = mount(byId('sheet'), { onClose: () => {}, initialFocus: 'none' })
    byId('replace').focus()
    byId('sheet').remove()
    sheet.destroy?.()
    const confirm = mount(byId('confirm'), { onClose: () => {}, initialFocus: 'none' })
    flushFrames()
    expect(document.activeElement).toBe(document.body)
    byId('confirm').remove()
    confirm.destroy?.()
    flushFrames()
    expect(document.activeElement).toBe(byId('opener'))
  })

  it('hands the opener on when a layer is replaced during its outro', async () => {
    html('<button id="opener" data-focusable>Store</button><div id="sheet"><button data-focusable id="replace">Replace…</button></div><div id="confirm"><button data-focusable id="yes">Replace</button></div>')
    byId('opener').focus()
    const sheet = mount(byId('sheet'), { onClose: () => {}, initialFocus: 'none' })
    byId('replace').focus()
    byId('sheet').setAttribute('inert', '')
    const confirm = mount(byId('confirm'), { onClose: () => {}, initialFocus: 'none' })
    await flushObserver()
    flushFrames()
    expect(document.activeElement).not.toBe(byId('opener'))
    byId('sheet').remove()
    sheet.destroy?.()
    byId('confirm').remove()
    confirm.destroy?.()
    flushFrames()
    expect(document.activeElement).toBe(byId('opener'))
  })

  it('returns a nested dropdown to its trigger inside the outer layer', () => {
    html('<button id="opener" data-focusable>Configure</button><div id="dialog"><button data-focusable id="trigger">Quality</button></div><div id="menu"><button data-focusable id="choice">1080p</button></div>')
    byId('opener').focus()
    const dialog = mount(byId('dialog'), { onClose: () => {}, initialFocus: 'none' })
    byId('trigger').focus()
    const menu = mount(byId('menu'), { onClose: () => {}, initialFocus: 'none' })
    byId('choice').focus()
    byId('menu').remove()
    menu.destroy?.()
    flushFrames()
    expect(document.activeElement).toBe(byId('trigger'))
    dialog.destroy?.()
  })

  it('lets the outer layer answer when it closes together with a nested one', () => {
    html('<button id="opener" data-focusable>Configure</button><div id="dialog"><button data-focusable id="trigger">Quality</button></div><div id="menu"><button data-focusable id="choice">1080p</button></div><button data-focusable id="page-quality">Quality</button>')
    byId('opener').focus()
    const dialog = mount(byId('dialog'), { onClose: () => {}, initialFocus: 'none' })
    byId('trigger').focus()
    const menu = mount(byId('menu'), { onClose: () => {}, initialFocus: 'none' })
    byId('choice').focus()
    byId('menu').remove()
    byId('dialog').remove()
    menu.destroy?.()
    dialog.destroy?.()
    flushFrames()
    expect(document.activeElement).toBe(byId('opener'))
  })
})
