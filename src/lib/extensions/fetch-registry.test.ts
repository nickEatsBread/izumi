import { describe, expect, it } from 'vitest'
import { trackFetch, cancelExtensionFetches, fetchEpoch } from './fetch-registry'

describe('extension fetch registry', () => {
  it('aborts every in-flight controller and bumps the epoch', () => {
    const a = trackFetch(); const b = trackFetch()
    const before = fetchEpoch()
    cancelExtensionFetches()
    expect(a.controller.signal.aborted).toBe(true)
    expect(b.controller.signal.aborted).toBe(true)
    expect(fetchEpoch()).toBe(before + 1)
  })
  it('a completed fetch is not aborted later', () => {
    const a = trackFetch()
    a.done()
    cancelExtensionFetches()
    expect(a.controller.signal.aborted).toBe(false)
  })
})
