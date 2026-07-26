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
    mpvState.set({
      pos: 100,
      dur: 1000,
      paused: false,
      eof: false,
      buffering: false,
      seeking: false,
      coreIdle: false,
      seekBusy: false,
      cacheEnd: 0,
    })
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

describe('Android mpv loading signals', () => {
  beforeAll(async () => {
    await startMpvEvents()
  })

  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
    mpvState.set({
      pos: 100,
      dur: 1000,
      paused: false,
      eof: false,
      buffering: false,
      seeking: false,
      coreIdle: false,
      seekBusy: false,
      cacheEnd: 0,
    })
  })

  it('marks a seek busy immediately and releases it when the position lands', async () => {
    await seekRelative(30)
    expect(get(mpvState).seekBusy).toBe(true)

    // A stale event from before the seek must not release it.
    mocks.progress?.({ property: 'time-pos', value: 100 })
    expect(get(mpvState).seekBusy).toBe(true)

    mocks.progress?.({ property: 'time-pos', value: 130 })
    expect(get(mpvState).seekBusy).toBe(false)
    expect(get(mpvState).pos).toBe(130)
  })

  it('tracks seeking and core-idle so a stall outside paused-for-cache is still visible', () => {
    mocks.progress?.({ property: 'seeking', value: true })
    mocks.progress?.({ property: 'core-idle', value: true })
    expect(get(mpvState).seeking).toBe(true)
    expect(get(mpvState).coreIdle).toBe(true)
    expect(get(mpvState).buffering).toBe(false) // mpv never sets paused-for-cache for a seek

    mocks.progress?.({ property: 'seeking', value: false })
    mocks.progress?.({ property: 'core-idle', value: false })
    expect(get(mpvState).seeking).toBe(false)
    expect(get(mpvState).coreIdle).toBe(false)
  })
})
