import { describe, expect, it } from 'vitest'
import { isNearViewport } from './near-viewport'

describe('near viewport threshold', () => {
  it('activates visible and one-and-a-half-screen-ahead rows', () => {
    expect(isNearViewport(-100, 800)).toBe(true)
    expect(isNearViewport(800, 800)).toBe(true)
    expect(isNearViewport(1199, 800)).toBe(true)
    expect(isNearViewport(1200, 800)).toBe(false)
  })

  it('supports a caller-specific lookahead and invalid geometry', () => {
    expect(isNearViewport(1599, 800, 2)).toBe(true)
    expect(isNearViewport(1600, 800, 2)).toBe(false)
    expect(isNearViewport(Number.NaN, 800)).toBe(false)
  })
})
