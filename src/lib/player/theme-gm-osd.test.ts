import { describe, expect, it } from 'vitest'
import { assColor, osdSpinnerColor } from './theme-gm-osd'

describe('assColor', () => {
  it('turns computed rgb into ASS BGR hex', () => {
    expect(assColor('rgb(244, 117, 33)')).toBe('2175F4')
    expect(assColor('rgb(255, 255, 255)')).toBe('FFFFFF')
    expect(assColor(' RGB(0 128 255) ')).toBe('FF8000')
  })

  it('drops alpha but keeps the colour', () => {
    expect(assColor('rgba(244, 117, 33, 0.5)')).toBe('2175F4')
    expect(assColor('rgb(244 117 33 / 0.5)')).toBe('2175F4')
  })

  it('rounds and clamps fractional or out-of-range channels', () => {
    expect(assColor('rgb(244.6, -3, 300)')).toBe('FF00F5')
  })

  it('keeps the OSD colour for transparent, other colour spaces and junk', () => {
    for (const value of ['rgba(0, 0, 0, 0)', 'oklch(0.7 0.2 40)', 'color(display-p3 1 0 0)', '', 'rgb(1, 2)', 'rgb(1, 2, x)', 'rgb(1, 2, 3, 4, 5)', '#f47521']) {
      expect(assColor(value)).toBe('')
    }
  })
})

describe('osdSpinnerColor', () => {
  it('gives the page the exact colour mpv draws its spinner in', () => {
    expect(osdSpinnerColor('2175F4')).toBe('#F47521')
    expect(osdSpinnerColor(assColor('rgb(10, 200, 30)'))).toBe('#0AC81E')
  })

  it('falls back to the OSD white, as mpv does, when no theme sets an accent', () => {
    expect(osdSpinnerColor('')).toBe('#fff')
  })
})
