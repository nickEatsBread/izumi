export type Dir = 'up' | 'down' | 'left' | 'right'
export interface Cand { id: string; rect: DOMRect }
const center = (r: DOMRect) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 })
export function pickInDirection<T extends Cand>(cur: DOMRect, cands: T[], dir: Dir): T | null {
  const c = center(cur)
  let best: T | null = null, bestD = Infinity
  for (const cand of cands) {
    const t = center(cand.rect)
    const dx = t.x - c.x, dy = t.y - c.y
    const ok = dir === 'right' ? dx > 0 && Math.abs(dx) >= Math.abs(dy)
             : dir === 'left'  ? dx < 0 && Math.abs(dx) >= Math.abs(dy)
             : dir === 'down'  ? dy > 0 && Math.abs(dy) >= Math.abs(dx)
             :                   dy < 0 && Math.abs(dy) >= Math.abs(dx)
    if (!ok) continue
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = cand }
  }
  return best
}
