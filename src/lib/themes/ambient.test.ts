import { describe, expect, it } from 'vitest'
import { ambientFromPixels } from './ambient'

describe('artwork ambient colour', () => {
  it('weights saturated pixels above greys', () => {
    // Two pixels: mid grey and saturated red, both opaque.
    const [r, g, b] = ambientFromPixels([128, 128, 128, 255, 230, 20, 20, 255])!.split(' ').map(Number)
    expect(r).toBeGreaterThan(g + 40)
    expect(g).toBe(b)
  })
  it('ignores transparent pixels and empty input', () => {
    expect(ambientFromPixels([255, 0, 0, 0])).toBeUndefined()
    expect(ambientFromPixels([])).toBeUndefined()
  })
})
