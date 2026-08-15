import { describe, expect, it } from 'vitest'
import { SourceScheduler, adaptiveSourceConcurrency } from './source-scheduler'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const flushScheduledWork = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe('extension source scheduling', () => {
  it('keeps provider fan-out within the device budget', async () => {
    const scheduler = new SourceScheduler(2)
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()]
    let active = 0
    let peak = 0
    const jobs = gates.map((gate, index) => scheduler.run(`source-${index}`, async () => {
      active += 1
      peak = Math.max(peak, active)
      const value = await gate.promise
      active -= 1
      return value
    }))

    await flushScheduledWork()
    expect(active).toBe(2)
    gates[0].resolve(0)
    await jobs[0]
    await flushScheduledWork()
    await flushScheduledWork()
    expect(active).toBe(2)
    gates[1].resolve(1)
    gates[2].resolve(2)
    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2])
    expect(peak).toBe(2)
  })

  it('moves responsive sources ahead of unknown and slow sources on later resolves', async () => {
    let now = 0
    const scheduler = new SourceScheduler(1, () => now)
    await scheduler.run('fast', async () => { now += 100 })
    await scheduler.run('slow', async () => { now += 8_000 })

    const started: string[] = []
    const slow = scheduler.run('slow', async () => { started.push('slow') })
    const unknown = scheduler.run('unknown', async () => { started.push('unknown') })
    const fast = scheduler.run('fast', async () => { started.push('fast') })
    await Promise.all([slow, unknown, fast])

    expect(started).toEqual(['fast', 'unknown', 'slow'])
  })

  it('deprioritizes a source that failed without preventing a later retry', async () => {
    const scheduler = new SourceScheduler(1)
    await expect(scheduler.run('failed', async () => { throw new Error('no response') })).rejects.toThrow('no response')

    const started: string[] = []
    const failed = scheduler.run('failed', async () => { started.push('failed') })
    const unknown = scheduler.run('unknown', async () => { started.push('unknown') })
    await Promise.all([failed, unknown])

    expect(started).toEqual(['unknown', 'failed'])
  })

  it('uses a smaller fan-out on constrained devices', () => {
    expect(adaptiveSourceConcurrency(2)).toBe(2)
    expect(adaptiveSourceConcurrency(4)).toBe(2)
    expect(adaptiveSourceConcurrency(8)).toBe(3)
    expect(adaptiveSourceConcurrency(16)).toBe(4)
  })
})
