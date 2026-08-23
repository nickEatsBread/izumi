import { describe, expect, it } from 'vitest'
import { clampSubtitlePosition, subtitlePositionFromPointer, subtitlePreviewFontSize } from './subtitle-editor'

describe('subtitle editor geometry', () => {
  it('maps pointer height to mpv sub-pos and clamps it to the usable frame', () => {
    expect(subtitlePositionFromPointer(410, 50, 400)).toBe(90)
    expect(subtitlePositionFromPointer(-100, 50, 400)).toBe(5)
    expect(subtitlePositionFromPointer(900, 50, 400)).toBe(100)
  })

  it('uses the normal subtitle position for invalid geometry', () => {
    expect(subtitlePositionFromPointer(20, 0, 0)).toBe(92)
    expect(clampSubtitlePosition(Number.NaN)).toBe(92)
  })

  it('previews mpv font size on its 720-high reference canvas', () => {
    expect(subtitlePreviewFontSize(42, 720)).toBe(42)
    expect(subtitlePreviewFontSize(42, 360)).toBe(21)
    expect(subtitlePreviewFontSize(8, 100)).toBe(14)
  })
})
