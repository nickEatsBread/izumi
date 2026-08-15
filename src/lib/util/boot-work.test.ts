import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BootWorkQueue } from './boot-work'

const original = globalThis.window

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as { window?: unknown }).window = {}
})

afterEach(() => {
  vi.useRealTimers()
  ;(globalThis as { window?: unknown }).window = original
})

describe('BootWorkQueue', () => {
  it('runs warmers one at a time', async () => {
    const queue = new BootWorkQueue()
    let release!: () => void
    const first = new Promise<void>((resolve) => { release = resolve })
    const seen: string[] = []
    queue.schedule('extensions', async () => { seen.push('extensions'); await first }, 100)
    queue.schedule('player', () => { seen.push('player') }, 200)

    await vi.advanceTimersByTimeAsync(500)
    expect(seen).toEqual(['extensions'])
    release()
    await vi.runAllTimersAsync()
    expect(seen).toEqual(['extensions', 'player'])
  })

  it('runs promoted user-needed work next without waiting for its boot delay', async () => {
    const queue = new BootWorkQueue()
    const seen: string[] = []
    queue.schedule('background', () => { seen.push('background') }, 5_000)
    queue.schedule('extensions', () => { seen.push('extensions') }, 6_000)
    queue.promote('extensions')

    await vi.runAllTimersAsync()
    expect(seen[0]).toBe('extensions')
  })
})
