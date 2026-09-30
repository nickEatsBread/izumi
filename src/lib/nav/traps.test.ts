// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { oskOpen } from '$lib/player/session'
import { pushNavLayer, resetNavLayersForTests } from './layers'
import { activeNavTrap, cancelModalDialog, openModalDialog, visibleNavTraps } from './traps'
import { initDpadNav } from './index'
import { setFocusHint } from './focus-hint'

const byId = (id: string) => document.getElementById(id) as HTMLElement
const pushLayer = (id: string) =>
  pushNavLayer({ kind: 'test', node: () => document.getElementById(id), close: () => {}, restore: 'none' })

const realMatches = Element.prototype.matches
/** jsdom has no `:modal`. 'attribute' makes dialogs carrying data-modal match it. */
function stubModal(mode: 'attribute' | 'none' | 'throw') {
  // Cast: lib.dom declares matches() with tag-name type-predicate overloads.
  Element.prototype.matches = function (this: Element, selector: string): boolean {
    if (selector !== ':modal') return realMatches.call(this, selector)
    if (mode === 'throw') throw new SyntaxError("':modal' is not a valid selector")
    return mode === 'attribute' && this.hasAttribute('data-modal')
  } as unknown as Element['matches']
}

beforeEach(() => {
  oskOpen.set(false)
  resetNavLayersForTests()
})
afterEach(() => {
  Element.prototype.matches = realMatches
  oskOpen.set(false)
  resetNavLayersForTests()
  document.body.replaceChildren()
})

describe('openModalDialog', () => {
  const dialogs = '<dialog id="a" open data-modal></dialog><dialog id="b" open data-modal></dialog><dialog id="c" open></dialog><dialog id="d"></dialog>'

  it('prefers the last dialog shown as a modal', () => {
    document.body.innerHTML = dialogs
    stubModal('attribute')
    expect(openModalDialog()?.id).toBe('b')
  })

  it('falls back to the last open dialog when none is modal', () => {
    document.body.innerHTML = dialogs
    stubModal('none')
    expect(openModalDialog()?.id).toBe('c')
  })

  it('treats an engine that throws on :modal as "not modal"', () => {
    document.body.innerHTML = dialogs
    stubModal('throw')
    expect(openModalDialog()?.id).toBe('c')
  })

  it('finds nothing when no dialog is open', () => {
    document.body.innerHTML = '<dialog></dialog>'
    expect(openModalDialog()).toBeNull()
  })
})

describe('visibleNavTraps', () => {
  it('lists visible, non-inert traps in page order', () => {
    document.body.innerHTML = '<div id="hidden" data-nav-trap></div><div inert><div id="inert" data-nav-trap></div></div><div id="first" data-nav-trap></div><div id="second" data-nav-trap></div>'
    byId('hidden').checkVisibility = () => false
    expect(visibleNavTraps().map((trap) => trap.id)).toEqual(['first', 'second'])
  })
})

describe('activeNavTrap', () => {
  // The keyboard carries both markers, so these cases hold before and after commit 6 narrows the
  // keyboard selector to data-osk.
  const keyboard = '<div id="osk" data-osk data-nav-trap aria-label="On-screen keyboard"><button>q</button></div>'
  const drawer = '<div id="drawer" data-nav-trap data-nav-escape><a href="/app/home">Home</a></div>'
  const menu = '<div id="menu" data-nav-trap data-nav-escape><button>Option</button></div>'

  it('gives the open keyboard precedence over a layer', () => {
    document.body.innerHTML = drawer + menu + keyboard
    pushLayer('menu')
    oskOpen.set(true)
    expect(activeNavTrap()?.id).toBe('osk')
    oskOpen.set(false)
    expect(activeNavTrap()?.id).toBe('menu')
  })

  it('puts the top layer above an open dialog and above a legacy trap earlier in the page', () => {
    document.body.innerHTML = drawer + '<dialog id="dialog" open><button>OK</button></dialog>' + menu
    pushLayer('menu')
    expect(activeNavTrap()?.id).toBe('menu')
  })

  it('confines to an open dialog, or the trap inside it, before a legacy trap', () => {
    document.body.innerHTML = drawer + '<dialog id="dialog" open><button>OK</button></dialog>'
    expect(activeNavTrap()?.id).toBe('dialog')
    document.body.innerHTML = drawer + '<dialog id="dialog" open><div id="inner" data-nav-trap><button>OK</button></div></dialog>'
    expect(activeNavTrap()?.id).toBe('inner')
  })

  it('falls back to the first visible legacy trap, then to nothing', () => {
    document.body.innerHTML = '<div id="hidden" data-nav-trap></div>' + drawer
    byId('hidden').checkVisibility = () => false
    expect(activeNavTrap()?.id).toBe('drawer')
    document.body.innerHTML = '<main><button>Page</button></main>'
    expect(activeNavTrap()).toBeNull()
  })

  it('ignores a keyboard outside an open dialog and keeps one inside it', () => {
    document.body.innerHTML = '<dialog id="dialog" open><button>OK</button></dialog>' + keyboard
    oskOpen.set(true)
    expect(activeNavTrap()?.id).toBe('dialog')
    document.body.innerHTML = `<dialog id="dialog" open><button>OK</button>${keyboard}</dialog>`
    expect(activeNavTrap()?.id).toBe('osk')
  })

  it('ignores a fading keyboard and a fading layer', () => {
    document.body.innerHTML = drawer + menu + `<div inert>${keyboard}</div>`
    pushLayer('menu')
    oskOpen.set(true)
    expect(activeNavTrap()?.id).toBe('menu')
    byId('menu').setAttribute('inert', '')
    expect(activeNavTrap()?.id).toBe('drawer')
  })
})

describe('cancelModalDialog', () => {
  type Closable = { close?: (returnValue?: string) => void }
  const proto = HTMLDialogElement.prototype as unknown as Closable
  const realClose = proto.close
  beforeEach(() => {
    // jsdom 30 implements neither showModal() nor close().
    proto.close = function () { (this as unknown as HTMLDialogElement).removeAttribute('open') }
  })
  afterEach(() => {
    if (realClose) proto.close = realClose
    else delete proto.close
  })

  it('closes a dialog whose cancel event nobody prevents', () => {
    document.body.innerHTML = '<dialog id="d" open></dialog>'
    const dialog = byId('d') as HTMLDialogElement
    const cancel = vi.fn()
    dialog.addEventListener('cancel', cancel)
    expect(cancelModalDialog(dialog)).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(dialog.hasAttribute('open')).toBe(false)
  })

  it('leaves a busy dialog open when its cancel handler prevents it', () => {
    document.body.innerHTML = '<dialog id="d" open></dialog>'
    const dialog = byId('d') as HTMLDialogElement
    dialog.addEventListener('cancel', (event) => event.preventDefault())
    expect(cancelModalDialog(dialog)).toBe(false)
    expect(dialog.hasAttribute('open')).toBe(true)
  })
})

describe('d-pad navigation through the trap resolver', () => {
  // jsdom has no layout: rects come from `data-rect` (left,top,width,height).
  function rectOf(this: Element): DOMRect {
    const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
  }
  const realRect = Element.prototype.getBoundingClientRect
  const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

  beforeAll(() => { initDpadNav() })
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = rectOf
    window.scrollBy = vi.fn() as unknown as typeof window.scrollBy
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
    HTMLElement.prototype.scrollBy = vi.fn() as unknown as HTMLElement['scrollBy']
    HTMLElement.prototype.scrollTo = vi.fn() as unknown as HTMLElement['scrollTo']
    setFocusHint(null)
  })
  afterEach(() => { Element.prototype.getBoundingClientRect = realRect })

  it('confines arrows to the top layer even when a legacy trap comes first in the page', () => {
    document.body.innerHTML = `
      <div id="drawer" data-nav-trap data-nav-escape><a href="/app/home" data-focusable data-rect="0,0,200,40" id="drawer-link">Home</a></div>
      <div id="menu" data-nav-trap data-nav-escape>
        <button data-focusable data-rect="400,100,200,40" id="one">One</button>
        <button data-focusable data-rect="400,150,200,40" id="two">Two</button>
      </div>`
    pushLayer('menu')
    byId('one').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(byId('two'))
    press('ArrowDown')
    expect(document.activeElement).toBe(byId('two'))
  })

  it('lands the first press on the focus hint instead of the first control, once', () => {
    document.body.innerHTML = `
      <main>
        <button data-focusable data-rect="100,100,200,40" id="search">Search</button>
        <button data-focusable data-rect="100,300,200,40" id="sort">Sort</button>
      </main>`
    setFocusHint(byId('sort'))
    press('ArrowDown')
    expect(document.activeElement).toBe(byId('sort'))
    byId('sort').blur()
    press('ArrowDown')
    expect(document.activeElement).toBe(byId('search'))
  })

  it('ignores a hint outside the open trap', () => {
    document.body.innerHTML = `
      <button data-focusable data-rect="100,100,200,40" id="page-button">Page</button>
      <div data-nav-trap id="dialog"><button data-focusable data-rect="400,100,200,40" id="dialog-button">OK</button></div>`
    setFocusHint(byId('page-button'))
    press('ArrowDown')
    expect(document.activeElement).toBe(byId('dialog-button'))
  })
})
