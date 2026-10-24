export type Dir = 'up' | 'down' | 'left' | 'right'
export interface Cand { id: string; rect: DOMRect }
const center = (r: DOMRect) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 })
// `cone` (default true) keeps the pick within ~45° of the pressed direction. Pass false for a
// deliberate REGION crossing (e.g. LEFT at a row's edge → the sidebar, which may sit well above
// or below the current row) where only the half-plane, not the alignment, should matter.
export function pickInDirection<T extends Cand>(cur: DOMRect, cands: T[], dir: Dir, cone = true): T | null {
  const c = center(cur)
  const vertical = dir === 'up' || dir === 'down'
  const sign = dir === 'down' || dir === 'right' ? 1 : -1
  let best: T | null = null, bestScore = Infinity
  for (const cand of cands) {
    const t = center(cand.rect)
    const dx = t.x - c.x, dy = t.y - c.y
    // Distance ALONG the travel axis (must be positive) + the OFF-axis offset.
    const along = (vertical ? dy : dx) * sign
    if (along <= 0) continue
    const cross = Math.abs(vertical ? dx : dy)
    if (cone && cross > along) continue // stay within ~45° of the pressed direction
    // Weight the off-axis distance heavily (×4) so a well-ALIGNED target (the next row
    // straight down / the neighbour straight across) beats a diagonal one that's merely
    // euclidean-closer — e.g. a sidebar link sitting below-and-left.
    const score = along * along + cross * cross * 4
    if (score < bestScore) { bestScore = score; best = cand }
  }
  return best
}

/** The [data-nav-line] (one visual line of controls, e.g. a settings row's header) that `el` sits on,
 *  unless a menu opened inside that line (an absolute SelectMenu or MultiSelect panel) holds it. */
export function navLine(el: Element): Element | null {
  const line = el.closest('[data-nav-line]')
  return line && !line.contains(el.closest('[data-nav-trap]')) ? line : null
}

/** The box a directional move measures `el` by. On Up/Down a control on a [data-nav-line] counts as
 *  that whole line, and outside one a control marked data-nav-measure-row (an inline SelectMenu
 *  trigger) as its [data-setting-key] row, so the full-width row above or below reaches a narrow
 *  right-aligned control instead of skipping it. Left/Right keep its own box, so they still step
 *  between the controls of one line; from the line's centre, Right would jump to the next row. */
export function navRect(el: Element, vertical = true): DOMRect {
  const box = !vertical ? null
    : navLine(el) ?? (el.hasAttribute('data-nav-measure-row') ? el.closest('[data-setting-key]') : null)
  return (box ?? el).getBoundingClientRect()
}
