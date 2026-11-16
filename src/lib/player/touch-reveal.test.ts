import { describe, expect, it } from 'vitest'
import { armTouchReveal, clearTouchReveal, touchRevealArmed } from './touch-reveal'

describe('touch that reveals hidden controls', () => {
  it('is ignored by the controls until a new touch or the window ends', () => {
    armTouchReveal(900, 1000)
    expect(touchRevealArmed(1200)).toBe(true)
    expect(touchRevealArmed(1950)).toBe(false)
    armTouchReveal(900, 1000)
    clearTouchReveal()
    expect(touchRevealArmed(1001)).toBe(false)
  })
})
