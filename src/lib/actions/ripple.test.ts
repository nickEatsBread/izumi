import { describe, expect, it } from 'vitest'
import { rippleGeometry } from './ripple'

describe('rippleGeometry', () => {
  const rect = { left: 20, top: 100, width: 300, height: 64 }

  it('centres the ripple on the touch point, relative to the element', () => {
    const g = rippleGeometry(rect, 170, 132)
    expect(g.x).toBe(150)
    expect(g.y).toBe(32)
  })

  it('sizes it to cover the furthest corner from that point', () => {
    // Touch at the left edge: the furthest corner is the right edge, 300px away horizontally.
    const g = rippleGeometry(rect, 20, 132)
    expect(g.size).toBeGreaterThanOrEqual(600)
  })

  it('falls back to the element centre when there is no touch point', () => {
    const g = rippleGeometry(rect, undefined, undefined)
    expect(g.x).toBe(150)
    expect(g.y).toBe(32)
  })
})
