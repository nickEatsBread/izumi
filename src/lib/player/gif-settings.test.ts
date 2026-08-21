import { describe, expect, it } from 'vitest'
import { gifCapturePlan } from './gif-settings'

describe('gifCapturePlan', () => {
  it('uses anime-GIF defaults for unknown values', () => {
    const plan = gifCapturePlan(0, 0, 0)
    expect(plan.fps).toBe(15)
    expect(plan.width).toBe(720)
    expect(plan.maxSeconds).toBe(10)
    expect(plan.intervalMs).toBe(67)
    expect(plan.maxFrames).toBe(154)
  })

  it('keeps an explicit high-quality plan', () => {
    const plan = gifCapturePlan(24, 960, 15)
    expect(plan.fps).toBe(24)
    expect(plan.width).toBe(960)
    expect(plan.maxSeconds).toBe(15)
    expect(plan.intervalMs).toBe(42)
    expect(plan.maxFrames).toBe(364)
  })
})
