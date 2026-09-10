import { describe, expect, it } from 'vitest'
import { REMAINDER_ORDER, remainderFrom, type SetupReadiness } from './readiness'

const ready: SetupReadiness = { sources: true, playback: true, tracker: true, metadata: true }

describe('setup remainder', () => {
  it('is empty when everything resolved', () => {
    expect(remainderFrom(ready)).toEqual([])
  })

  it('lists the unresolved items most important first', () => {
    // Asserted as a literal, not against REMAINDER_ORDER: remainderFrom filters that same array,
    // so comparing the two would hold whatever order it had, and a silent swap would pass.
    expect(remainderFrom({ sources: false, playback: false, tracker: false, metadata: false }))
      .toEqual(['sources', 'playback', 'tracker', 'metadata'])
    expect(REMAINDER_ORDER).toEqual(['sources', 'playback', 'tracker', 'metadata'])
  })

  it('reports only what is actually missing', () => {
    expect(remainderFrom({ ...ready, tracker: false })).toEqual(['tracker'])
    expect(remainderFrom({ ...ready, sources: false, metadata: false })).toEqual(['sources', 'metadata'])
  })
})
