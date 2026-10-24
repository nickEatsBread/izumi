// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { centrePickerValue, openingOption, stepMenuOption } from './controller-picker'

// The picker's markup: a fixed panel (itself a nav scroll container) around the capped list.
// jsdom has no layout, so the list port spans 100-180 px (two 40 px rows) and each row's box
// follows the list's scrollTop. jsdom does not clamp scrollTop, so the tests check the aim.
const ROW = 40
const PORT = { top: 100, bottom: 180 }

beforeEach(() => {
  document.body.innerHTML = `
    <div id="panel" data-nav-scroll-container data-select-picker>
      <div id="list" data-nav-scroll-container>
        <button data-select-value="en">English</button>
        <button data-select-value="ja">Japanese</button>
        <button data-select-value="fr" disabled>French</button>
        <button data-select-value="de">German</button>
      </div>
    </div>`
  const port = list()
  port.getBoundingClientRect = () => PORT as DOMRect
  port.querySelectorAll<HTMLElement>('[data-select-value]').forEach((el, i) => {
    el.getBoundingClientRect = () => {
      const top = PORT.top + i * ROW - port.scrollTop
      return { top, bottom: top + ROW } as DOMRect
    }
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

const list = () => document.getElementById('list')!
const panel = () => document.getElementById('panel')!
const row = (value: string) => list().querySelector<HTMLElement>(`[data-select-value="${value}"]`)!
const centreOf = (el: HTMLElement) => { const box = el.getBoundingClientRect(); return (box.top + box.bottom) / 2 }

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
    const centred = centrePickerValue(panel(), 'de')
    expect(centred?.textContent).toBe('German')
    expect(list().scrollTop).toBe(100)
    expect(centreOf(row('de'))).toBe((PORT.top + PORT.bottom) / 2)
  })

  it('centres the row that takes focus when the current value is disabled', () => {
    list().scrollTop = 80
    expect(centrePickerValue(panel(), 'fr')).toBe(row('en'))
    expect(centreOf(row('en'))).toBe((PORT.top + PORT.bottom) / 2)
  })

  it('scrolls only the list, never the fixed picker panel or the window behind it', () => {
    // jsdom has no scrollIntoView: install a spy for this test only and put the prototype back after.
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    onTestFinished(() => {
      if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original)
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    })
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    centrePickerValue(panel(), 'de')
    expect(panel().scrollTop).toBe(0)
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(windowScroll).not.toHaveBeenCalled()
  })

  it('does nothing for a list with no rows', () => {
    expect(centrePickerValue(document.createElement('div'), 'de')).toBeNull()
    expect(list().scrollTop).toBe(0)
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
    const other = document.createElement('div')
    other.innerHTML = '<button data-select-value="a">A</button><button data-select-value="b">B</button>'
    document.body.append(other)
    other.querySelector<HTMLElement>('[data-select-value="a"]')!.focus()
    expect(stepMenuOption(other, 1, false)?.textContent).toBe('B')
    expect(stepMenuOption(other, 1, false)?.textContent).toBe('A')
  })

  it('scrolls the new option just into the list, and only when asked to reveal it', () => {
    row('en').focus()
    stepMenuOption(panel(), 1, true)
    expect(list().scrollTop).toBe(0) // Japanese is already in view
    stepMenuOption(panel(), 1, false)
    expect(list().scrollTop).toBe(0)
    row('ja').focus()
    stepMenuOption(panel(), 1, true)
    expect(list().scrollTop).toBe(80) // German's bottom edge on the list's bottom edge
    stepMenuOption(panel(), 1, true)
    expect(list().scrollTop).toBe(0) // wrapped to English, top edge on the list's top edge
    expect(panel().scrollTop).toBe(0)
  })

  it('does nothing in a panel with no enabled options', () => {
    expect(stepMenuOption(document.createElement('div'), 1, true)).toBeUndefined()
    expect(list().scrollTop).toBe(0)
  })
})
