import { describe, it, expect } from 'vitest'
import { RepeatTimer } from './repeat'

describe('RepeatTimer', () => {
  const cfg = { initialDelay: 250, startInterval: 250, minInterval: 60, ramp: 1600 }

  it('does not tick before the initial delay', () => {
    const t = new RepeatTimer(cfg)
    t.press(0)
    expect(t.tick(100)).toBe(false)
    expect(t.tick(249)).toBe(false)
  })

  it('ticks at the initial delay, then at the (shrinking) interval', () => {
    const t = new RepeatTimer(cfg)
    t.press(0)
    expect(t.tick(250)).toBe(true)
    expect(t.tick(400)).toBe(false)
    expect(t.tick(500)).toBe(true)
  })

  it('accelerates: intervals shrink toward minInterval as the hold ramps', () => {
    const early = firstGap(250)
    const late = firstGap(250 + 1600)
    expect(late).toBeLessThan(early)
  })

  it('stops ticking after release', () => {
    const t = new RepeatTimer(cfg)
    t.press(0)
    t.tick(250)
    t.release()
    expect(t.tick(600)).toBe(false)
  })
})

function firstGap(holdAt: number): number {
  const t = new RepeatTimer({ initialDelay: 250, startInterval: 250, minInterval: 60, ramp: 1600 })
  t.press(0)
  t.tick(holdAt)
  for (let n = holdAt + 1; n < holdAt + 400; n++) {
    if (t.tick(n)) return n - holdAt
  }
  return 400
}
