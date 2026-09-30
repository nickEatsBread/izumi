// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { padActivate } from './pad-controls'

const byId = (id: string) => document.getElementById(id) as HTMLElement
afterEach(() => { document.body.replaceChildren() })

describe('padActivate', () => {
  it('clicks the focused control by default', () => {
    document.body.innerHTML = '<button id="b">Go</button>'
    const click = vi.fn()
    byId('b').addEventListener('click', click)
    byId('b').focus()
    expect(padActivate()).toBe(true)
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('has nothing to act on with an explicit null, no focus or the page body', () => {
    document.body.innerHTML = '<button id="b">Go</button>'
    const click = vi.fn()
    byId('b').addEventListener('click', click)
    byId('b').focus()
    // null means "nothing", not "the focused element".
    expect(padActivate(null)).toBe(false)
    expect(click).not.toHaveBeenCalled()
    byId('b').blur()
    expect(padActivate()).toBe(false)
    expect(padActivate(document.body)).toBe(false)
  })

  it('consumes the press on a disabled control without clicking it', () => {
    document.body.innerHTML = '<button id="native" disabled>A</button><div id="aria" role="button" aria-disabled="true" tabindex="0">B</div>'
    const click = vi.fn()
    document.body.addEventListener('click', click)
    expect(padActivate(byId('native'))).toBe(true)
    expect(padActivate(byId('aria'))).toBe(true)
    expect(click).not.toHaveBeenCalled()
  })

  it('leaves a range alone (Left and Right step it)', () => {
    document.body.innerHTML = '<input id="r" type="range" min="0" max="10" value="5">'
    const events = vi.fn()
    byId('r').addEventListener('click', events)
    byId('r').addEventListener('input', events)
    expect(padActivate(byId('r'))).toBe(true)
    expect(events).not.toHaveBeenCalled()
    expect((byId('r') as HTMLInputElement).value).toBe('5')
  })

  it('toggles a summary’s details open and shut', () => {
    document.body.innerHTML = '<details id="d"><summary id="s" data-focusable tabindex="0">More</summary><p>Body</p></details>'
    const details = byId('d') as HTMLDetailsElement
    expect(padActivate(byId('s'))).toBe(true)
    expect(details.open).toBe(true)
    expect(padActivate(byId('s'))).toBe(true)
    expect(details.open).toBe(false)
  })

  it('toggles a summary even where a synthetic click does not', () => {
    document.body.innerHTML = '<details id="d"><summary id="s">More</summary></details>'
    byId('s').click = () => {}
    expect(padActivate(byId('s'))).toBe(true)
    expect((byId('d') as HTMLDetailsElement).open).toBe(true)
  })

  it('clicks checkboxes and custom buttons', () => {
    document.body.innerHTML = '<input id="c" type="checkbox"><div id="card" role="button" tabindex="0" data-focusable>Card</div>'
    const card = vi.fn()
    byId('card').addEventListener('click', card)
    padActivate(byId('c'))
    padActivate(byId('card'))
    expect((byId('c') as HTMLInputElement).checked).toBe(true)
    expect(card).toHaveBeenCalledTimes(1)
  })
})
