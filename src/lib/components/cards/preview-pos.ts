// Placement math for the card hover-preview popup, kept pure so it can be tested without a DOM.
//
// The popup is `position: fixed` so it escapes the carousel's horizontal overflow clipping, and
// it's clamped to the viewport so the sidebar rail and the screen edges never cut it off.
//
// The subtlety is the UI-scale setting, which applies CSS `zoom` to <html>. Zoom splits the page
// into two coordinate spaces:
//   - getBoundingClientRect() and window.inner* report SCREEN px (already multiplied by zoom)
//   - a fixed element's own left/top/width are LOCAL px, multiplied by zoom when rendered
// They coincide at zoom 1, so mixing them looks correct at the default scale and puts the popup
// at zoom× its intended offset at any other scale. Clamp in screen px, then convert back.

/** Popup footprint in local (unzoomed) CSS px — must match PreviewCard's own width/height. */
export const PREVIEW_W = 280
export const PREVIEW_H = 340
/** Left rail the popup must not slide under, in local px. */
export const SIDEBAR_W = 64
/** Breathing room from the viewport edges, and how far above the card the popup starts. */
const EDGE = 8
const RISE = 16

export type Rect = { left: number; top: number; width: number }
export type Viewport = { width: number; height: number }

/**
 * Where to pin the preview popup for a card.
 *
 * @param card     the card's rect, in screen px (straight from getBoundingClientRect)
 * @param viewport window.innerWidth/innerHeight, in screen px
 * @param zoom     effective CSS `zoom` on <html> (1 when unscaled)
 * @returns left/top in LOCAL px, ready to write to the fixed popup's style
 */
export function previewPos(card: Rect, viewport: Viewport, zoom = 1): { left: number; top: number } {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  // Everything below is screen px so it's comparable with `card` and `viewport`.
  const w = PREVIEW_W * z
  const h = PREVIEW_H * z
  const rail = SIDEBAR_W * z
  const edge = EDGE * z
  const centred = card.left + card.width / 2 - w / 2
  const left = Math.max(rail, Math.min(centred, viewport.width - w - edge))
  const top = Math.max(edge, Math.min(card.top - RISE * z, viewport.height - h - edge))
  return { left: left / z, top: top / z }
}

/** Effective `zoom` on the document root, or 1 when unset/unsupported. */
export function rootZoom(): number {
  if (typeof document === 'undefined') return 1
  const z = parseFloat(getComputedStyle(document.documentElement).zoom)
  return Number.isFinite(z) && z > 0 ? z : 1
}
