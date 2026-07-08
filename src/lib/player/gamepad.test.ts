import { describe, it, expect, vi } from 'vitest'
import { TriggerScrubber, SEEK } from './gamepad'

function deps(pos = 100, dur = 1000) {
  return {
    getPos: () => pos,
    getDur: () => dur,
    seek: vi.fn(),
    beginScrub: vi.fn(),
    moveScrub: vi.fn(),
    endScrub: vi.fn(),
    onActivity: vi.fn(),
  }
}

describe('TriggerScrubber', () => {
  it('a quick tap forward seeks by SEEK.tap seconds (clamped)', () => {
    const d = deps(100, 1000)
    const s = new TriggerScrubber(+1, d)
    s.update(true, 0)
    s.update(false, 100)
    expect(d.seek).toHaveBeenCalledWith(110)
    expect(d.beginScrub).not.toHaveBeenCalled()
  })

  it('a quick tap backward is clamped at 0', () => {
    const d = deps(5, 1000)
    const s = new TriggerScrubber(-1, d)
    s.update(true, 0)
    s.update(false, 100)
    expect(d.seek).toHaveBeenCalledWith(0)
  })

  it('holding enters a preview scrub and advances by STEP, committing on release', () => {
    const d = deps(100, 1000)
    const s = new TriggerScrubber(+1, d)
    s.update(true, 0)
    s.update(true, SEEK.initialDelay)
    expect(d.beginScrub).toHaveBeenCalledWith(100)
    expect(d.moveScrub).toHaveBeenLastCalledWith(100 + SEEK.step)
    s.update(false, SEEK.initialDelay + 40)
    expect(d.endScrub).toHaveBeenCalledTimes(1)
    expect(d.seek).not.toHaveBeenCalled()
  })

  it('preview is clamped to [0, dur]', () => {
    const d = deps(995, 1000)
    const s = new TriggerScrubber(+1, d)
    s.update(true, 0)
    s.update(true, SEEK.initialDelay)
    expect(d.moveScrub).toHaveBeenLastCalledWith(1000)
  })

  it('does not clamp to zero while duration is still unknown', () => {
    const d = deps(100, 0)
    const s = new TriggerScrubber(+1, d)
    s.update(true, 0)
    s.update(false, 100)
    expect(d.seek).toHaveBeenCalledWith(110)
  })
})
