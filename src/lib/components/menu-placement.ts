// Which side of its trigger a dropdown opens on, kept pure so it can be tested without a DOM.
//
// A menu that always hangs below its trigger runs straight off the bottom of the screen when the
// trigger sits low — the list is unreachable, and because the panel is absolutely/fixed positioned
// the page does not scroll to it either. The fix is to measure both halves of the viewport, flip up
// when below is the worse one, and cap the height to the room the chosen side actually has so the
// menu scrolls internally instead of overflowing.
//
// Note the coordinate spaces (see also preview-pos.ts): getBoundingClientRect and window.innerHeight
// report SCREEN px, already multiplied by any CSS `zoom` uiScale applies to <html>, while the
// max-height written on the element renders in LOCAL px. Callers hand this function screen px and a
// zoom factor; everything it returns is local px.

/** Room to leave between the trigger and the menu, and between the menu and the screen edge. */
const GAP = 4
const EDGE = 8

export type MenuPlacement = {
  side: 'down' | 'up'
  /** Cap for the menu's height, in local px. */
  maxHeight: number
}

export type PlacementInput = {
  /** Trigger rect in screen px — `top` and `bottom` straight from getBoundingClientRect. */
  top: number
  bottom: number
  /** window.innerHeight, in screen px. */
  viewport: number
  /** Effective CSS `zoom` on <html> (1 when unscaled). */
  zoom?: number
  /** The menu's natural height in LOCAL px once rendered; an estimate before that. */
  content?: number
  /** Height to assume when `content` is unknown. */
  desired?: number
  /** Floor for the cap: below this a menu is too stubby to be worth flipping for. */
  minHeight?: number
}

export function menuPlacement({
  top, bottom, viewport, zoom = 1, content, desired = 260, minHeight = 132,
}: PlacementInput): MenuPlacement {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const below = (viewport - bottom) / z - GAP - EDGE
  const above = top / z - GAP - EDGE
  const want = content ?? desired
  // Stay below whenever the menu fits there, or when below is simply the roomier half — flipping a
  // menu that fits is as disorienting as one that runs off-screen.
  const side = below >= want || below >= above ? 'down' : 'up'
  return { side, maxHeight: Math.max(minHeight, side === 'down' ? below : above) }
}

export type CentreInput = {
  /** The entry's top edge from the top of the list's scrolled content, in local px. */
  itemTop: number
  itemHeight: number
  /** The list's visible height (clientHeight) and the height of everything in it (scrollHeight). */
  viewHeight: number
  contentHeight: number
}

/** The scroll offset that puts an entry in the middle of a scrolling list, as far as the list scrolls. */
export function centredScrollTop({ itemTop, itemHeight, viewHeight, contentHeight }: CentreInput): number {
  const max = Math.max(0, contentHeight - viewHeight)
  return Math.min(max, Math.max(0, itemTop - (viewHeight - itemHeight) / 2))
}
