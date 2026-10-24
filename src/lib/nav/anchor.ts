// Anchored rows (a theme's `rows.*.focus: "anchor"`): the focused card holds the first column and
// the focused row snaps under the top bar, on the reference TV app's curve. Pure math plus a small
// rAF animator; revealFocused (nav/index.ts) does the layout reads.

/** The track's slide when focus moves along an anchored row. */
export const ANCHOR_SLIDE_MS = 650
/** The page's snap when focus enters an anchored row. */
export const ANCHOR_SNAP_MS = 830

/** One axis of a cubic Bézier from (0,0) to (1,1) with control values p1, p2, at parameter u. */
const bezier = (u: number, p1: number, p2: number) => 3 * p1 * u * (1 - u) ** 2 + 3 * p2 * (1 - u) * u ** 2 + u ** 3

/** cubic-bezier(.2,.8,.2,1) as y(t): bisection finds the u where x(u) = t (x rises monotonically,
 *  as both x control points lie in [0, 1]; 40 halvings is ~1e-12), clamped to [0, 1]. */
export function anchorEase(t: number): number {
  if (!(t > 0)) return 0
  if (t >= 1) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (bezier(mid, 0.2, 0.2) < t) lo = mid
    else hi = mid
  }
  return bezier((lo + hi) / 2, 0.8, 1)
}

const clampScroll = (value: number, max: number) => Math.max(0, Math.min(value, max))

/** The track scrollLeft that puts the focused card's left edge on the track's content start. */
export function anchorScrollLeft(o: { cardLeft: number; trackLeft: number; paddingLeft: number; scrollLeft: number; maxScroll: number }): number {
  return clampScroll(o.scrollLeft + o.cardLeft - o.trackLeft - o.paddingLeft, o.maxScroll)
}

/** The window scrollY that puts the row's top `offset` px below the viewport top. */
export function anchorScrollTop(o: { rowTop: number; scrollY: number; offset: number; maxScroll: number }): number {
  return clampScroll(o.scrollY + o.rowTop - o.offset, o.maxScroll)
}

const running = new WeakMap<object, () => void>()

/** Stop the animation running on `key`, if any. */
export function stopScroll(key: object): void {
  running.get(key)?.()
}

/** Animates `get`/`set` from the current value to `to` over `ms` with anchorEase; returns cancel.
 *  ms <= 0 sets at once. A new animation on the same key cancels the previous one. */
export function animateScroll(key: object, get: () => number, set: (v: number) => void, to: number, ms: number): () => void {
  stopScroll(key)
  const from = get()
  if (ms <= 0 || from === to) {
    set(to)
    return () => {}
  }
  let start: number | undefined
  let frame = requestAnimationFrame(function step(now) {
    start ??= now
    const t = Math.min(1, (now - start) / ms)
    set(t < 1 ? from + (to - from) * anchorEase(t) : to)
    if (t < 1) frame = requestAnimationFrame(step)
    else running.delete(key)
  })
  const cancel = () => {
    cancelAnimationFrame(frame)
    if (running.get(key) === cancel) running.delete(key)
  }
  running.set(key, cancel)
  return cancel
}
