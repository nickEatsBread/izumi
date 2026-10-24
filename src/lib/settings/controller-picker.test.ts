// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { centrePickerValue } from './controller-picker'

const scrolled: Array<{ el: Element; options: unknown }> = []

beforeEach(() => {
  scrolled.length = 0
  Element.prototype.scrollIntoView = function (this: Element, options?: unknown) { scrolled.push({ el: this, options }) } as Element['scrollIntoView']
  document.body.innerHTML = `
    <div id="list">
      <button data-select-value="en">English</button>
      <button data-select-value="ja">Japanese</button>
      <button data-select-value="fr" disabled>French</button>
    </div>`
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('centrePickerValue (spec §3.5)', () => {
  it('centres the current value’s row in the list', () => {
    const list = document.getElementById('list')!
    const row = centrePickerValue(list, 'ja')
    expect(row?.textContent).toBe('Japanese')
    expect(scrolled).toEqual([{ el: row, options: { block: 'center' } }])
  })

  it('does nothing for a value with no row', () => {
    expect(centrePickerValue(document.getElementById('list')!, 'de')).toBeNull()
    expect(scrolled).toEqual([])
  })
})
