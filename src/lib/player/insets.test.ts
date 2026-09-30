import { describe, expect, it } from 'vitest'
import { measureStage, playerInsets, sameInsets } from './insets'

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() { return {} } }) as DOMRectReadOnly
const viewport = { width: 1280, height: 800 }

describe('playerInsets', () => {
  it('renders edge to edge whenever the chrome is hidden', () => {
    for (const nav of ['sidebar', 'top', 'bottom'] as const) {
      expect(playerInsets({ chrome: false, nav, stage: { left: .2, top: .2, right: .2, bottom: .2 }, viewport, dpr: 2, uiScale: 1.25 }))
        .toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
    }
  })

  it('keeps the video right of the sidebar rail before the overlay has measured itself', () => {
    expect(playerInsets({ chrome: true, nav: 'sidebar', stage: null, viewport, dpr: 2, uiScale: 1 })).toEqual({ left: 112, top: 0, right: 0, bottom: 0 })
    expect(playerInsets({ chrome: true, nav: 'sidebar', stage: null, viewport, dpr: 1, uiScale: 1.25 })).toEqual({ left: 70, top: 0, right: 0, bottom: 0 })
  })

  it('moves the inset to the top bar or bottom bar when the theme docks the navigation there', () => {
    // The old code always inset the LEFT edge, which left a blank rail beside a top bar.
    expect(playerInsets({ chrome: true, nav: 'top', stage: null, viewport, dpr: 1, uiScale: 1 })).toEqual({ left: 0, top: 76, right: 0, bottom: 0 })
    expect(playerInsets({ chrome: true, nav: 'bottom', stage: null, viewport, dpr: 1, uiScale: 1, bottomNav: 72 })).toEqual({ left: 0, top: 0, right: 0, bottom: 72 })
  })

  it('follows the measured stage on every edge for a docked watch layout', () => {
    const stage = measureStage(rect(56, 76, 832, 468), rect(0, 0, 1280, 800))!
    expect(playerInsets({ chrome: true, nav: 'sidebar', stage, viewport, dpr: 2, uiScale: 1 }))
      .toEqual({ left: 112, top: 152, right: 784, bottom: 512 })
  })

  it('measures fractions, so a zoomed root reports the same stage as an unzoomed one', () => {
    const unzoomed = measureStage(rect(56, 0, 1224, 800), rect(0, 0, 1280, 800))
    const zoomed = measureStage(rect(44.8, 0, 979.2, 640), rect(0, 0, 1024, 640))
    expect(unzoomed).toEqual(zoomed)
    expect(measureStage(rect(0, 0, 10, 10), rect(0, 0, 0, 0))).toBeNull()
  })

  it('keeps the full stage when a page-flow view scrolls it past the window', () => {
    // A 1066×600 stage scrolled 200px above the window top: the native surface keeps its size and
    // extends past the edge instead of squeezing the picture into the visible 400px.
    const scrolled = measureStage(rect(107, -200, 1066, 600), rect(0, 0, 1280, 800), true)!
    expect(playerInsets({ chrome: true, nav: 'top', stage: scrolled, viewport, dpr: 1, uiScale: 1 }))
      .toEqual({ left: 107, top: -200, right: 107, bottom: 400 })
    // Taller than what is left under it: the bottom edge sits below the window.
    const low = measureStage(rect(107, 500, 1066, 600), rect(0, 0, 1280, 800), true)!
    expect(playerInsets({ chrome: true, nav: 'top', stage: low, viewport, dpr: 1, uiScale: 1 }).bottom).toBe(-300)
    // Without `scrolls` the fixed layouts keep every edge inside the window.
    expect(measureStage(rect(107, -200, 1066, 600), rect(0, 0, 1280, 800))!.top).toBe(0)
  })

  it('keeps the stage its own size once the page has scrolled it wholly out of the window', () => {
    // Reading far down a discussion: a 922×518 stage 8636px above the window. Capping its bottom
    // edge at the window's top asked the native surface for 17272px at 2x, past the 16384px a
    // Direct3D texture can be.
    const gone = measureStage(rect(0, -8636, 922, 518), rect(0, 0, 1280, 800), true)!
    const insets = playerInsets({ chrome: true, nav: 'top', stage: gone, viewport, dpr: 2, uiScale: 1 })
    expect(insets).toEqual({ left: 0, top: -17272, right: 716, bottom: 17836 })
    expect(viewport.height * 2 - insets.top - insets.bottom).toBe(518 * 2)
  })

  it('compares insets by value so unchanged geometry is not re-sent', () => {
    expect(sameInsets({ left: 1, top: 2, right: 3, bottom: 4 }, { left: 1, top: 2, right: 3, bottom: 4 })).toBe(true)
    expect(sameInsets(null, { left: 0, top: 0, right: 0, bottom: 0 })).toBe(false)
    expect(sameInsets({ left: 1, top: 2, right: 3, bottom: 4 }, { left: 1, top: 2, right: 3, bottom: 5 })).toBe(false)
  })
})
