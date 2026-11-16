import { describe, expect, it } from 'vitest'
import { cleanAccount } from './host'

describe('plugin account block', () => {
  it('keeps text and up to four labelled buttons, and drops the rest', () => {
    const state = cleanAccount({
      text: 'Connected as a@example.com. Using ChatGPT plan.',
      buttons: [{ id: 'usage', label: 'Manage usage' }, { id: 'signout', label: 'Sign out', primary: 'yes' }, { id: '', label: 'x' }, { label: 'no id' }, ...Array(5).fill({ id: 'a', label: 'A' })],
    })
    expect(state.text).toBe('Connected as a@example.com. Using ChatGPT plan.')
    expect(state.buttons).toEqual([{ id: 'usage', label: 'Manage usage', primary: false }, { id: 'signout', label: 'Sign out', primary: false }])
    expect(cleanAccount('nope')).toEqual({ text: undefined, buttons: [] })
    expect(cleanAccount({ buttons: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }).buttons).toEqual([{ id: 'a', label: 'A', primary: false }])
    expect(cleanAccount({ text: 'x'.repeat(500) }).text).toHaveLength(300)
  })
})
