// Geometry for the API 6 expanding hover preview (`cardPreview: "expand"`): a box 1.5x the card's art,
// centred on it and kept inside the window, plus the transform origin that makes `scale(2/3)` sit exactly
// on the card. Inputs are screen px (getBoundingClientRect); outputs are local px for a fixed element —
// see preview-pos.ts for the zoom split.
import type { Viewport } from './preview-pos'
import { SIDEBAR_W } from './preview-pos'

export const EXPAND_SCALE = 1.5
/** The info block under the art (Netflix mini-modal: 369 - 201), local px; only used to keep the box on screen. */
export const EXPAND_INFO_H = 168
const EDGE = 8

export type CardBox = { left: number; top: number; width: number; height: number }
export type ExpandBox = { left: number; top: number; width: number; artHeight: number; originX: number; originY: number }

export function expandPos(card: CardBox, viewport: Viewport, zoom = 1, railLocal = SIDEBAR_W): ExpandBox {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const width = card.width * EXPAND_SCALE
  const artHeight = (width * 9) / 16
  const height = artHeight + EXPAND_INFO_H * z
  const edge = EDGE * z
  const rail = Math.max(0, railLocal) * z
  const cx = card.left + card.width / 2
  const cy = card.top + card.height / 2
  const left = Math.max(Math.max(rail, edge), Math.min(cx - width / 2, viewport.width - width - edge))
  const top = Math.max(edge, Math.min(cy - artHeight / 2, viewport.height - height - edge))
  return { left: left / z, top: top / z, width: width / z, artHeight: artHeight / z, originX: (cx - left) / z, originY: (cy - top) / z }
}
