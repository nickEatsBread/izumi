// Pure gesture recognizer for the Android touch player. No DOM, no timers — the component
// feeds it pointer samples + viewport metrics and locks onto the first non-pending kind.

export type Zone = 'l' | 'c' | 'r'
export interface Sample {
  x: number
  y: number
  t: number
}
export type Gesture =
  | { kind: 'pending' }
  | { kind: 'none' }
  | { kind: 'scrub'; dx: number }
  | { kind: 'brightness'; dy: number }
  | { kind: 'volume'; dy: number }

/** Travel (px) before a drag is classified as anything. Higher = a slightly-wobbly tap (e.g.
 *  reaching for play/pause) stays a tap instead of misfiring as a swipe. */
export const MOVE_PX = 18
/** Press duration (ms) with no travel that triggers hold-to-2× (component-side timer). */
export const HOLD_MS = 350
/** Window (ms) to pair two taps into a double-tap (component-side timer). */
export const DOUBLE_TAP_MS = 280

/**
 * Progress for the portrait-player pull-up gesture. It only activates when the drag starts in
 * the lower half of the video and vertical travel clearly wins over horizontal travel, so it
 * cannot steal ordinary taps or timeline/horizontal scrubs.
 */
export function fullscreenPullProgress(
  start: Sample,
  cur: Sample,
  playerTop: number,
  playerHeight: number,
): number {
  const dx = cur.x - start.x
  const dy = cur.y - start.y
  if (start.y < playerTop + playerHeight * 0.45 || dy >= -MOVE_PX || Math.abs(dy) <= Math.abs(dx)) return 0
  const travel = Math.min(240, Math.max(120, playerHeight * 0.55))
  return Math.min(1, -dy / travel)
}

/** Commit a deliberate pull or a short upward fling; otherwise spring the player back. */
export function shouldEnterFullscreen(progress: number, velocityY: number): boolean {
  return progress >= 0.45 || velocityY <= -0.5
}

export function zoneOf(x: number, width: number): Zone {
  if (x < width / 3) return 'l'
  if (x > (2 * width) / 3) return 'r'
  return 'c'
}

/**
 * Classify an in-progress drag from its start + latest sample.
 * `bottomIgnore` = px band at the bottom (scrubber/controls) where vertical swipes are
 * suppressed so control interaction never reads as brightness/volume.
 */
export function classifyDrag(
  start: Sample,
  cur: Sample,
  width: number,
  height: number,
  bottomIgnore = 96,
): Gesture {
  const dx = cur.x - start.x
  const dy = cur.y - start.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx < MOVE_PX && ady < MOVE_PX) return { kind: 'pending' }
  if (adx >= ady) return { kind: 'scrub', dx } // horizontal intent → scrub
  // Vertical swipes do nothing: both the brightness (left) and volume (right) shortcuts were
  // removed — they caused accidental changes when reaching for play/pause.
  return { kind: 'none' }
}

/** Accumulating double-tap seek counter — grows in one direction, resets when it flips. */
export function accumulateSeek(
  prev: { dir: 'l' | 'r'; amt: number } | null,
  dir: 'l' | 'r',
  step: number,
): { dir: 'l' | 'r'; amt: number } {
  if (prev && prev.dir === dir) return { dir, amt: prev.amt + step }
  return { dir, amt: step }
}

/** Material-style bottom sheets dismiss after a meaningful pull or a deliberate downward fling. */
export function shouldDismissSheet(distance: number, velocityY: number, viewportHeight: number): boolean {
  const distanceThreshold = Math.min(160, Math.max(80, viewportHeight * 0.15))
  return distance >= distanceThreshold || velocityY >= 0.5
}
