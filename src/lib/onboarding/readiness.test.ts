import { describe, expect, it } from 'vitest'
import { REMAINDER_ORDER } from './readiness'

describe('setup readiness', () => {
  it('reports only what decides whether anything plays, most consequential first', () => {
    // Trackers and the TMDB key are optional extras on the final screen, not status rows.
    // Asserted as a literal so a silent reorder cannot pass.
    expect(REMAINDER_ORDER).toEqual(['sources', 'playback'])
  })
})
