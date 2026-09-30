// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { moveRowKeepingFocus } from './home-row-move'

// The Home editor's Move up/down under the d-pad (spec §4): the keyed move re-inserts the row,
// which blurs the pressed button, so focus must come back to the same button of the moved row.

const row = (id: string, index: number, count: number) => `
  <section data-home-row="${id}">
    <button data-focusable data-row-move="up" aria-disabled="${index <= 0}">Move ${id} up</button>
    <button data-focusable data-row-move="down" aria-disabled="${index >= count - 1}">Move ${id} down</button>
  </section>`
const render = (ids: string[]) => { document.body.innerHTML = ids.map((id, index) => row(id, index, ids.length)).join('') }
const button = (id: string, direction: 'up' | 'down') =>
  document.querySelector<HTMLElement>(`[data-home-row="${id}"] [data-row-move="${direction}"]`)!

afterEach(() => { document.body.replaceChildren() })

describe('moveRowKeepingFocus', () => {
  it('focuses the same button of the moved row after a re-insert blurs the pressed one', async () => {
    render(['trending', 'seasonal:now'])
    const pressed = button('trending', 'down')
    pressed.focus()
    const move = vi.fn(() => render(['seasonal:now', 'trending']))
    await moveRowKeepingFocus(pressed, 'trending', move)
    expect(move).toHaveBeenCalledTimes(1)
    expect(pressed.isConnected).toBe(false)
    expect(document.activeElement).toBe(button('trending', 'down'))
  })

  it('finds a row whose id needs escaping in a selector', async () => {
    render(['trending', 'seasonal:now'])
    const pressed = button('seasonal:now', 'up')
    pressed.focus()
    await moveRowKeepingFocus(pressed, 'seasonal:now', () => render(['seasonal:now', 'trending']))
    expect(document.activeElement).toBe(button('seasonal:now', 'up'))
  })

  it('does nothing at either end (aria-disabled), and the button keeps focus', async () => {
    render(['trending', 'seasonal:now'])
    const pressed = button('trending', 'up')
    pressed.focus()
    const move = vi.fn()
    await moveRowKeepingFocus(pressed, 'trending', move)
    expect(move).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(pressed)
  })

  it('leaves focus alone after a mouse or touch press (the button never held focus)', async () => {
    render(['trending', 'seasonal:now'])
    const move = vi.fn(() => render(['seasonal:now', 'trending']))
    await moveRowKeepingFocus(button('trending', 'down'), 'trending', move)
    expect(move).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(document.body)
  })
})
