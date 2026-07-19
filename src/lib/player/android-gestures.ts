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
  if (adx >= ady) return { kind: 'scrub', dx } // horizontal intent
  if (start.y > height - bottomIgnore) return { kind: 'none' } // near controls: no swipe
  const zone = zoneOf(start.x, width)
  // Brightness gesture removed (left-zone vertical does nothing) — it caused accidental
  // brightness changes when reaching for play/pause. Only the right zone controls volume.
  if (zone === 'r') return { kind: 'volume', dy: -dy } // drag up = louder
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
