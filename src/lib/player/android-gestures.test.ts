import { describe, it, expect } from 'vitest'
import { zoneOf, classifyDrag, accumulateSeek } from './android-gestures'

describe('zoneOf', () => {
  it('splits the width into left/center/right thirds', () => {
    expect(zoneOf(10, 300)).toBe('l')
    expect(zoneOf(150, 300)).toBe('c')
    expect(zoneOf(290, 300)).toBe('r')
  })
})

describe('classifyDrag', () => {
  const s = { x: 150, y: 100, t: 0 }
  const W = 300, H = 300

  it('stays pending below the movement threshold', () => {
    expect(classifyDrag(s, { x: 155, y: 104, t: 1 }, W, H).kind).toBe('pending')
  })

  it('classifies dominant-horizontal travel as scrub', () => {
    expect(classifyDrag(s, { x: 200, y: 105, t: 1 }, W, H).kind).toBe('scrub')
  })

  it('classifies left-zone vertical travel as brightness (up = positive dy)', () => {
    const start = { x: 30, y: 150, t: 0 }
    const g = classifyDrag(start, { x: 32, y: 100, t: 1 }, W, H)
    expect(g.kind).toBe('brightness')
    expect(g.kind === 'brightness' && g.dy > 0).toBe(true)
  })

  it('classifies right-zone vertical travel as volume', () => {
    const start = { x: 280, y: 150, t: 0 }
    expect(classifyDrag(start, { x: 282, y: 100, t: 1 }, W, H).kind).toBe('volume')
  })

  it('ignores center-zone vertical travel', () => {
    expect(classifyDrag(s, { x: 152, y: 40, t: 1 }, W, H).kind).toBe('none')
  })

  it('suppresses swipes that begin in the bottom control band', () => {
    const start = { x: 30, y: 290, t: 0 } // within bottomIgnore (96) of H=300
    expect(classifyDrag(start, { x: 32, y: 240, t: 1 }, W, H).kind).toBe('none')
  })
})

describe('accumulateSeek', () => {
  it('grows in the tapped direction', () => {
    expect(accumulateSeek(null, 'r', 10)).toEqual({ dir: 'r', amt: 10 })
    expect(accumulateSeek({ dir: 'r', amt: 10 }, 'r', 10)).toEqual({ dir: 'r', amt: 20 })
  })
  it('resets when the direction flips', () => {
    expect(accumulateSeek({ dir: 'r', amt: 20 }, 'l', 10)).toEqual({ dir: 'l', amt: 10 })
  })
})
