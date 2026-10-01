// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { gameMode, oskOpen, playerOverlayRev, playing } from '$lib/player/session'
import { isTv } from '$lib/platform'
import { controllerMode, initInput, inputType } from './input'
import { deckKeyboardWarning, dismissDeckKeyboardWarning, warnBeforeThirdPartyLogin } from '$lib/deck/keyboard-warning'
import {
  closeOsk, currentOskPolicy, implicitSubmitTarget, isOskTarget, openOskForField, openRemoteOsk, oskBackspace,
  oskDone, oskEcho, oskInsert, oskLayoutFor, oskPolicy, oskSession, resetOskForTests, startOsk,
} from './osk'

// The on-screen keyboard's rules (osk.ts). OnScreenKeyboard.svelte is only a view and vitest has no
// Svelte plugin, so a test that needs the keys builds the markup the view renders: a
// `[data-osk][data-nav-trap]` root holding `[data-focusable]` buttons (KEYS below).

function rectOf(this: Element): DOMRect {
  const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}
const originalRect = Element.prototype.getBoundingClientRect
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const input = (id: string) => byId<HTMLInputElement>(id)
const KEYS = '<div data-osk data-nav-trap aria-label="On-screen keyboard"><button id="key" data-focusable data-rect="100,600,52,44">q</button></div>'

beforeEach(() => {
  Element.prototype.getBoundingClientRect = rectOf
  gameMode.set(false)
  isTv.set(false)
  controllerMode.set(false)
  inputType.set('mouse')
  playing.set(false)
  oskOpen.set(false)
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect
  document.body.replaceChildren()
})

describe('oskPolicy', () => {
  it.each([
    [true, false, false, 'activate'],
    [true, true, true, 'activate'],
    [false, true, true, 'focus-legacy'],
    [false, true, false, 'focus-legacy'],
    [false, false, true, 'activate'],
    [false, false, false, 'off'],
  ] as const)('gameMode %s, isTv %s, controllerMode %s → %s', (game, tv, controller, policy) => {
    expect(oskPolicy({ gameMode: game, isTv: tv, controllerMode: controller })).toBe(policy)
  })

  it('reads the live stores', () => {
    expect(currentOskPolicy()).toBe('off')
    controllerMode.set(true)
    expect(currentOskPolicy()).toBe('activate')
    isTv.set(true)
    expect(currentOskPolicy()).toBe('focus-legacy')
    gameMode.set(true)
    expect(currentOskPolicy()).toBe('activate')
  })
})

describe('oskLayoutFor', () => {
  it.each([
    ['<input id="f" inputmode="numeric">', 'numeric'],
    ['<input id="f" inputmode="decimal">', 'numeric'],
    ['<input id="f" inputmode="tel">', 'numeric'],
    ['<input id="f" type="number">', 'numeric'],
    ['<input id="f" type="tel">', 'numeric'],
    ['<input id="f" type="password" inputmode="numeric">', 'numeric'],
    ['<input id="f">', 'text'],
    ['<input id="f" type="email" inputmode="email">', 'text'],
    ['<input id="f" type="search">', 'text'],
    ['<textarea id="f"></textarea>', 'text'],
  ] as const)('%s → %s', (markup, layout) => {
    document.body.innerHTML = markup
    expect(oskLayoutFor(input('f'))).toBe(layout)
  })
})

describe('isOskTarget', () => {
  it('is true for the keyboard and anything inside it, false elsewhere', () => {
    document.body.innerHTML = KEYS + '<button id="page">Page</button>'
    expect(isOskTarget(byId('key'))).toBe(true)
    expect(isOskTarget(document.querySelector('[data-osk]'))).toBe(true)
    expect(isOskTarget(byId('page'))).toBe(false)
    expect(isOskTarget(window)).toBe(false)
    expect(isOskTarget(null)).toBe(false)
  })
})

describe('implicitSubmitTarget (decision 6)', () => {
  it('the last field of a form presses its enabled default button; an earlier field does not', () => {
    document.body.innerHTML = '<form><input id="a"><input id="b" type="password"><button id="cancel" type="button">Cancel</button><button id="go">Go</button></form>'
    expect(implicitSubmitTarget(input('b'))).toBe(byId('go'))
    expect(implicitSubmitTarget(input('a'))).toBeNull()
  })

  it('a disabled default button means nothing happens, even with a later enabled one', () => {
    document.body.innerHTML = '<form><input id="pin" maxlength="6"><button type="submit" disabled>Continue</button><button type="submit">Other</button></form>'
    expect(implicitSubmitTarget(input('pin'))).toBeNull()
  })

  it('one field and no button submits the form itself; two fields and no button do nothing', () => {
    document.body.innerHTML = '<form id="one"><input id="only"></form><form id="two"><input id="x"><input id="y"></form>'
    expect(implicitSubmitTarget(input('only'))).toBe(byId<HTMLFormElement>('one'))
    expect(implicitSubmitTarget(input('y'))).toBeNull()
  })

  it('an input[type=submit] is a default button, and a checkbox does not block submission', () => {
    document.body.innerHTML = '<form><input id="name"><input type="checkbox"><input id="send" type="submit" value="Send"></form>'
    expect(implicitSubmitTarget(input('name'))).toBe(byId('send'))
  })

  it('never for a textarea or a field outside a form', () => {
    document.body.innerHTML = '<form><textarea id="t"></textarea><button>Go</button></form><input id="loose">'
    expect(implicitSubmitTarget(byId<HTMLTextAreaElement>('t'))).toBeNull()
    expect(implicitSubmitTarget(input('loose'))).toBeNull()
  })
})

describe('keyboard sessions', () => {
  beforeEach(() => {
    resetOskForTests()
    gameMode.set(true)
  })
  afterEach(() => resetOskForTests())

  it('opens through the opt-in call only while a controller policy applies', () => {
    document.body.innerHTML = '<input id="f" aria-label="Search">'
    const field = input('f')
    gameMode.set(false)
    expect(openOskForField(field)).toBe(false)
    expect(get(oskSession)).toBeNull()
    gameMode.set(true)
    expect(openOskForField(field)).toBe(true)
    expect(get(oskSession)).toEqual({ kind: 'field', field, policy: 'activate', layout: 'text', initialValue: '', draft: '' })
    expect(get(oskOpen)).toBe(true)
    expect(get(oskEcho)).toEqual({ label: 'Search', value: '', masked: false })
  })

  it.each([
    '<input id="f" readonly>',
    '<input id="f" type="file">',
    '<input id="f" type="checkbox">',
    '<textarea id="f" data-clipboard-proxy="true"></textarea>',
    '<input id="f" disabled>',
  ])('never serves %s', (markup) => {
    document.body.innerHTML = markup
    expect(openOskForField(input('f'))).toBe(false)
    expect(get(oskSession)).toBeNull()
  })

  it('leaves a date field and its value alone', () => {
    document.body.innerHTML = '<input id="d" type="date" value="2026-09-30">'
    expect(openOskForField(input('d'))).toBe(false)
    expect(input('d').value).toBe('2026-09-30')
  })

  it('never opens for a field inside an open modal dialog, where the keyboard would be inert', () => {
    document.body.innerHTML = '<dialog id="modal" open><input id="f"></dialog>'
    const modal = byId<HTMLDialogElement>('modal')
    modal.matches = ((selector: string) => selector === ':modal' || Element.prototype.matches.call(modal, selector)) as HTMLDialogElement['matches']
    expect(openOskForField(input('f'))).toBe(false)
  })

  it('types from the end, then at the caret, firing input only when the value changed', () => {
    document.body.innerHTML = '<input id="f" value="ac">'
    const field = input('f')
    const onInput = vi.fn()
    field.addEventListener('input', onInput)
    openOskForField(field)
    oskInsert('d')
    expect(field.value).toBe('acd')
    field.setSelectionRange(1, 1)
    oskInsert('b')
    expect(field.value).toBe('abcd')
    expect(field.selectionStart).toBe(2)
    oskBackspace()
    expect(field.value).toBe('acd')
    oskInsert('')
    expect(onInput).toHaveBeenCalledTimes(3)
  })

  it('holds a PIN to maxLength on a keypad that drops letters, and masks the echo', () => {
    document.body.innerHTML = '<input id="pin" type="password" inputmode="numeric" maxlength="6">'
    const pin = input('pin')
    const onInput = vi.fn()
    pin.addEventListener('input', onInput)
    openOskForField(pin)
    expect(get(oskSession)).toMatchObject({ layout: 'numeric' })
    oskInsert('1a2b')
    expect(pin.value).toBe('12')
    oskInsert('34567')
    expect(pin.value).toBe('123456')
    oskInsert('8')
    expect(pin.value).toBe('123456')
    expect(onInput).toHaveBeenCalledTimes(2)
    expect(get(oskEcho)).toEqual({ label: '', value: '••••••', masked: true })
  })

  it('keeps a number draft and writes the field only when the draft is a valid number', () => {
    document.body.innerHTML = '<label>Seek <input id="n" type="number" value="10"></label>'
    const field = input('n')
    const onInput = vi.fn()
    field.addEventListener('input', onInput)
    openOskForField(field)
    expect(get(oskSession)).toMatchObject({ layout: 'numeric', draft: '10' })
    oskBackspace()
    oskBackspace()
    expect(field.value).toBe('')
    oskInsert('-')
    expect(field.value).toBe('')
    expect(get(oskEcho)).toEqual({ label: 'Seek', value: '-', masked: false })
    oskInsert('1')
    expect(field.value).toBe('-1')
    oskInsert('.')
    expect(field.value).toBe('-1')
    oskInsert('5')
    expect(field.value).toBe('-1.5')
    // '1', '', '-1', '-1.5'
    expect(onInput).toHaveBeenCalledTimes(4)
  })

  it('returns focus from the keys to the field on close, and fires change only when the value changed', () => {
    document.body.innerHTML = '<input id="f" value="5">' + KEYS
    const field = input('f')
    const onChange = vi.fn()
    field.addEventListener('change', onChange)
    openOskForField(field)
    byId('key').focus()
    closeOsk()
    expect(document.activeElement).toBe(field)
    expect(onChange).not.toHaveBeenCalled()
    expect(get(oskSession)).toBeNull()
    expect(get(oskOpen)).toBe(false)
    expect(get(oskEcho)).toBeNull()
    openOskForField(field)
    oskInsert('0')
    closeOsk()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(field.value).toBe('50')
  })

  it('leaves focus where it is when it already moved to a real control, or when told not to restore', () => {
    document.body.innerHTML = '<input id="f"><button id="other">Other</button>' + KEYS
    const field = input('f')
    openOskForField(field)
    byId('other').focus()
    closeOsk()
    expect(document.activeElement).toBe(byId('other'))
    openOskForField(field)
    byId('key').focus()
    closeOsk({ restore: false })
    expect(document.activeElement).toBe(byId('key'))
  })

  it('falls back to the nearest control when the field is hidden or inert', () => {
    document.body.innerHTML = `
      <button id="above" data-focusable data-rect="100,100,200,40">Above</button>
      <div id="wrap"><input id="f" data-rect="100,200,200,40"></div>
      <button id="far" data-focusable data-rect="100,500,200,40">Far</button>` + KEYS
    const field = input('f')
    openOskForField(field)
    byId('key').focus()
    field.checkVisibility = () => false
    closeOsk()
    expect(document.activeElement).toBe(byId('above'))
    field.checkVisibility = () => true
    openOskForField(field)
    byId('key').focus()
    byId('wrap').setAttribute('inert', '')
    closeOsk()
    expect(document.activeElement).toBe(byId('above'))
  })

  it('Done in the last field commits, sends a cancellable Enter, then presses the enabled default button', () => {
    document.body.innerHTML = '<form id="form"><input id="user"><input id="pass" type="password"><button id="go">Sign in</button></form>' + KEYS
    const pass = input('pass')
    const events: string[] = []
    pass.addEventListener('change', () => events.push('change'))
    pass.addEventListener('keydown', (event) => events.push(`${event.key}:${event.cancelable}:${document.activeElement === pass}`))
    byId<HTMLFormElement>('form').addEventListener('submit', (event) => { event.preventDefault(); events.push('submit') })
    openOskForField(pass)
    oskInsert('pw')
    byId('key').focus()
    oskDone()
    expect(events).toEqual(['change', 'Enter:true:true', 'submit'])
    expect(get(oskSession)).toBeNull()
    expect(document.activeElement).toBe(pass)
  })

  it('Done from an earlier field, with a disabled default button, or after a prevented Enter only closes', () => {
    document.body.innerHTML = '<form id="form"><input id="user"><input id="pin" maxlength="6"><button id="go" disabled>Continue</button></form>'
    const onSubmit = vi.fn((event: Event) => event.preventDefault())
    byId<HTMLFormElement>('form').addEventListener('submit', onSubmit)
    openOskForField(input('user'))
    oskDone()
    openOskForField(input('pin'))
    oskDone()
    byId<HTMLButtonElement>('go').disabled = false
    input('pin').addEventListener('keydown', (event) => event.preventDefault())
    openOskForField(input('pin'))
    oskDone()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(get(oskSession)).toBeNull()
  })

  it('Done never closes a session that its own Enter handler opened on the next field', () => {
    document.body.innerHTML = '<input id="a"><input id="b">' + KEYS
    input('a').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') openOskForField(input('b'))
    })
    openOskForField(input('a'))
    byId('key').focus()
    oskDone()
    expect(get(oskSession)).toMatchObject({ kind: 'field', field: input('b') })
    expect(get(oskOpen)).toBe(true)
  })

  it('drives a remote keyboard (the comments composer) and closes it', () => {
    const remote = { insert: vi.fn(), backspace: vi.fn(), submit: vi.fn(), close: vi.fn() }
    openRemoteOsk(remote)
    expect(get(oskSession)).toEqual({ kind: 'remote', remote, layout: 'text' })
    expect(get(oskOpen)).toBe(true)
    expect(get(oskEcho)).toBeNull()
    oskInsert('hi')
    oskBackspace()
    oskDone()
    expect(remote.insert).toHaveBeenCalledWith('hi')
    expect(remote.backspace).toHaveBeenCalledTimes(1)
    expect(remote.submit).toHaveBeenCalledTimes(1)
    expect(remote.close).toHaveBeenCalledTimes(1)
    expect(get(oskSession)).toBeNull()
  })

  it('moving to another field closes the first session and commits its change', () => {
    document.body.innerHTML = '<input id="a"><input id="b">'
    const onChange = vi.fn()
    input('a').addEventListener('change', onChange)
    openOskForField(input('a'))
    oskInsert('x')
    openOskForField(input('b'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(get(oskSession)).toMatchObject({ kind: 'field', field: input('b') })
  })

  it('closes when its field has gone', () => {
    document.body.innerHTML = '<input id="f">'
    const field = input('f')
    openOskForField(field)
    field.remove()
    oskInsert('a')
    expect(get(oskSession)).toBeNull()
    expect(get(oskOpen)).toBe(false)
  })

  it('closeOsk clears a stale open flag that has no session behind it', () => {
    oskOpen.set(true)
    closeOsk()
    expect(get(oskOpen)).toBe(false)
  })

  it('re-snapshots the Game-mode player overlay on open, typing and close, only during playback', () => {
    document.body.innerHTML = '<input id="f">'
    playing.set(true)
    const start = get(playerOverlayRev)
    openOskForField(input('f'))
    oskInsert('a')
    closeOsk()
    expect(get(playerOverlayRev)).toBe(start + 3)
    playing.set(false)
    openOskForField(input('f'))
    oskInsert('b')
    closeOsk()
    expect(get(playerOverlayRev)).toBe(start + 3)
  })
})

describe('keyboard listeners (startOsk)', () => {
  let stop: () => void = () => {}
  beforeEach(() => {
    resetOskForTests()
    gameMode.set(true)
    stop = startOsk()
  })
  afterEach(() => {
    stop()
    while (get(deckKeyboardWarning)) dismissDeckKeyboardWarning()
    resetOskForTests()
  })

  it('under activate, focus never opens it; a click or a label click does', () => {
    document.body.innerHTML = '<label id="label">Name <input id="f"></label>'
    const field = input('f')
    field.focus()
    expect(get(oskSession)).toBeNull()
    field.click()
    expect(get(oskSession)).toMatchObject({ kind: 'field', field, policy: 'activate' })
    closeOsk()
    byId<HTMLLabelElement>('label').click()
    expect(get(oskSession)).toMatchObject({ field })
    closeOsk()
    gameMode.set(false)
    field.click()
    expect(get(oskSession)).toBeNull()
  })

  it('Android TV keeps focus-to-open, and the focus return on close does not reopen it', () => {
    gameMode.set(false)
    isTv.set(true)
    document.body.innerHTML = '<input id="f" inputmode="numeric">' + KEYS
    const field = input('f')
    field.focus()
    expect(get(oskSession)).toMatchObject({ kind: 'field', field, policy: 'focus-legacy', layout: 'numeric' })
    expect(field.getAttribute('inputmode')).toBe('none')
    byId('key').focus()
    closeOsk()
    expect(document.activeElement).toBe(field)
    expect(get(oskSession)).toBeNull()
    field.click()
    expect(get(oskSession)).toBeNull()
  })

  it('Android TV Done is a plain Enter: no submit and no refocus', () => {
    gameMode.set(false)
    isTv.set(true)
    document.body.innerHTML = '<form id="form"><input id="f"><button>Go</button></form>' + KEYS
    const field = input('f')
    const onSubmit = vi.fn((event: Event) => event.preventDefault())
    const onEnter = vi.fn()
    byId<HTMLFormElement>('form').addEventListener('submit', onSubmit)
    field.addEventListener('keydown', (event) => { if (event.key === 'Enter') onEnter(event.cancelable) })
    field.focus()
    byId('key').focus()
    oskDone()
    expect(onEnter).toHaveBeenCalledWith(false)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(byId('key'))
    expect(get(oskSession)).toBeNull()
  })

  it('Escape, GoBack and BrowserBack close it ahead of every later listener', () => {
    document.body.innerHTML = '<input id="f">' + KEYS
    const field = input('f')
    const later = vi.fn()
    window.addEventListener('keydown', later, true)
    window.addEventListener('keydown', later)
    byId('key').addEventListener('keydown', later)
    try {
      for (const key of ['Escape', 'GoBack', 'BrowserBack']) {
        field.click()
        byId('key').focus()
        byId('key').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
        expect(get(oskSession)).toBeNull()
        expect(document.activeElement).toBe(field)
      }
      field.click()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      expect(get(oskSession)).toBeNull()
      expect(later).not.toHaveBeenCalled()
      // Closed, it lets Escape through again.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      expect(later).toHaveBeenCalledTimes(2)
    } finally {
      window.removeEventListener('keydown', later, true)
      window.removeEventListener('keydown', later)
    }
  })

  it('a physical key types into the field and closes the keyboard', () => {
    document.body.innerHTML = '<input id="f">' + KEYS
    const field = input('f')
    field.value = 'ab'
    field.click()
    byId('key').focus()
    byId('key').dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true }))
    expect(field.value).toBe('abc')
    expect(get(oskSession)).toBeNull()
    expect(document.activeElement).toBe(field)
  })

  it('a press outside the keys closes it without moving focus; a press on the keys does not', () => {
    document.body.innerHTML = '<input id="f"><button id="page">Page</button>' + KEYS
    input('f').click()
    byId('key').focus()
    byId('key').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    expect(get(oskSession)).not.toBeNull()
    byId('page').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    expect(get(oskSession)).toBeNull()
    expect(document.activeElement).toBe(byId('key'))
  })

  it('in Game mode a press on its own field keeps it open', () => {
    document.body.innerHTML = '<input id="f">' + KEYS
    const field = input('f')
    field.click()
    field.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    expect(get(oskSession)).toMatchObject({ field })
  })

  it('osk-remote-open opens a remote session only under a controller policy; osk-close closes it', () => {
    const remote = { insert: vi.fn(), backspace: vi.fn(), submit: vi.fn() }
    gameMode.set(false)
    window.dispatchEvent(new CustomEvent('osk-remote-open', { detail: remote }))
    expect(get(oskSession)).toBeNull()
    gameMode.set(true)
    window.dispatchEvent(new CustomEvent('osk-remote-open', { detail: { insert: remote.insert } }))
    expect(get(oskSession)).toBeNull()
    window.dispatchEvent(new CustomEvent('osk-remote-open', { detail: remote }))
    expect(get(oskSession)).toMatchObject({ kind: 'remote', remote })
    window.dispatchEvent(new Event('osk-close'))
    expect(get(oskSession)).toBeNull()
  })

  it('the Steam keyboard warning closes it and puts focus back on the field', () => {
    document.body.innerHTML = '<input id="f">' + KEYS
    const field = input('f')
    field.click()
    byId('key').focus()
    void warnBeforeThirdPartyLogin('Sign-in', true)
    expect(get(oskSession)).toBeNull()
    expect(document.activeElement).toBe(field)
  })

  it('holds the system IME down for d-pad focus and while open, restores it after, and leaves an unserved field alone', () => {
    document.body.innerHTML = '<input id="pin" type="password" inputmode="numeric"><button id="away">Away</button>' + KEYS
    const pin = input('pin')
    inputType.set('dpad')
    pin.focus()
    expect(pin.getAttribute('inputmode')).toBe('none')
    for (let round = 0; round < 2; round++) {
      pin.click()
      expect(get(oskSession)).toMatchObject({ field: pin, layout: 'numeric' })
      byId('key').focus()
      expect(pin.getAttribute('inputmode')).toBe('none')
      closeOsk()
      expect(document.activeElement).toBe(pin)
      expect(pin.getAttribute('inputmode')).toBe('none')
    }
    byId('away').focus()
    expect(pin.getAttribute('inputmode')).toBe('numeric')
    // A field inside an open modal <dialog> gets no built-in keyboard (it would be inert there), so
    // d-pad focus must leave it its own system keyboard.
    document.body.insertAdjacentHTML('beforeend', '<dialog id="modal" open><input id="inside" inputmode="numeric"></dialog>')
    const modal = byId<HTMLDialogElement>('modal')
    modal.matches = ((selector: string) => selector === ':modal' || Element.prototype.matches.call(modal, selector)) as HTMLDialogElement['matches']
    input('inside').focus()
    expect(input('inside').getAttribute('inputmode')).toBe('numeric')
  })

  it('an outside press gives a touched field its own system keyboard back (a phone with a pad)', () => {
    gameMode.set(false)
    controllerMode.set(true)
    document.body.innerHTML = '<input id="pin" inputmode="numeric"><input id="plain">' + KEYS
    const pin = input('pin')
    pin.click()
    expect(pin.getAttribute('inputmode')).toBe('none')
    pin.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    expect(get(oskSession)).toBeNull()
    expect(pin.getAttribute('inputmode')).toBe('numeric')
    const plain = input('plain')
    inputType.set('dpad')
    plain.focus()
    expect(plain.getAttribute('inputmode')).toBe('none')
    plain.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    expect(plain.hasAttribute('inputmode')).toBe(false)
  })

  it('re-snapshots on d-pad moves between keys during Game-mode playback', () => {
    document.body.innerHTML = '<input id="f">' + KEYS
    playing.set(true)
    input('f').click()
    const before = get(playerOverlayRev)
    byId('key').focus()
    expect(get(playerOverlayRev)).toBe(before + 1)
  })

  it('stops listening once uninstalled', () => {
    stop()
    stop = () => {}
    document.body.innerHTML = '<input id="f">'
    input('f').click()
    expect(get(oskSession)).toBeNull()
  })
})

describe('pointer modality on the keys (input.ts)', () => {
  beforeAll(() => initInput())

  it('a touch on the keys keeps controller mode; a mouse there, or a touch elsewhere, leaves it', () => {
    document.body.innerHTML = '<button id="page">Page</button>' + KEYS
    controllerMode.set(true)
    inputType.set('dpad')
    byId('key').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    expect(get(controllerMode)).toBe(true)
    expect(get(inputType)).toBe('dpad')
    byId('key').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    expect(get(controllerMode)).toBe(false)
    expect(get(inputType)).toBe('mouse')
    controllerMode.set(true)
    byId('page').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    expect(get(controllerMode)).toBe(false)
    expect(get(inputType)).toBe('touch')
  })
})
