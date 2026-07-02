import { describe, it, expect } from 'vitest'
import { pickInDirection } from './spatial'
const R = (x: number, y: number) => ({ left: x, top: y, right: x + 10, bottom: y + 10, width: 10, height: 10 } as DOMRect)
describe('pickInDirection', () => {
  const cur = R(100, 100)
  const cands = [ { id: 'right', rect: R(200, 100) }, { id: 'down', rect: R(100, 200) }, { id: 'far-right', rect: R(400, 100) } ]
  it('picks nearest to the right', () => expect(pickInDirection(cur, cands, 'right')?.id).toBe('right'))
  it('picks below for down', () => expect(pickInDirection(cur, cands, 'down')?.id).toBe('down'))
  it('returns null when nothing in that direction', () => expect(pickInDirection(cur, cands, 'left')).toBeNull())
})
