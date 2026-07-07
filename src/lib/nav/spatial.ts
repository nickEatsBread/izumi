export type Dir = 'up' | 'down' | 'left' | 'right'
export interface Cand { id: string; rect: DOMRect }
const center = (r: DOMRect) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 })
export function pickInDirection<T extends Cand>(cur: DOMRect, cands: T[], dir: Dir): T | null {
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
    if (cross > along) continue // stay within ~45° of the pressed direction
    // Weight the off-axis distance heavily (×4) so a well-ALIGNED target (the next row
    // straight down / the neighbour straight across) beats a diagonal one that's merely
    // euclidean-closer — e.g. a sidebar link sitting below-and-left.
    const score = along * along + cross * cross * 4
    if (score < bestScore) { bestScore = score; best = cand }
  }
  return best
}
