import { describe, expect, it } from 'vitest'
import { PAD_KEY, isPadEvent } from './pad-controls'

// Provenance of synthetic controller keys. The mark is a registered symbol defined on the event
// itself, so every copy of the module (Vite HMR, a duplicate chunk) reads the same mark.
// Commit 4 adds the slider maths (nextRangeValue, padRangeMultiplier) to this file.

describe('pad key provenance', () => {
  it('uses the registered izumi.padKey symbol', () => {
    expect(PAD_KEY).toBe(Symbol.for('izumi.padKey'))
  })

  it('reads the mark straight off the event', () => {
    const marked = new Event('keydown')
    Object.defineProperty(marked, Symbol.for('izumi.padKey'), { value: true })
    expect(isPadEvent(marked)).toBe(true)
    expect(isPadEvent(new Event('keydown'))).toBe(false)
  })

  it('treats a missing event or a mark that is not exactly true as unmarked', () => {
    const truthy = new Event('keydown')
    Object.defineProperty(truthy, Symbol.for('izumi.padKey'), { value: 1 })
    expect(isPadEvent(null)).toBe(false)
    expect(isPadEvent(undefined)).toBe(false)
    expect(isPadEvent(truthy)).toBe(false)
  })
})
