import { describe, expect, it } from 'vitest'
import { expandPos, EXPAND_INFO_H } from './expand-pos'

const vp = { width: 1600, height: 900 }

describe('expandPos', () => {
  it('centres a 1.5x box on the card, with the card centre as the transform origin', () => {
    expect(expandPos({ left: 400, top: 300, width: 240, height: 135 }, vp, 1, 0)).toEqual({ left: 340, top: 266.25, width: 360, artHeight: 202.5, originX: 180, originY: 101.25 })
  })
  it('keeps clear of the rail and the window edges, moving the origin with the box', () => {
    expect(expandPos({ left: 70, top: 300, width: 240, height: 135 }, vp, 1, 64)).toMatchObject({ left: 64, originX: 126 })
    expect(expandPos({ left: 1350, top: 300, width: 240, height: 135 }, vp, 1, 0)).toMatchObject({ left: 1232, originX: 238 })
    expect(expandPos({ left: 400, top: 800, width: 240, height: 135 }, vp, 1, 0)).toMatchObject({ top: 900 - (202.5 + EXPAND_INFO_H) - 8, originY: 867.5 - (900 - (202.5 + EXPAND_INFO_H) - 8) })
    expect(expandPos({ left: 400, top: -20, width: 240, height: 135 }, vp, 1, 0)).toMatchObject({ top: 8 })
  })
  it('works in local px under UI zoom', () => {
    expect(expandPos({ left: 500, top: 300, width: 300, height: 168.75 }, { width: 2000, height: 1125 }, 1.25, 0)).toEqual({ left: 340, top: 206.25, width: 360, artHeight: 202.5, originX: 180, originY: 101.25 })
  })
  it('treats a bad zoom as 1', () => {
    expect(expandPos({ left: 400, top: 300, width: 240, height: 135 }, vp, 0, 0).width).toBe(360)
  })
})
