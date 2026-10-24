import { describe, expect, it } from 'vitest'
import { placeContextMenu } from './context-menu-pos'

describe('placeContextMenu', () => {
  it('opens down and right of the pointer when it fits', () => {
    expect(placeContextMenu(100, 50, 240, 300, 1280, 720)).toEqual({ left: 100, top: 50 })
  })

  it('flips left and up near the far edges', () => {
    expect(placeContextMenu(1200, 600, 240, 300, 1280, 720)).toEqual({ left: 960, top: 300 })
  })

  it('stays inside a box smaller than a flip needs', () => {
    expect(placeContextMenu(100, 200, 240, 300, 300, 360)).toEqual({ left: 8, top: 8 })
  })
})
