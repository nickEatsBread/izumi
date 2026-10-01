// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { NON_TEXT_INPUT_TYPES, isTextEntryField } from './text-field'

const input = (attributes: string) => {
  document.body.innerHTML = `<input ${attributes}>`
  return document.querySelector('input')!
}

afterEach(() => { document.body.replaceChildren() })

describe('isTextEntryField', () => {
  it.each(['', 'type="text"', 'type="search"', 'type="url"', 'type="email"', 'type="tel"', 'type="password"', 'type="number"', 'type="bogus"'])(
    'accepts <input %s>',
    (attributes) => {
      expect(isTextEntryField(input(attributes))).toBe(true)
    },
  )

  it.each([...NON_TEXT_INPUT_TYPES])('rejects type=%s', (type) => {
    expect(isTextEntryField(input(`type="${type}"`))).toBe(false)
  })

  it('lists exactly the controls, pickers and hidden inputs the keyboard must never open on', () => {
    expect([...NON_TEXT_INPUT_TYPES].sort()).toEqual([
      'button', 'checkbox', 'color', 'date', 'datetime-local', 'file', 'hidden', 'image', 'month',
      'radio', 'range', 'reset', 'submit', 'time', 'week',
    ])
  })

  it('accepts a textarea and rejects read-only, disabled and clipboard-proxy fields', () => {
    document.body.innerHTML = `
      <textarea id="notes"></textarea>
      <textarea id="copy" readonly data-clipboard-proxy="true"></textarea>
      <input id="locked" readonly>
      <input id="off" disabled>
      <input id="proxy" data-clipboard-proxy>`
    expect(isTextEntryField(document.getElementById('notes'))).toBe(true)
    for (const id of ['copy', 'locked', 'off', 'proxy']) expect(isTextEntryField(document.getElementById(id)), id).toBe(false)
  })

  it('rejects everything that is not an input or a textarea', () => {
    document.body.innerHTML = '<select id="s"><option>A</option></select><div id="rich" contenteditable="true"></div><button id="b">b</button>'
    for (const id of ['s', 'rich', 'b']) expect(isTextEntryField(document.getElementById(id)), id).toBe(false)
    expect(isTextEntryField(null)).toBe(false)
    expect(isTextEntryField(undefined)).toBe(false)
    expect(isTextEntryField(window)).toBe(false)
    expect(isTextEntryField(document)).toBe(false)
  })
})
