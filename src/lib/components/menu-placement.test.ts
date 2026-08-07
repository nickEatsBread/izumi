import { describe, expect, it } from 'vitest'
import { menuPlacement } from './menu-placement'

// A 40px-tall trigger at `y`, in a 800px-tall viewport.
const trigger = (y: number) => ({ top: y, bottom: y + 40, viewport: 800 })

describe('menuPlacement', () => {
  it('opens downward when the menu fits below', () => {
    const { side } = menuPlacement({ ...trigger(100), content: 200 })
    expect(side).toBe('down')
  })

  it('flips up when the trigger sits at the bottom of the screen', () => {
    // 120px of room below, 620 above: the reported bug — the menu ran off-screen and the page
    // never scrolled to it.
    const { side, maxHeight } = menuPlacement({ ...trigger(640), content: 300 })
    expect(side).toBe('up')
    expect(maxHeight).toBeLessThanOrEqual(640 - 4 - 8)
    expect(maxHeight).toBeGreaterThan(300)
  })

  it('caps the height to the room on the chosen side, so the menu scrolls instead of overflowing', () => {
    const { side, maxHeight } = menuPlacement({ ...trigger(300), content: 900 })
    // Neither half fits 900, so it takes the roomier one and scrolls inside it.
    expect(side).toBe('down')
    expect(maxHeight).toBe(800 - 340 - 4 - 8)
  })

  it('never returns a cap below the floor, however cramped the trigger is', () => {
    const { maxHeight } = menuPlacement({ top: 396, bottom: 404, viewport: 800, content: 300 })
    expect(maxHeight).toBeGreaterThanOrEqual(132)
  })

  it('stays below when below is the roomier half even if the menu does not fit', () => {
    const { side } = menuPlacement({ ...trigger(200), content: 900 })
    expect(side).toBe('down')
  })

  it('reports local px under uiScale zoom, not screen px', () => {
    // At zoom 1.5 a 800px screen is ~533 local px tall. Mixing the spaces would hand the element a
    // max-height 1.5× too large, which is exactly the overflow the cap exists to prevent.
    const unzoomed = menuPlacement({ ...trigger(100), content: 200 })
    const zoomed = menuPlacement({ ...trigger(100), content: 200, zoom: 1.5 })
    expect(zoomed.maxHeight).toBeCloseTo((800 - 140) / 1.5 - 12, 5)
    expect(zoomed.maxHeight).toBeLessThan(unzoomed.maxHeight)
  })

  it('uses the estimate before the menu has rendered', () => {
    // No `content`: 260px is assumed, so a trigger with 200px below still flips up.
    expect(menuPlacement({ top: 560, bottom: 600, viewport: 800 }).side).toBe('up')
    expect(menuPlacement({ top: 100, bottom: 140, viewport: 800 }).side).toBe('down')
  })
})
