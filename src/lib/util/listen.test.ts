import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listenSafe } from './listen'

// Controllable stand-in for Tauri's async listen(): each call parks until the test
// resolves it, mirroring the real IPC round-trip that makes early teardown racy.
const h = vi.hoisted(() => ({
  pending: [] as { cb: (e: unknown) => void; resolve: (u: () => void) => void }[],
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_evt: string, cb: (e: unknown) => void) =>
    new Promise<() => void>((resolve) => { h.pending.push({ cb, resolve }) }),
}))

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('listenSafe', () => {
  beforeEach(() => { h.pending.length = 0 })

  it('unsubscribes on arrival when cleaned up before registration resolves', async () => {
    const un = vi.fn()
    const cleanup = listenSafe('evt', () => {})
    cleanup() // owner unmounted while listen() was still in flight
    h.pending[0].resolve(un)
    await flush()
    expect(un).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes immediately when cleaned up after registration', async () => {
    const un = vi.fn()
    const cleanup = listenSafe('evt', () => {})
    h.pending[0].resolve(un)
    await flush()
    cleanup()
    expect(un).toHaveBeenCalledTimes(1)
  })

  it('delivers events to the handler while active', async () => {
    const got: unknown[] = []
    listenSafe('evt', (e) => got.push(e))
    h.pending[0].resolve(vi.fn())
    await flush()
    h.pending[0].cb({ payload: 1 })
    expect(got).toEqual([{ payload: 1 }])
  })
})
