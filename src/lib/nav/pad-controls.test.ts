import { describe, expect, it } from 'vitest'
import { PAD_KEY, isPadEvent } from './pad-controls'
import { nextRangeValue, padRangeMultiplier } from './pad-controls'

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

describe('nextRangeValue', () => {
  it('steps an integer slider by its step', () => {
    expect(nextRangeValue({ value: 5, min: 0, max: 10, step: 1 }, 1)).toBe(6)
    expect(nextRangeValue({ value: 5, min: 0, max: 10, step: 1 }, -1)).toBe(4)
  })

  it('reads the string attributes an input element carries', () => {
    expect(nextRangeValue({ value: '4', min: '0', max: '10', step: '2' }, 1)).toBe(6)
  })

  it('steps by tenths without float drift', () => {
    expect(nextRangeValue({ value: 0.2, min: 0, max: 1, step: 0.1 }, 1)).toBe(0.3)
    let value = 0
    for (let k = 1; k <= 10; k++) {
      value = nextRangeValue({ value, min: 0, max: 1, step: 0.1 }, 1)
      expect(value).toBe(Number((k / 10).toFixed(1)))
    }
    expect(value).toBe(1)
  })

  it('keeps a fractional minimum on its grid (Theme Studio type scale: min 0.85, step 0.01)', () => {
    const scale = { min: 0.85, max: 1.2, step: 0.01 }
    expect(nextRangeValue({ ...scale, value: 0.85 }, 1)).toBe(0.86)
    expect(nextRangeValue({ ...scale, value: 0.86 }, -1)).toBe(0.85)
    expect(nextRangeValue({ ...scale, value: 1 }, 1)).toBe(1.01)
    expect(nextRangeValue({ ...scale, value: 1.19 }, 1)).toBe(1.2)
  })

  it('clamps to the bounds, also when a multiplier overshoots (UI scale holds at 2.0)', () => {
    expect(nextRangeValue({ value: 10, min: 0, max: 10, step: 1 }, 1)).toBe(10)
    expect(nextRangeValue({ value: 0, min: 0, max: 10, step: 1 }, -1)).toBe(0)
    expect(nextRangeValue({ value: 95, min: 0, max: 100, step: 1 }, 1, { multiplier: 10 })).toBe(100)
    expect(nextRangeValue({ value: 1.9, min: 0.5, max: 2, step: 0.1 }, 1)).toBe(2)
    expect(nextRangeValue({ value: 2, min: 0.5, max: 2, step: 0.1 }, 1)).toBe(2)
    expect(nextRangeValue({ value: 0.5, min: 0.5, max: 2, step: 0.1 }, -1)).toBe(0.5)
  })

  it('reaches a max that is off the step grid, and steps back onto the grid from it', () => {
    expect(nextRangeValue({ value: 9, min: 0, max: 10, step: 3 }, 1)).toBe(10)
    expect(nextRangeValue({ value: 10, min: 0, max: 10, step: 3 }, -1)).toBe(9)
  })

  it('snaps an off-grid value to the next grid point in the direction of travel', () => {
    expect(nextRangeValue({ value: 15, min: 0, max: 100, step: 10 }, 1)).toBe(20)
    expect(nextRangeValue({ value: 15, min: 0, max: 100, step: 10 }, -1)).toBe(10)
  })

  it("treats step 'any', zero, negative or unparsable as a hundredth of the span", () => {
    for (const step of ['any', 0, -1, 'abc'] as const) {
      expect(nextRangeValue({ value: 0.5, min: 0, max: 1, step }, 1), String(step)).toBe(0.51)
    }
  })

  it('uses the HTML defaults: min 0, max 100, step 1, value in the middle', () => {
    expect(nextRangeValue({ value: 50 }, 1)).toBe(51)
    expect(nextRangeValue({ value: '', min: '', max: '', step: '' }, 1)).toBe(51)
    expect(nextRangeValue({ value: 100 }, 1)).toBe(100)
  })

  it('collapses a max below min onto min', () => {
    expect(nextRangeValue({ value: 5, min: 10, max: 0 }, 1)).toBe(10)
  })

  it('inverts the direction for right-to-left sliders', () => {
    expect(nextRangeValue({ value: 5, min: 0, max: 10, step: 1 }, 1, { rtl: true })).toBe(4)
    expect(nextRangeValue({ value: 5, min: 0, max: 10, step: 1 }, -1, { rtl: true })).toBe(6)
  })

  it('moves by step × multiplier and treats a multiplier below 1 (or NaN) as 1', () => {
    expect(nextRangeValue({ value: 0, min: 0, max: 400, step: 1 }, 1, { multiplier: 10 })).toBe(10)
    expect(nextRangeValue({ value: 0, min: 0, max: 400, step: 1 }, 1, { multiplier: 0 })).toBe(1)
    expect(nextRangeValue({ value: 0, min: 0, max: 400, step: 1 }, 1, { multiplier: Number.NaN })).toBe(1)
  })

  it('works below zero and never returns -0', () => {
    expect(nextRangeValue({ value: -1, min: -5, max: 5, step: 0.5 }, 1)).toBe(-0.5)
    expect(nextRangeValue({ value: -0.5, min: -5, max: 5, step: 0.5 }, 1)).toBe(0)
    expect(nextRangeValue({ value: 0.5, min: -5, max: 5, step: 0.5 }, -1)).toBe(0)
  })
})

describe('padRangeMultiplier', () => {
  it('keeps single steps for the press and the first five repeats', () => {
    for (let repeat = 0; repeat < 6; repeat++) expect(padRangeMultiplier(repeat, 264)).toBe(1)
  })

  it('then sweeps the whole slider in about forty presses', () => {
    expect(padRangeMultiplier(6, 264)).toBe(7) // Theme Studio poster width: 96-360 px in 1 px steps
    expect(padRangeMultiplier(30, 264)).toBe(7)
    expect(padRangeMultiplier(6, 41)).toBe(2)
  })

  it('never drops below one step', () => {
    expect(padRangeMultiplier(6, 15)).toBe(1) // Interface UI scale: 0.5-2 in tenths
    expect(padRangeMultiplier(6, 40)).toBe(1)
    expect(padRangeMultiplier(6, 0)).toBe(1)
    expect(padRangeMultiplier(6, Number.NaN)).toBe(1)
  })
})
