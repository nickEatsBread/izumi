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
})
