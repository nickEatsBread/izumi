import { describe, expect, it } from 'vitest'
import { clampSubtitlePosition, subtitlePositionFromPointer } from './subtitle-editor'

describe('subtitle editor geometry', () => {
  it('maps pointer height to a position and clamps it to the usable frame', () => {
    expect(subtitlePositionFromPointer(410, 50, 400)).toBe(90)
    expect(subtitlePositionFromPointer(-100, 50, 400)).toBe(5)
    expect(subtitlePositionFromPointer(900, 50, 400)).toBe(100)
  })

  it('uses the normal subtitle position for invalid geometry', () => {
    expect(subtitlePositionFromPointer(20, 0, 0)).toBe(92)
    expect(clampSubtitlePosition(Number.NaN)).toBe(92)
  })
})
