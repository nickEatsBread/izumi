import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The factory reset starts only through startFactoryReset, which checks the household grant before
// it sets the marker static/reset.html requires (spec §6.6). About asks for the PIN first.

const mocks = vi.hoisted(() => ({ assertHouseholdAction: vi.fn() }))
vi.mock('$lib/profiles/household-gate', () => ({ assertHouseholdAction: mocks.assertHouseholdAction }))

import { RESET_MARKER_KEY, startFactoryReset } from './factory-reset'

function scope() {
  const values = new Map<string, string>()
  return {
    values,
    sessionStorage: { setItem: vi.fn((key: string, value: string) => { values.set(key, value) }) },
    location: { replace: vi.fn() },
  }
}

beforeEach(() => {
  mocks.assertHouseholdAction.mockReset()
})

describe('startFactoryReset', () => {
  it('sets the marker the standalone reset page requires, then leaves the app for it', () => {
    const target = scope()
    startFactoryReset(target)
    expect(mocks.assertHouseholdAction).toHaveBeenCalledWith('factory-reset')
    expect(target.values.get(RESET_MARKER_KEY)).toBe('true')
    expect(target.location.replace).toHaveBeenCalledWith('/reset.html')
    expect(target.sessionStorage.setItem.mock.invocationCallOrder[0])
      .toBeLessThan(target.location.replace.mock.invocationCallOrder[0])
  })

  it('does nothing without the household grant', () => {
    mocks.assertHouseholdAction.mockImplementation(() => { throw new Error('Enter the main profile PIN first.') })
    const target = scope()
    expect(() => startFactoryReset(target)).toThrow('Enter the main profile PIN first.')
    expect(target.sessionStorage.setItem).not.toHaveBeenCalled()
    expect(target.location.replace).not.toHaveBeenCalled()
  })

  it('uses the marker key that static/reset.html checks', () => {
    const html = readFileSync(new URL('../../../static/reset.html', import.meta.url), 'utf8')
    expect(RESET_MARKER_KEY).toBe('izumi-reset-requested')
    expect(html).toContain(`sessionStorage.getItem('${RESET_MARKER_KEY}') === 'true'`)
  })
})
