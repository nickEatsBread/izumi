// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { centrePickerValue, openingOption, stepMenuOption } from './controller-picker'

const scrolled: Array<{ el: Element; options: unknown }> = []

beforeEach(() => {
  scrolled.length = 0
  Element.prototype.scrollIntoView = function (this: Element, options?: unknown) { scrolled.push({ el: this, options }) } as Element['scrollIntoView']
  document.body.innerHTML = `
    <div id="list">
      <button data-select-value="en">English</button>
      <button data-select-value="ja">Japanese</button>
      <button data-select-value="fr" disabled>French</button>
      <button data-select-value="de">German</button>
    </div>`
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

const list = () => document.getElementById('list')!
const row = (value: string) => list().querySelector<HTMLElement>(`[data-select-value="${value}"]`)!

describe('openingOption', () => {
  it('opens on the current value’s row', () => {
    expect(openingOption(list(), 'ja')).toBe(row('ja'))
  })

  it('falls back to the first enabled row for a disabled or missing value', () => {
    expect(openingOption(list(), 'fr')).toBe(row('en'))
    expect(openingOption(list(), 'xx')).toBe(row('en'))
  })

  it('is null for an empty list', () => {
    expect(openingOption(document.createElement('div'), 'en')).toBeNull()
  })
})

describe('centrePickerValue (spec §3.5)', () => {
  it('centres the current value’s row in the list', () => {
    const centred = centrePickerValue(list(), 'ja')
    expect(centred?.textContent).toBe('Japanese')
    expect(scrolled).toEqual([{ el: centred, options: { block: 'center' } }])
  })

  it('centres the row that takes focus when the current value is disabled', () => {
    expect(centrePickerValue(list(), 'fr')).toBe(row('en'))
    expect(scrolled).toEqual([{ el: row('en'), options: { block: 'center' } }])
  })

  it('does nothing for a list with no rows', () => {
    expect(centrePickerValue(document.createElement('div'), 'de')).toBeNull()
    expect(scrolled).toEqual([])
  })
})

describe('stepMenuOption', () => {
  it('steps over disabled options and wraps at both ends', () => {
    row('ja').focus()
    expect(stepMenuOption(list(), 1, false)).toBe(row('de'))
    expect(document.activeElement).toBe(row('de'))
    expect(stepMenuOption(list(), 1, false)).toBe(row('en'))
    expect(stepMenuOption(list(), -1, false)).toBe(row('de'))
  })

  it('enters the list from outside it at the first or last option', () => {
    expect(stepMenuOption(list(), 1, false)).toBe(row('en'))
    row('en').blur()
    expect(stepMenuOption(list(), -1, false)).toBe(row('de'))
  })

  it('walks only the open panel, which the portalled picker keeps outside the trigger’s root', () => {
    const panel = document.createElement('div')
    panel.innerHTML = '<button data-select-value="a">A</button><button data-select-value="b">B</button>'
    document.body.append(panel)
    panel.querySelector<HTMLElement>('[data-select-value="a"]')!.focus()
    expect(stepMenuOption(panel, 1, false)?.textContent).toBe('B')
    expect(stepMenuOption(panel, 1, false)?.textContent).toBe('A')
  })

  it('scrolls the new option into the list only when asked to reveal it', () => {
    row('en').focus()
    stepMenuOption(list(), 1, false)
    expect(scrolled).toEqual([])
    stepMenuOption(list(), 1, true)
    expect(scrolled).toEqual([{ el: row('de'), options: { block: 'nearest' } }])
  })

  it('does nothing in a panel with no enabled options', () => {
    expect(stepMenuOption(document.createElement('div'), 1, true)).toBeUndefined()
    expect(scrolled).toEqual([])
  })
})
