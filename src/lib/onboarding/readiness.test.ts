import { describe, expect, it } from 'vitest'
import { REMAINDER_ORDER } from './readiness'

describe('setup readiness', () => {
  it('orders the final review most consequential first', () => {
    // Only the ready screen reads this now — the home-screen checklist that also consumed it is
    // gone. Asserted as a literal so a silent reorder cannot pass.
    expect(REMAINDER_ORDER).toEqual(['sources', 'playback', 'tracker', 'metadata'])
  })
})
