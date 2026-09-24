// Geometry and motion for the Android in-app mini-player, kept pure (no DOM, no timers) so the
// numbers that drive the drag, the release spring and the docked layout are one set of numbers.
//
// The model is YouTube's: the whole video rectangle is a sheet the finger holds. Its CENTRE moves
// with the finger 1:1 for the full distance between the resting portrait band and the dock, and it
// shrinks in proportion to how far along that path it is. The old mapping travelled ~3.6× the
// finger over a fixed 140–280px, so the video ran away from the thumb and then stopped dead.

import { MOVE_PX } from './android-gestures'

/** Docked bar height in CSS px; the thumbnail is this tall and 16:9 wide. */
export const MINI_BAR_HEIGHT = 64
/** Height of the BottomNav slot the bar rests on — the same 4rem `<main>` reserves for it. */
export const BOTTOM_NAV_HEIGHT = 64

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface MiniTransform {
  scale: number
  tx: number
  ty: number
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Where the docked thumbnail sits: flush left, directly above the bottom navigation. CSS px in
 *  the viewport, with `safeBottom` the CSS `env(safe-area-inset-bottom)` — the same value the
 *  docked layout is styled with, so the spring lands exactly on the settled rectangle. */
export function miniDockGeometry(
  viewport: { width: number; height: number },
  safeBottom: number,
  navHeight = BOTTOM_NAV_HEIGHT,
  barHeight = MINI_BAR_HEIGHT,
): Rect {
  const height = barHeight
  const width = Math.round(height * 16 / 9)
  return { left: 0, top: viewport.height - safeBottom - navHeight - height, width, height }
}

/** Finger travel (px) that maps to progress 1: the distance the video's centre has to move from
 *  its resting rect to the dock. */
export function miniPullTravel(source: Rect, target: Rect): number {
  return Math.max(1, (target.top + target.height / 2) - (source.top + source.height / 2))
}

/** Progress for a recognized pull. The recognition slop is subtracted so the sheet starts moving
 *  from where the finger is, not 18px behind it (the old first frame jumped ~10% at recognition). */
export function miniPullProgress(dy: number, travel: number, slop = MOVE_PX): number {
  return clamp01((dy - slop) / Math.max(1, travel))
}

/** Scale + translate (CSS px, centre pivot — the native container pivots at its centre too) that
 *  places the source rect `p` of the way toward the target. Both rects are 16:9, so one uniform
 *  scale keeps the video exactly inside its frame at every step. */
export function miniPullTransform(p: number, source: Rect, target: Rect): MiniTransform {
  const k = clamp01(p)
  if (k === 0) return { scale: 1, tx: 0, ty: 0 }
  const scale = 1 + (target.width / Math.max(1, source.width) - 1) * k
  const cx0 = source.left + source.width / 2
  const cy0 = source.top + source.height / 2
  const cx1 = target.left + target.width / 2
  const cy1 = target.top + target.height / 2
  return { scale, tx: (cx1 - cx0) * k, ty: (cy1 - cy0) * k }
}

/** How far the video's BOTTOM edge has moved at `p`, so the watch page under it can travel with
 *  it as one sheet instead of the video sliding over a page that stays put. */
export function miniDetailsShift(p: number, source: Rect, target: Rect): number {
  const t = miniPullTransform(p, source, target)
  const restingBottom = source.top + source.height
  const movedBottom = source.top + source.height / 2 + t.ty + (source.height * t.scale) / 2
  return movedBottom - restingBottom
}

/** Release decision from the drag's final progress and finger velocity (px/ms, + = down). A fling
 *  in either direction wins outright; a slow release commits past about a third of the trip. */
export function miniPullOutcome(progress: number, velocityY: number): 'dock' | 'restore' {
  if (velocityY >= 0.35) return 'dock'
  if (velocityY <= -0.35) return 'restore'
  return progress >= 0.35 ? 'dock' : 'restore'
}

/** Dismissing the docked bar: a pull past half its height or a downward fling closes playback. */
export function miniDismissOutcome(distance: number, velocityY: number, barHeight = MINI_BAR_HEIGHT): 'close' | 'keep' {
  if (velocityY >= 0.4) return 'close'
  if (velocityY <= -0.2) return 'keep'
  return distance >= barHeight * 0.5 ? 'close' : 'keep'
}

/** Finger velocity in px/ms, stale when the finger rested before lifting — a pause then a lift is
 *  not a fling, whatever the last movement was. */
export function releaseVelocity(velocityPxPerMs: number, msSinceLastMove: number, staleAfterMs = 100): number {
  return msSinceLastMove > staleAfterMs ? 0 : velocityPxPerMs
}

/** Finger velocity (px/ms) → progress per second, the spring's unit. */
export const velocityToProgress = (velocityPxPerMs: number, travelPx: number) =>
  (velocityPxPerMs * 1000) / Math.max(1, travelPx)

// ── Spring ─────────────────────────────────────────────────────────────────────────────────────
// A damped spring in progress units, stepped per animation frame with the release velocity as its
// initial velocity. Unlike the fixed 240ms ease it replaces, a fast fling arrives fast and a gentle
// release settles gently, and the motion is continuous with the finger's.

export interface SpringState {
  x: number
  v: number
}

/** Near-critically damped (ratio ≈ 0.95): settles in roughly 300ms from rest, no visible bounce. */
export const DOCK_SPRING = { stiffness: 320, damping: 34 } as const

/** Semi-implicit Euler with ≤8ms substeps, so a dropped frame cannot make the spring explode. */
export function stepSpring(
  state: SpringState,
  target: number,
  dtMs: number,
  { stiffness, damping }: { stiffness: number; damping: number } = DOCK_SPRING,
): SpringState {
  let { x, v } = state
  let remaining = Math.min(Math.max(0, dtMs), 64) / 1000
  while (remaining > 0) {
    const h = Math.min(remaining, 0.008)
    const a = -stiffness * (x - target) - damping * v
    v += a * h
    x += v * h
    remaining -= h
  }
  return { x, v }
}

export function springSettled(state: SpringState, target: number, epsilon = 0.002): boolean {
  return Math.abs(state.x - target) < epsilon && Math.abs(state.v) < epsilon * 10
}
