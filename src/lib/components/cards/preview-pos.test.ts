import { describe, it, expect } from 'vitest'
import { previewPos, PREVIEW_W, PREVIEW_H, SIDEBAR_W } from './preview-pos'

const VP = { width: 1600, height: 900 }
// A card mid-screen, well clear of every clamp.
const card = { left: 700, top: 300, width: 152 }

describe('previewPos', () => {
  it('centres the popup on the card and lifts it slightly', () => {
    const p = previewPos(card, VP, 1)
    expect(p.left).toBe(700 + 152 / 2 - PREVIEW_W / 2) // 696
    expect(p.top).toBe(300 - 16)
  })

  it('keeps the popup clear of the sidebar rail', () => {
    expect(previewPos({ left: 0, top: 300, width: 152 }, VP, 1).left).toBe(SIDEBAR_W)
  })

  it('keeps the popup inside the right edge', () => {
    const p = previewPos({ left: VP.width - 152, top: 300, width: 152 }, VP, 1)
    expect(p.left).toBe(VP.width - PREVIEW_W - 8)
  })

  it('lifts the popup off the bottom edge for a card low on screen', () => {
    const p = previewPos({ left: 700, top: 850, width: 152 }, VP, 1)
    expect(p.top).toBe(VP.height - PREVIEW_H - 8)
  })

  // The regression: the UI-scale setting puts CSS `zoom` on <html>, which makes rects/innerWidth
  // screen px while the fixed popup's own left/top are multiplied by zoom on render. Mixing the
  // two shoved the popup to zoom× its intended offset — right and down, off the card.
  it('lands on the same screen position when the UI is zoomed', () => {
    const zoom = 1.25
    // Same card, now reported in screen px because the whole page is zoomed.
    const zoomed = { left: card.left * zoom, top: card.top * zoom, width: card.width * zoom }
    const p = previewPos(zoomed, VP, zoom)
    // Rendered position = local value × zoom. It must match the unzoomed result, scaled.
    const flat = previewPos(card, VP, 1)
    expect(p.left * zoom).toBeCloseTo(flat.left * zoom, 6)
    expect(p.top * zoom).toBeCloseTo(flat.top * zoom, 6)
    // Concretely: the same local offset as the unzoomed case (636), NOT the 795 the old
    // space-mixing math wrote, which the browser then multiplied by zoom again.
    expect(p.left).toBeCloseTo(636, 6)
  })

  it('clamps against the zoomed popup footprint, not the unzoomed one', () => {
    const zoom = 2
    // A card at the far right of a zoomed page. The popup is 560 screen px wide here, so the
    // clamp has to use that, not 280.
    const p = previewPos({ left: 1500, top: 300, width: 152 }, VP, zoom)
    expect(p.left * zoom).toBe(VP.width - PREVIEW_W * zoom - 8 * zoom)
  })

  it('falls back to zoom 1 for a bogus factor', () => {
    expect(previewPos(card, VP, 0)).toEqual(previewPos(card, VP, 1))
    expect(previewPos(card, VP, NaN)).toEqual(previewPos(card, VP, 1))
  })
})
