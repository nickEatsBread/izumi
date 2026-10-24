// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { describeRowFocusables } from './row-description'

// A control row as SettingsRow renders it: header-line controls, the Learn more text, and expanded
// children holding another control and a nested row.
const row = () => {
  document.body.innerHTML = `
    <div data-setting-row id="outer">
      <div data-nav-line><span>Stremio</span>
        <button data-focusable id="manage">Manage</button>
        <button data-focusable id="connect" aria-describedby="connect-help">Connect</button>
      </div>
      <div data-learn-more><p id="learn" aria-hidden="true">Add-ons sync both ways.</p></div>
      <div>
        <button data-focusable id="sync">Sync now</button>
        <div data-setting-row><div data-nav-line><button data-focusable id="nested">Nested</button></div></div>
      </div>
    </div>`
  return document.getElementById('outer')!
}
const describedBy = (id: string) => document.getElementById(id)!.getAttribute('aria-describedby')
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => document.body.replaceChildren())

it('describes every focusable the row owns, header and children, but not a nested row\'s', () => {
  describeRowFocusables(row(), 'learn')
  expect(describedBy('manage')).toBe('learn')
  expect(describedBy('sync')).toBe('learn')
  // A description of its own stays, first.
  expect(describedBy('connect')).toBe('connect-help learn')
  expect(describedBy('nested')).toBeNull()
})

it('takes the description off when the row leaves controller mode, keeping the control\'s own', () => {
  const action = describeRowFocusables(row(), 'learn')
  action.update(undefined)
  expect(describedBy('manage')).toBeNull()
  expect(describedBy('connect')).toBe('connect-help')
  action.update('learn')
  expect(describedBy('manage')).toBe('learn')
})

it('describes a control the snippet renders later, until the action is destroyed', async () => {
  const node = row()
  const action = describeRowFocusables(node, 'learn')
  node.querySelector('[data-nav-line]')!.insertAdjacentHTML('beforeend', '<button data-focusable id="late">Disconnect</button>')
  await flush()
  expect(describedBy('late')).toBe('learn')
  action.destroy()
  node.querySelector('[data-nav-line]')!.insertAdjacentHTML('beforeend', '<button data-focusable id="after">Again</button>')
  await flush()
  expect(describedBy('after')).toBeNull()
})

it('does nothing outside controller mode', () => {
  describeRowFocusables(row(), undefined)
  expect(describedBy('manage')).toBeNull()
  expect(describedBy('connect')).toBe('connect-help')
})
