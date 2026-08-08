import { describe, expect, it } from 'vitest'
import { heroBarState } from './hero-bar'

const ART = 260
const BAR = 56

describe('heroBarState', () => {
  it('is transparent and title-less while the artwork is still behind it', () => {
    expect(heroBarState(0, ART, BAR)).toEqual({ solid: false, showTitle: false })
    expect(heroBarState(100, ART, BAR)).toEqual({ solid: false, showTitle: false })
  })

  it('goes solid once the artwork has scrolled under the bar', () => {
    expect(heroBarState(ART - BAR + 9, ART, BAR)).toEqual({ solid: true, showTitle: true })
    expect(heroBarState(1000, ART, BAR)).toEqual({ solid: true, showTitle: true })
  })

  it('holds its state inside the hysteresis band so a resting scroll cannot flicker', () => {
    // Rising through the band: still transparent until it clears threshold + 8.
    expect(heroBarState(ART - BAR + 4, ART, BAR, false).solid).toBe(false)
    // Falling back through the band from solid: stays solid until it drops below threshold - 8.
    expect(heroBarState(ART - BAR - 4, ART, BAR, true).solid).toBe(true)
    expect(heroBarState(ART - BAR - 20, ART, BAR, true).solid).toBe(false)
  })

  it('treats a missing artwork measurement as not-yet-scrolled', () => {
    expect(heroBarState(50, 0, BAR)).toEqual({ solid: false, showTitle: false })
  })
})
