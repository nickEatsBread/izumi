import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { idle } from './idle'

// WebKit has never shipped requestIdleCallback, so on the Deck and every Linux build the timeout
// path is the ONLY path. It used to clamp the delay to 1s, which collapsed the boot warmers' whole
// stagger onto one tick: the id map's multi-megabyte download and parse (meant for 3s), the
// extension workers (5s) and the player chunk (6s) all fired together, while the home page was
// still loading its first covers on a cold cache. That is the "first ever boot was insanely slow"
// report; a warm start hid it because everything was already cached.

const original = globalThis.window

beforeEach(() => {
  vi.useFakeTimers()
  // A WebKit-shaped window: no requestIdleCallback.
  ;(globalThis as { window?: unknown }).window = {}
})

afterEach(() => {
  vi.useRealTimers()
  ;(globalThis as { window?: unknown }).window = original
})

describe('idle without requestIdleCallback', () => {
  it('waits the full requested delay rather than clamping it', () => {
    const fn = vi.fn()
    idle(fn, 6000)
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled() // the clamp used to fire here
    vi.advanceTimersByTime(5000)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('preserves the ordering the callers asked for', () => {
    const order: string[] = []
    idle(() => order.push('idmap'), 3000)
    idle(() => order.push('extensions'), 5000)
    idle(() => order.push('player'), 6000)
    vi.advanceTimersByTime(6000)
    expect(order).toEqual(['idmap', 'extensions', 'player'])
  })

  it('can still be cancelled', () => {
    const fn = vi.fn()
    idle(fn, 3000).cancel()
    vi.advanceTimersByTime(10_000)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('idle with requestIdleCallback', () => {
  it('defers to the platform implementation and passes the timeout through', () => {
    const requestIdleCallback = vi.fn((cb: () => void) => { cb(); return 7 })
    const cancelIdleCallback = vi.fn()
    ;(globalThis as { window?: unknown }).window = { requestIdleCallback, cancelIdleCallback }
    const fn = vi.fn()
    const handle = idle(fn, 4000)
    expect(requestIdleCallback).toHaveBeenCalledWith(fn, { timeout: 4000 })
    expect(fn).toHaveBeenCalledOnce()
    handle.cancel()
    expect(cancelIdleCallback).toHaveBeenCalledWith(7)
  })
})
