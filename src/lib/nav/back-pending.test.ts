import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACK_PENDING_MS, backPending, clearBackPending, markBackPending, resetNavStateForTests } from './nav-state'

beforeEach(() => {
  vi.useFakeTimers()
  clearBackPending()
})
afterEach(() => {
  clearBackPending()
  vi.useRealTimers()
})

describe('Back pending guard', () => {
  it('is set by a Back that starts a navigation and cleared when that navigation lands', () => {
    expect(backPending()).toBe(false)
    markBackPending()
    expect(backPending()).toBe(true)
    clearBackPending()
    expect(backPending()).toBe(false)
  })

  it('clears itself when no navigation lands (a history step with nothing behind it)', () => {
    markBackPending()
    vi.advanceTimersByTime(BACK_PENDING_MS - 1)
    expect(backPending()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(backPending()).toBe(false)
  })

  it('restarts its window on a second mark', () => {
    markBackPending()
    vi.advanceTimersByTime(1000)
    markBackPending()
    vi.advanceTimersByTime(1000)
    expect(backPending()).toBe(true)
    vi.advanceTimersByTime(BACK_PENDING_MS - 1000)
    expect(backPending()).toBe(false)
  })

  it('is cleared by resetNavStateForTests', () => {
    markBackPending()
    resetNavStateForTests()
    expect(backPending()).toBe(false)
  })
})
