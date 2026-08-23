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

/** Portrait swipe-down progress for collapsing the watch page into its in-app mini-player. */
export function miniPlayerPullProgress(start: Sample, cur: Sample, playerHeight: number): number {
  const dx = cur.x - start.x
  const dy = cur.y - start.y
  if (dy <= MOVE_PX || Math.abs(dy) <= Math.abs(dx)) return 0
  const travel = Math.min(280, Math.max(140, playerHeight * 0.75))
  return Math.min(1, dy / travel)
}

/** Commit a deliberate collapse or a quick downward fling. */
export function shouldMinimizePlayer(progress: number, velocityY: number): boolean {
  return progress >= 0.4 || velocityY >= 0.5
}

/**
 * YouTube-style direct manipulation for the portrait player. The whole clipped player grows only
 * modestly under the finger; the large geometry change belongs to Android's orientation transition
 * after release. Scaling the decoded video by 60% here made it crop and float over the watch page.
 */
export function fullscreenPullTransform(
  progress: number,
  playerHeight: number,
): { scale: number; translateY: number } {
  const p = Math.max(0, Math.min(1, progress))
  return {
    scale: 1 + p * 0.18,
    translateY: p === 0 ? 0 : -p * Math.max(0, playerHeight) * 0.02,
  }
}

/**
 * Progress for the landscape swipe-DOWN gesture that exits fullscreen back to the portrait inline
 * player — the mirror of `fullscreenPullProgress`. Only activates on a clearly downward drag where
 * vertical travel wins over horizontal, and never from the very top edge (a swipe there just reveals
 * the transient system bars). `viewportHeight` is the fullscreen height.
 */
export function landscapeExitProgress(
  start: Sample,
  cur: Sample,
  viewportHeight: number,
  topIgnore = 48,
): number {
  const dx = cur.x - start.x
  const dy = cur.y - start.y
  if (start.y < topIgnore || dy <= MOVE_PX || Math.abs(dy) <= Math.abs(dx)) return 0
  const travel = Math.min(280, Math.max(140, viewportHeight * 0.4))
  return Math.min(1, dy / travel)
}

/** Commit a deliberate downward pull or a downward fling; otherwise spring back to fullscreen. */
export function shouldExitFullscreen(progress: number, velocityY: number): boolean {
  return progress >= 0.4 || velocityY >= 0.5
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

/** Slop before a sheet touch commits to being a pull or a list scroll. */
export const SHEET_SLOP_PX = 8

/** Which gesture a touch anywhere on a bottom sheet turns into, once it clears the slop.
 *  `scrollTop` is the enclosing scroller's position, or null when the touch started outside any
 *  scroller (the handle/header). Pulling down wins only when the list has nothing left to scroll
 *  up into — the same rule every native bottom sheet uses, so the whole surface is draggable
 *  without stealing scrolls. Returns null while the movement is still ambiguous. */
export function sheetGestureIntent(
  dy: number,
  scrollTop: number | null,
  slop: number = SHEET_SLOP_PX,
): 'drag' | 'scroll' | null {
  if (Math.abs(dy) < slop) return null
  if (dy <= 0) return 'scroll'
  return scrollTop != null && scrollTop > 0 ? 'scroll' : 'drag'
}

/** Whether a drag has to call `setPointerCapture` to keep receiving moves.
 *
 *  Touch and pen are direct-manipulation devices: the browser IMPLICITLY captures the pointer to
 *  the element the gesture started on, so events keep arriving (and keep bubbling to the sheet)
 *  without asking. Capturing again on an ancestor moves the capture, and the retarget fires
 *  `lostpointercapture` at the element that held it — which bubbles straight back into the sheet's
 *  own cancel handler and kills the drag before it renders a single frame. A mouse has no implicit
 *  capture, so there it is still required or the drag dies the moment the cursor leaves the sheet. */
export function needsExplicitPointerCapture(pointerType: string | undefined): boolean {
  return pointerType !== 'touch' && pointerType !== 'pen'
}
