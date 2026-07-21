import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  progress: undefined as ((event: unknown) => void) | undefined,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  addPluginListener: vi.fn(async (_plugin: string, event: string, listener: (event: unknown) => void) => {
    if (event === 'progress') mocks.progress = listener
    return { unregister: vi.fn() }
  }),
}))

import { mpvState, seekRelative, startMpvEvents } from './android-mpv'

describe('Android mpv seek coordination', () => {
  beforeAll(async () => {
    await startMpvEvents()
  })

  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
    mpvState.set({ pos: 100, dur: 1000, paused: false, eof: false, buffering: false, cacheEnd: 0 })
  })

  it('does not let a stale time event undo a queued seek', async () => {
    await seekRelative(10)
    expect(get(mpvState).pos).toBe(110)

    mocks.progress?.({ property: 'time-pos', value: 100 })
    expect(get(mpvState).pos).toBe(110)

    mocks.progress?.({ property: 'time-pos', value: 110 })
    expect(get(mpvState).pos).toBe(110)
  })

  it('bases rapid repeated seeks on the latest optimistic target', async () => {
    await seekRelative(10)
    await seekRelative(10)
    expect(get(mpvState).pos).toBe(120)

    mocks.progress?.({ property: 'time-pos', value: 110 })
    expect(get(mpvState).pos).toBe(120)

    mocks.progress?.({ property: 'time-pos', value: 120 })
    expect(get(mpvState).pos).toBe(120)
  })
})
