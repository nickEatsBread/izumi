import { describe, expect, it, vi } from 'vitest'
import { ActiveFrameLoop } from './active-frame-loop'

function frames() {
  let next = 0
  const pending = new Map<number, FrameRequestCallback>()
  const schedule = vi.fn((callback: FrameRequestCallback) => {
    const id = ++next
    pending.set(id, callback)
    return id
  })
  const cancel = vi.fn((id: number) => pending.delete(id))
  const run = () => {
    const entry = pending.entries().next().value
    if (!entry) return
    const [id, callback] = entry
    pending.delete(id)
    callback(performance.now())
  }
  return { pending, schedule, cancel, run }
}

describe('ActiveFrameLoop', () => {
  it('does no frame work until started and deduplicates starts', () => {
    const f = frames()
    const loop = new ActiveFrameLoop(() => true, f.schedule, f.cancel)

    expect(f.pending.size).toBe(0)
    loop.start()
    loop.start()
    expect(f.pending.size).toBe(1)
  })

  it('stops scheduling as soon as the work predicate clears', () => {
    const f = frames()
    const active = [true, false]
    const loop = new ActiveFrameLoop(() => active.shift() ?? false, f.schedule, f.cancel)

    loop.start()
    f.run()
    expect(f.pending.size).toBe(1)
    f.run()
    expect(f.pending.size).toBe(0)
  })

  it('cancels a pending frame when explicitly stopped', () => {
    const f = frames()
    const loop = new ActiveFrameLoop(() => true, f.schedule, f.cancel)

    loop.start()
    loop.stop()
    expect(f.cancel).toHaveBeenCalledOnce()
    expect(f.pending.size).toBe(0)
  })

  it('calls the real frame functions as globals, never on itself', () => {
    // A browser rejects requestAnimationFrame called on any object but the window.
    const strict = <T,>(result: T) => vi.fn(function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Can only call Window.requestAnimationFrame on instances of Window')
      return result
    })
    const raf = strict(7)
    const caf = strict(undefined)
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', caf)
    try {
      const loop = new ActiveFrameLoop(() => true)
      expect(() => loop.start()).not.toThrow()
      expect(() => loop.stop()).not.toThrow()
      expect(raf).toHaveBeenCalledOnce()
      expect(caf).toHaveBeenCalledWith(7)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
