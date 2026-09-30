// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isTv } from '$lib/platform'
import { inputType } from './input'
import { describeFocus, focusRestoreAllowed, handFocusBack, resolveFocus, restoreFocus } from './focus-memory'
import { peekFocusHint, setFocusHint, takeFocusHint } from './focus-hint'

const byId = (id: string) => document.getElementById(id) as HTMLElement
const one = (selector: string) => document.querySelector(selector) as HTMLElement

beforeEach(() => {
  inputType.set('mouse')
  isTv.set(false)
  setFocusHint(null)
})
afterEach(() => { document.body.replaceChildren() })

describe('describeFocus', () => {
  it('describes nothing for no element or the page body', () => {
    expect(describeFocus(null)).toBeNull()
    expect(describeFocus(undefined)).toBeNull()
    expect(describeFocus(document.body)).toBeNull()
  })

  it('records every key the resolver can use', () => {
    history.replaceState(null, '', '/app/settings/player?tab=video')
    document.body.innerHTML = `
      <aside data-nav-region="settings"><a id="rail-player" href="/app/settings/player" data-focusable>Player</a></aside>
      <section data-setting-key="player-seek">
        <button data-focusable data-nav-id="seek-trigger" aria-label="Seek   step">10 s</button>
      </section>`
    const seek = describeFocus(one('[data-nav-id="seek-trigger"]'))
    expect(seek).toMatchObject({
      navId: 'seek-trigger',
      settingKey: 'player-seek',
      tag: 'BUTTON',
      label: 'Seek step',
      labelIndex: 0,
      path: '/app/settings/player?tab=video',
    })
    expect(seek?.id).toBeUndefined()
    expect(seek?.href).toBeUndefined()
    expect(describeFocus(byId('rail-player'))).toMatchObject({
      id: 'rail-player', href: '/app/settings/player', region: 'settings', label: 'Player',
    })
  })

  it('numbers controls that share a tag and a label', () => {
    document.body.innerHTML = '<button data-focusable>Edit</button><button data-focusable>Edit</button>'
    expect(describeFocus(document.querySelectorAll('button')[1])?.labelIndex).toBe(1)
    // Only elements that can take focus are numbered: a plain container with the same text is not.
    document.body.innerHTML = '<div>Edit</div><div id="card" role="button" tabindex="0" data-focusable>Edit</div>'
    expect(describeFocus(byId('card'))?.labelIndex).toBe(0)
  })
})

describe('resolveFocus', () => {
  const describeThenRerender = (markup: string, selector: string, next: string) => {
    document.body.innerHTML = markup
    const descriptor = describeFocus(one(selector))!
    document.body.innerHTML = next
    return descriptor
  }

  it('prefers data-nav-id, then id, then href', () => {
    const byNavId = describeThenRerender(
      '<button data-focusable data-nav-id="a">Old label</button>', 'button',
      '<button data-focusable>Old label</button><button data-focusable data-nav-id="a" id="target">New label</button>')
    expect(resolveFocus(byNavId)?.id).toBe('target')
    const byElementId = describeThenRerender(
      '<button data-focusable id="save">Save</button>', 'button',
      '<button data-focusable>Save</button><button data-focusable id="save">Saved</button>')
    expect(resolveFocus(byElementId)?.id).toBe('save')
    const byHref = describeThenRerender(
      '<a data-focusable href="/app/settings/store">Store</a>', 'a',
      '<a data-focusable href="/app/settings/sources">Store</a><a data-focusable href="/app/settings/store" id="target">Store</a>')
    expect(resolveFocus(byHref)?.id).toBe('target')
  })

  it('finds the same control inside its setting row, else the row’s first control', () => {
    const descriptor = describeThenRerender(
      '<div data-setting-key="sync"><button data-focusable>Toggle</button><button data-focusable>Remove</button></div>',
      '[data-setting-key] button:nth-child(2)',
      '<div data-setting-key="sync"><button data-focusable id="toggle">Toggle</button><button data-focusable id="remove">Remove</button></div>')
    expect(resolveFocus(descriptor)?.id).toBe('remove')
    expect(resolveFocus({ ...descriptor, label: 'Delete' })?.id).toBe('toggle')
  })

  it('matches tag, label and index when no key survives', () => {
    const descriptor = describeThenRerender(
      '<button data-focusable>Edit</button><button data-focusable>Edit</button>', 'button:nth-child(2)',
      '<button data-focusable id="first">Edit</button><button data-focusable id="second">Edit</button>')
    expect(resolveFocus(descriptor)?.id).toBe('second')
  })

  it('recovers a replaced control through its nearest keyed ancestor when the label changed', () => {
    const descriptor = describeThenRerender(
      '<section id="layout-node"><div><button data-focusable>Edit</button></div></section>', 'button',
      '<section id="layout-node"><div><button data-focusable id="done">Done</button></div></section>')
    expect(resolveFocus(descriptor)?.id).toBe('done')
  })

  it('never lands on a disabled or inert control, and finds nothing when nothing matches', () => {
    const descriptor = describeThenRerender(
      '<button data-focusable data-nav-id="x">Go</button>', 'button',
      '<button data-focusable data-nav-id="x" disabled>Go</button><div inert><button data-focusable>Go</button></div>')
    expect(resolveFocus(descriptor)).toBeNull()
  })

  it('searches only inside the given root', () => {
    document.body.innerHTML = '<div id="a"><button data-focusable data-nav-id="k">A</button></div><div id="b"><button data-focusable data-nav-id="k" id="in-b">A</button></div>'
    const descriptor = describeFocus(one('#a button'))!
    expect(resolveFocus(descriptor, byId('b'))?.id).toBe('in-b')
  })
})

describe('restoreFocus', () => {
  it('focuses the resolved control without scrolling and returns it', () => {
    document.body.innerHTML = '<button data-focusable data-nav-id="k" id="k">K</button>'
    const descriptor = describeFocus(byId('k'))!
    const target = byId('k')
    const calls: Array<FocusOptions | undefined> = []
    target.focus = (options?: FocusOptions) => {
      calls.push(options)
      HTMLElement.prototype.focus.call(target, options)
    }
    expect(restoreFocus(descriptor)).toBe(target)
    expect(calls).toEqual([{ preventScroll: true }])
    expect(document.activeElement).toBe(target)
  })

  it('does nothing without a descriptor', () => {
    expect(restoreFocus(null)).toBeNull()
    expect(restoreFocus(undefined)).toBeNull()
  })
})

describe('focusRestoreAllowed', () => {
  it('allows a restore for the d-pad and on TV only', () => {
    expect(focusRestoreAllowed()).toBe(false)
    inputType.set('touch')
    expect(focusRestoreAllowed()).toBe(false)
    inputType.set('dpad')
    expect(focusRestoreAllowed()).toBe(true)
    inputType.set('mouse')
    isTv.set(true)
    expect(focusRestoreAllowed()).toBe(true)
  })
})

describe('handFocusBack', () => {
  const setup = () => {
    document.body.innerHTML = '<button data-focusable id="quality">High</button><button data-focusable id="other">Other</button>'
    byId('other').focus()
  }

  it('focuses the target on the d-pad and on TV', () => {
    setup()
    inputType.set('dpad')
    handFocusBack(byId('quality'))
    expect(document.activeElement).toBe(byId('quality'))
    expect(peekFocusHint()).toBeNull()
    setup()
    inputType.set('mouse')
    isTv.set(true)
    handFocusBack(byId('quality'))
    expect(document.activeElement).toBe(byId('quality'))
  })

  it('leaves a hint for the first d-pad press after a mouse or touch answer', () => {
    for (const input of ['mouse', 'touch'] as const) {
      setup()
      inputType.set(input)
      handFocusBack(byId('quality'))
      expect(document.activeElement, input).toBe(byId('other'))
      expect(takeFocusHint(), input).toBe(byId('quality'))
    }
  })

  it('does nothing without a target', () => {
    setup()
    inputType.set('dpad')
    handFocusBack(null)
    handFocusBack(undefined)
    expect(document.activeElement).toBe(byId('other'))
    expect(peekFocusHint()).toBeNull()
  })
})

describe('focus hint', () => {
  it('hands the hint out once', () => {
    document.body.innerHTML = '<button data-focusable id="opener">Sort</button>'
    setFocusHint(byId('opener'))
    expect(peekFocusHint()).toBe(byId('opener'))
    expect(takeFocusHint()).toBe(byId('opener'))
    expect(peekFocusHint()).toBeNull()
    expect(takeFocusHint()).toBeNull()
  })

  it('drops a hint that is gone, outside the root, disabled or inert', () => {
    document.body.innerHTML = '<div id="page"><button id="a">A</button><button id="b" disabled>B</button><div inert><button id="c">C</button></div></div><div id="dialog"></div>'
    setFocusHint(document.createElement('button'))
    expect(takeFocusHint()).toBeNull()
    setFocusHint(byId('a'))
    expect(takeFocusHint(byId('dialog'))).toBeNull()
    expect(peekFocusHint()).toBeNull()
    setFocusHint(byId('b'))
    expect(takeFocusHint()).toBeNull()
    setFocusHint(byId('c'))
    expect(takeFocusHint()).toBeNull()
    setFocusHint(byId('a'))
    expect(takeFocusHint(byId('page'))).toBe(byId('a'))
  })
})
