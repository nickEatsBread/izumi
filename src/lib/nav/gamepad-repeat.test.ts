import { describe, expect, it } from 'vitest'
import { REPEAT_STALL_MS, repeatAllowed } from './gamepad'

describe('held direction repeat', () => {
  it('repeats on ordinary frames and waits one frame after a stall', () => {
    expect(repeatAllowed(1000, 1016)).toBe(true)
    expect(repeatAllowed(1000, 1000 + REPEAT_STALL_MS)).toBe(true)
    // The step before scrolled and laid out for 350 ms: the release may still be queued.
    expect(repeatAllowed(1000, 1350)).toBe(false)
  })
})
