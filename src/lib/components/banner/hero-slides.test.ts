import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSlideScheduler } from './hero-slides'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('featured slide scheduler', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('commits immediately when the artwork has already decoded', async () => {
    const commit = vi.fn()
    const scheduler = createSlideScheduler({ decode: () => Promise.resolve(true), commit })
    scheduler.warm(['a.jpg'])
    await vi.advanceTimersByTimeAsync(0)
    expect(scheduler.ready(['a.jpg'])).toBe(true)
    scheduler.request(2, 1, ['a.jpg'])
    expect(commit).toHaveBeenCalledWith(2, 1, true)
    expect(scheduler.pending()).toBeNull()
  })

  it('holds the swap until the incoming artwork has decoded, then commits once', async () => {
    const commit = vi.fn()
    const gate = deferred<boolean>()
    const scheduler = createSlideScheduler({ decode: () => gate.promise, commit, deadlineMs: 900 })
    scheduler.request(1, 1, ['b.jpg'])
    expect(commit).not.toHaveBeenCalled()
    expect(scheduler.pending()).toBe(1)
    gate.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(1, 1, true)
    // The deadline that was armed for this request must not fire a second commit later.
    await vi.advanceTimersByTimeAsync(2000)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('swaps anyway after the deadline and ignores the late decode', async () => {
    const commit = vi.fn()
    const gate = deferred<boolean>()
    const scheduler = createSlideScheduler({ decode: () => gate.promise, commit, deadlineMs: 300 })
    scheduler.request(3, -1, ['c.jpg'])
    await vi.advanceTimersByTimeAsync(300)
    expect(commit).toHaveBeenCalledWith(3, -1, false)
    gate.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(commit).toHaveBeenCalledTimes(1)
    // The decode still counts: the next visit to this slide is instant.
    expect(scheduler.ready(['c.jpg'])).toBe(true)
  })

  it('lets a newer request supersede a pending one', async () => {
    const commit = vi.fn()
    const gates = new Map<string, ReturnType<typeof deferred<boolean>>>()
    const scheduler = createSlideScheduler({
      decode: (src) => { const gate = deferred<boolean>(); gates.set(src, gate); return gate.promise },
      commit,
    })
    scheduler.request(1, 1, ['one.jpg'])
    scheduler.request(2, 1, ['two.jpg'])
    expect(scheduler.pending()).toBe(2)
    gates.get('one.jpg')!.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(commit).not.toHaveBeenCalled()
    gates.get('two.jpg')!.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(2, 1, true)
  })

  it('remembers a failed decode so a broken image never blocks or refetches again', async () => {
    const commit = vi.fn()
    const decode = vi.fn(() => Promise.resolve(false))
    const scheduler = createSlideScheduler({ decode, commit })
    scheduler.request(4, 1, ['broken.jpg'])
    await vi.advanceTimersByTimeAsync(0)
    expect(commit).toHaveBeenCalledWith(4, 1, false)
    scheduler.request(4, 1, ['broken.jpg'])
    expect(commit).toHaveBeenCalledTimes(2)
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight decode between a warm-up and a request', async () => {
    const commit = vi.fn()
    const gate = deferred<boolean>()
    const decode = vi.fn(() => gate.promise)
    const scheduler = createSlideScheduler({ decode, commit })
    scheduler.warm(['shared.jpg', ''])
    scheduler.request(5, 1, ['shared.jpg'])
    expect(decode).toHaveBeenCalledTimes(1)
    gate.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(commit).toHaveBeenCalledWith(5, 1, true)
  })

  it('cancel drops the pending slide without committing it', async () => {
    const commit = vi.fn()
    const gate = deferred<boolean>()
    const scheduler = createSlideScheduler({ decode: () => gate.promise, commit, deadlineMs: 100 })
    scheduler.request(6, 1, ['x.jpg'])
    scheduler.cancel()
    expect(scheduler.pending()).toBeNull()
    gate.resolve(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(commit).not.toHaveBeenCalled()
  })
})
