// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { isTv } from '$lib/platform'
import { oskOpen } from '$lib/player/session'
import {
  chooseNativePickerOption,
  closeNativePicker,
  commitPickerOption,
  focusPickerRow,
  isPickableSelect,
  nativePicker,
  openNativePicker,
  padOpenPicker,
  pickerKeydown,
  pickerTitle,
  readSelectOptions,
  refreshNativePicker,
  resetNativePickerForTests,
  stepPickerRow,
  watchControl,
} from './native-picker'

const q = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
// jsdom answers `:modal` with false. `answer` decides it per element (throwing models an engine that
// cannot parse the selector); every other selector keeps jsdom's own answer.
const realMatches = Element.prototype.matches
const stubModal = (answer: (el: Element) => boolean) =>
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':modal' ? answer(this) : realMatches.call(this, selector)
  })

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('readSelectOptions', () => {
  it('lists options in DOM order with their groups, skipping hidden ones', () => {
    document.body.innerHTML = `
      <select id="s">
        <option value="" hidden>Pick one</option>
        <option value="a">  Alpha   one </option>
        <optgroup label="Later">
          <option value="b" selected>Beta</option>
          <option value="c" label="Gamma label">ignored text</option>
        </optgroup>
        <optgroup label="Locked" disabled>
          <option value="d">Delta</option>
        </optgroup>
        <option value="e" disabled>Epsilon</option>
      </select>`
    const select = q<HTMLSelectElement>('#s')
    const rows = readSelectOptions(select)
    expect(rows.map((row) => row.label)).toEqual(['Alpha one', 'Beta', 'Gamma label', 'Delta', 'Epsilon'])
    expect(rows.map((row) => row.group)).toEqual([null, 'Later', 'Later', 'Locked', null])
    expect(rows.map((row) => row.disabled)).toEqual([false, false, false, true, true])
    expect(rows.map((row) => row.selected)).toEqual([false, true, false, false, false])
    expect(rows[1].option).toBe(select.options[2])
  })
})

describe('pickerTitle', () => {
  it.each([
    ['data-picker-title wins', '<select id="s" data-picker-title="Chooser" aria-label="Aria"></select>', 'Chooser'],
    ['then aria-label', '<select id="s" aria-label="Sort watchlist"></select>', 'Sort watchlist'],
    ['then aria-labelledby, in id order', '<span id="a">Audio</span><span id="b">language</span><select id="s" aria-labelledby="a b"></select>', 'Audio language'],
    ['then the label title (StreamPicker chips)', '<label title="Sort within cache tier"><svg></svg><select id="s"><option>Quality</option></select></label>', 'Sort within cache tier'],
    ['then the label text before the control', '<label>Edit<select id="s"><option>Density</option></select> after</label>', 'Edit'],
    ['label text inside a span', '<label><span>Columns</span><select id="s"><option>3</option></select></label>', 'Columns'],
    ['a separate label[for] (profiles age limit)', '<label for="s">Maximum content age</label><select id="s"><option>18</option></select>', 'Maximum content age'],
    ['nothing to go on', '<select id="s"><option>One</option></select>', 'Choose an option'],
  ])('%s', (_name, html, title) => {
    document.body.innerHTML = html
    expect(pickerTitle(q('#s'))).toBe(title)
  })
})

describe('isPickableSelect', () => {
  it('accepts only an enabled single-choice select outside inert content', () => {
    document.body.innerHTML = `
      <select id="ok"><option>1</option></select>
      <select id="multi" multiple><option>1</option></select>
      <select id="list" size="4"><option>1</option></select>
      <select id="off" disabled><option>1</option></select>
      <select id="aria" aria-disabled="true"><option>1</option></select>
      <div inert><select id="inert"><option>1</option></select></div>
      <button id="button">b</button>`
    expect(isPickableSelect(q('#ok'))).toBe(true)
    for (const id of ['multi', 'list', 'off', 'aria', 'inert', 'button']) expect(isPickableSelect(q(`#${id}`)), id).toBe(false)
    expect(isPickableSelect(null)).toBe(false)
    expect(isPickableSelect(undefined)).toBe(false)
  })

  it('rejects every select while a modal dialog is shown, whose top layer would cover the chooser', () => {
    document.body.innerHTML = `
      <dialog id="modal" open><select id="inside"><option>1</option></select></dialog>
      <select id="page"><option>1</option></select>`
    stubModal((el) => el.id === 'modal')
    expect(isPickableSelect(q('#inside'))).toBe(false)
    expect(isPickableSelect(q('#page'))).toBe(false)
  })

  it('accepts a select in a dialog that is open but not modal', () => {
    document.body.innerHTML = '<dialog id="plain" open><select id="inside"><option>1</option></select></dialog>'
    stubModal(() => false)
    expect(isPickableSelect(q('#inside'))).toBe(true)
  })

  it('counts an open dialog as modal when the engine cannot answer :modal', () => {
    document.body.innerHTML = '<dialog id="d" open></dialog><select id="page"><option>1</option></select>'
    stubModal(() => { throw new SyntaxError("':modal' is not a valid selector") })
    expect(isPickableSelect(q('#page'))).toBe(false)
    q('#d').removeAttribute('open')
    expect(isPickableSelect(q('#page'))).toBe(true)
  })
})

describe('commitPickerOption', () => {
  it('selects by option identity, so a bound number reaches the change handler intact', () => {
    document.body.innerHTML = '<select id="s"><option>7</option><option>12</option><option>16</option></select>'
    const select = q<HTMLSelectElement>('#s')
    const options = [...select.options]
    options.forEach((option, index) => { Object.assign(option, { __value: [7, 12, 16][index] }) })
    const seen: unknown[] = []
    select.addEventListener('change', () => {
      seen.push((select.options[select.selectedIndex] as HTMLOptionElement & { __value?: unknown }).__value)
    })
    expect(commitPickerOption(select, options[1])).toBe('changed')
    expect(select.selectedIndex).toBe(1)
    expect(seen).toEqual([12])
  })

  it('picks the right one of two options that share an empty value', () => {
    document.body.innerHTML = '<select id="s"><option value="">Any</option><option value="">None</option></select>'
    const select = q<HTMLSelectElement>('#s')
    expect(commitPickerOption(select, select.options[1])).toBe('changed')
    expect(select.selectedIndex).toBe(1)
  })

  it('fires one bubbling input, then one change, and nothing when the choice is unchanged', () => {
    document.body.innerHTML = '<div id="wrap"><select id="s"><option>A</option><option>B</option></select></div>'
    const select = q<HTMLSelectElement>('#s')
    const events: string[] = []
    q('#wrap').addEventListener('input', () => events.push('input'))
    q('#wrap').addEventListener('change', () => events.push('change'))
    expect(commitPickerOption(select, select.options[1])).toBe('changed')
    expect(events).toEqual(['input', 'change'])
    expect(commitPickerOption(select, select.options[1])).toBe('unchanged')
    expect(events).toEqual(['input', 'change'])
  })

  it('reports an option that is not in the select, and ignores a disabled one', () => {
    document.body.innerHTML = '<select id="s"><option>A</option><option disabled>B</option></select><select id="other"><option>X</option></select>'
    const select = q<HTMLSelectElement>('#s')
    const change = vi.fn()
    select.addEventListener('change', change)
    expect(commitPickerOption(select, q<HTMLSelectElement>('#other').options[0])).toBe('missing')
    expect(commitPickerOption(select, select.options[1])).toBe('unchanged')
    expect(select.selectedIndex).toBe(0)
    expect(change).not.toHaveBeenCalled()
  })
})

describe('stepPickerRow', () => {
  it('walks DOM order, skips disabled rows, clamps at the ends and enters from outside', () => {
    document.body.innerHTML = `
      <button id="a">A</button><button id="b" disabled>B</button><button id="c" aria-disabled="true">C</button>
      <button id="d">D</button><button id="outside">x</button>`
    const rows = ['a', 'b', 'c', 'd'].map((id) => q(`#${id}`))
    expect(stepPickerRow(rows, rows[0], 1)).toBe(rows[3])
    expect(stepPickerRow(rows, rows[3], -1)).toBe(rows[0])
    expect(stepPickerRow(rows, rows[3], 1)).toBe(rows[3])
    expect(stepPickerRow(rows, rows[0], -1)).toBe(rows[0])
    expect(stepPickerRow(rows, q('#outside'), 1)).toBe(rows[0])
    expect(stepPickerRow(rows, null, -1)).toBe(rows[3])
    expect(stepPickerRow([], null, 1)).toBeNull()
  })
})

// Past every microtask (Svelte's tick, MutationObserver deliveries) the module schedules.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const resetPicker = () => {
  resetNativePickerForTests()
  isTv.set(false)
  oskOpen.set(false)
  ;(document.activeElement as HTMLElement | null)?.blur()
}

describe('opening and refreshing the chooser', () => {
  beforeEach(resetPicker)
  afterEach(() => { resetNativePickerForTests() })

  it('opens with the title, the options and the select as the place focus returns to', () => {
    document.body.innerHTML = '<label>Edit<select id="s"><option>A</option><option selected>B</option></select></label>'
    const select = q<HTMLSelectElement>('#s')
    expect(openNativePicker(select)).toBe(true)
    const state = get(nativePicker)
    expect(state?.select).toBe(select)
    expect(state?.title).toBe('Edit')
    expect(state?.options.map((row) => row.label)).toEqual(['A', 'B'])
    expect(state?.options.map((row) => row.selected)).toEqual([false, true])
    expect(state?.opener?.id).toBe('s')
    expect(state?.rev).toBe(1)
  })

  it('refuses a select it cannot drive', () => {
    document.body.innerHTML = '<select id="s" multiple><option>A</option></select>'
    expect(openNativePicker(q<HTMLSelectElement>('#s'))).toBe(false)
    expect(get(nativePicker)).toBeNull()
  })

  it('opens from the pad only off TV and only for a pickable select', () => {
    document.body.innerHTML = '<select id="s"><option>A</option></select><select id="m" multiple><option>A</option></select>'
    isTv.set(true)
    expect(padOpenPicker(q('#s'))).toBe(false)
    expect(get(nativePicker)).toBeNull()
    isTv.set(false)
    expect(padOpenPicker(q('#m'))).toBe(false)
    expect(padOpenPicker(null)).toBe(false)
    expect(padOpenPicker(q('#s'))).toBe(true)
    expect(get(nativePicker)?.select).toBe(q('#s'))
  })

  it('re-reads options appended while it is open', () => {
    document.body.innerHTML = '<select id="s"><option>A</option><option>B</option></select>'
    const select = q<HTMLSelectElement>('#s')
    openNativePicker(select)
    const added = document.createElement('option')
    added.textContent = 'C'
    select.append(added)
    refreshNativePicker()
    expect(get(nativePicker)?.options.map((row) => row.label)).toEqual(['A', 'B', 'C'])
    expect(get(nativePicker)?.rev).toBe(2)
  })

  it('closes without returning focus when a refresh finds the select disabled', async () => {
    document.body.innerHTML = '<select id="s"><option>A</option></select>'
    const select = q<HTMLSelectElement>('#s')
    openNativePicker(select)
    select.disabled = true
    refreshNativePicker()
    expect(get(nativePicker)).toBeNull()
    await settle()
    expect(document.activeElement).not.toBe(select)
  })
})

describe('closing the chooser', () => {
  beforeEach(resetPicker)
  afterEach(() => { resetNativePickerForTests() })

  it('returns focus to the select after a choice', async () => {
    document.body.innerHTML = '<select id="s"><option>A</option><option>B</option></select><div data-native-picker><button id="row">B</button></div>'
    const select = q<HTMLSelectElement>('#s')
    openNativePicker(select)
    q('#row').focus()
    chooseNativePickerOption(select.options[1])
    expect(select.selectedIndex).toBe(1)
    expect(get(nativePicker)).toBeNull()
    await settle()
    expect(document.activeElement).toBe(select)
  })

  it('stays open and re-reads when the chosen option is gone', () => {
    document.body.innerHTML = '<select id="s"><option>A</option><option>B</option></select>'
    const select = q<HTMLSelectElement>('#s')
    openNativePicker(select)
    const gone = select.options[1]
    gone.remove()
    chooseNativePickerOption(gone)
    expect(get(nativePicker)?.options.map((row) => row.label)).toEqual(['A'])
  })

  it('finds a select that was re-rendered while it was open', async () => {
    document.body.innerHTML = '<div id="host"><select id="scope"><option>A</option><option>B</option></select></div>'
    openNativePicker(q<HTMLSelectElement>('#scope'))
    q('#host').innerHTML = '<select id="scope"><option>A</option><option>B</option></select>'
    closeNativePicker()
    await settle()
    expect(document.activeElement).toBe(q('#scope'))
  })

  it('leaves focus that the user moved elsewhere alone', async () => {
    document.body.innerHTML = '<select id="s"><option>A</option></select><button id="elsewhere">x</button>'
    openNativePicker(q<HTMLSelectElement>('#s'))
    q('#elsewhere').focus()
    closeNativePicker()
    await settle()
    expect(document.activeElement).toBe(q('#elsewhere'))
  })

  it('returns nothing with restore false, or when it reopened before the return ran', async () => {
    document.body.innerHTML = '<select id="a"><option>A</option></select><select id="b"><option>B</option></select>'
    openNativePicker(q<HTMLSelectElement>('#a'))
    closeNativePicker({ restore: false })
    await settle()
    expect(document.activeElement).toBe(document.body)
    openNativePicker(q<HTMLSelectElement>('#a'))
    closeNativePicker()
    openNativePicker(q<HTMLSelectElement>('#b'))
    await settle()
    expect(document.activeElement).toBe(document.body)
    expect(get(nativePicker)?.select).toBe(q('#b'))
  })
})

describe('watchControl', () => {
  it('reports new options, then a disabled select as gone, once', async () => {
    document.body.innerHTML = '<select id="s"><option>A</option></select>'
    const select = q<HTMLSelectElement>('#s')
    const onOptions = vi.fn()
    const onGone = vi.fn()
    const stop = watchControl(select, { onOptions, onGone })
    const added = document.createElement('option')
    added.textContent = 'B'
    select.append(added)
    await settle()
    expect(onOptions).toHaveBeenCalled()
    expect(onGone).not.toHaveBeenCalled()
    select.disabled = true
    await settle()
    expect(onGone).toHaveBeenCalledTimes(1)
    stop()
  })

  it('reports a removed select as gone without an options refresh', async () => {
    document.body.innerHTML = '<div><select id="s"><option>A</option></select></div>'
    const select = q<HTMLSelectElement>('#s')
    const onOptions = vi.fn()
    const onGone = vi.fn()
    const stop = watchControl(select, { onOptions, onGone })
    select.remove()
    await settle()
    expect(onGone).toHaveBeenCalledTimes(1)
    expect(onOptions).not.toHaveBeenCalled()
    stop()
  })

  it('reports the select as gone when a modal dialog opens over the page', async () => {
    document.body.innerHTML = '<select id="s"><option>A</option></select><dialog id="modal"><p>Busy</p></dialog>'
    stubModal((el) => el.id === 'modal' && el.hasAttribute('open'))
    const onOptions = vi.fn()
    const onGone = vi.fn()
    const stop = watchControl(q<HTMLSelectElement>('#s'), { onOptions, onGone })
    q('#modal').setAttribute('open', '')
    await settle()
    expect(onGone).toHaveBeenCalledTimes(1)
    expect(onOptions).not.toHaveBeenCalled()
    stop()
  })

  it('reports nothing once stopped', async () => {
    document.body.innerHTML = '<select id="s"><option>A</option></select>'
    const select = q<HTMLSelectElement>('#s')
    const onOptions = vi.fn()
    const onGone = vi.fn()
    watchControl(select, { onOptions, onGone })()
    select.append(document.createElement('option'))
    select.remove()
    await settle()
    expect(onOptions).not.toHaveBeenCalled()
    expect(onGone).not.toHaveBeenCalled()
  })
})

describe('chooser rows and keys', () => {
  const SHEET = `
    <select id="s"><option>A</option><option selected>B</option><option>C</option></select>
    <div id="panel" data-native-picker>
      <button data-picker-row id="r0" aria-selected="false">A</button>
      <button data-picker-row id="r1" aria-selected="true">B</button>
      <button data-picker-row id="r2" aria-selected="false" disabled>C</button>
      <button data-picker-row id="cancel">Cancel</button>
    </div>`
  const key = (name: string) => new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })

  beforeEach(resetPicker)
  afterEach(() => { resetNativePickerForTests() })

  it('focuses the current value, else the first usable row', () => {
    document.body.innerHTML = SHEET
    expect(focusPickerRow(q('#panel'))).toBe(q('#r1'))
    expect(document.activeElement).toBe(q('#r1'))
    q('#r1').setAttribute('disabled', '')
    expect(focusPickerRow(q('#panel'))).toBe(q('#r0'))
  })

  it('moves in DOM order on Up/Down, swallows Left/Right and stops the arrows there', () => {
    document.body.innerHTML = SHEET
    openNativePicker(q<HTMLSelectElement>('#s'))
    const panel = q('#panel')
    const capture = (event: KeyboardEvent) => { pickerKeydown(event, panel) }
    const later = vi.fn()
    window.addEventListener('keydown', capture, { capture: true })
    window.addEventListener('keydown', later)
    try {
      q('#r1').focus()
      const down = key('ArrowDown')
      window.dispatchEvent(down)
      expect(document.activeElement).toBe(q('#cancel'))
      expect(down.defaultPrevented).toBe(true)
      window.dispatchEvent(key('ArrowDown'))
      expect(document.activeElement).toBe(q('#cancel'))
      window.dispatchEvent(key('ArrowLeft'))
      expect(document.activeElement).toBe(q('#cancel'))
      window.dispatchEvent(key('ArrowUp'))
      expect(document.activeElement).toBe(q('#r1'))
      expect(later).not.toHaveBeenCalled()
      const enter = key('Enter')
      window.dispatchEvent(enter)
      expect(enter.defaultPrevented).toBe(false)
      expect(later).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', capture, { capture: true })
      window.removeEventListener('keydown', later)
    }
  })

  it('enters the rows from focus left behind the chooser', () => {
    document.body.innerHTML = SHEET
    openNativePicker(q<HTMLSelectElement>('#s'))
    q('#s').focus()
    expect(pickerKeydown(key('ArrowDown'), q('#panel'))).toBe(true)
    expect(document.activeElement).toBe(q('#r0'))
    q('#s').focus()
    pickerKeydown(key('ArrowUp'), q('#panel'))
    expect(document.activeElement).toBe(q('#cancel'))
  })

  it('stands down while nothing is open or the on-screen keyboard is up', () => {
    document.body.innerHTML = SHEET
    q('#r0').focus()
    const idle = key('ArrowDown')
    expect(pickerKeydown(idle, q('#panel'))).toBe(false)
    expect(idle.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(q('#r0'))
    openNativePicker(q<HTMLSelectElement>('#s'))
    oskOpen.set(true)
    const typing = key('ArrowDown')
    expect(pickerKeydown(typing, q('#panel'))).toBe(false)
    expect(typing.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(q('#r0'))
  })
})
