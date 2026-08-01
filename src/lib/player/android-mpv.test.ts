import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  progress: undefined as ((event: unknown) => void) | undefined,
  event: undefined as ((event: unknown) => void) | undefined,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  addPluginListener: vi.fn(async (_plugin: string, event: string, listener: (event: unknown) => void) => {
    if (event === 'progress') mocks.progress = listener
    if (event === 'event') mocks.event = listener
    return { unregister: vi.fn() }
  }),
}))

import { mpvLoad, mpvState, seekRelative, startMpvEvents } from './android-mpv'

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
      frameReady: true,
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
      frameReady: true,
      cacheEnd: 0,
    })
  })

  it('marks a seek busy immediately and releases it when the position lands', async () => {
    await seekRelative(30)
    expect(get(mpvState).seekBusy).toBe(true)
    expect(get(mpvState).frameReady).toBe(false)

    // A stale event from before the seek must not release it.
    mocks.progress?.({ property: 'time-pos', value: 100 })
    expect(get(mpvState).seekBusy).toBe(true)

    mocks.progress?.({ property: 'time-pos', value: 130 })
    expect(get(mpvState).seekBusy).toBe(false)
    expect(get(mpvState).pos).toBe(130)
    expect(get(mpvState).frameReady).toBe(false)

    mocks.event?.({ id: 21 })
    expect(get(mpvState).frameReady).toBe(true)
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

  it('uses playback restart as the definitive first-frame/loading boundary', () => {
    mpvState.update((s) => ({ ...s, frameReady: false, buffering: true }))

    // Metadata and clock updates can precede the first decoded frame.
    mocks.progress?.({ property: 'duration', value: 1000 })
    mocks.progress?.({ property: 'time-pos', value: 100 })
    mocks.progress?.({ property: 'paused-for-cache', value: false })
    expect(get(mpvState).frameReady).toBe(false)
    expect(get(mpvState).buffering).toBe(false)

    mocks.event?.({ id: 21 })
    expect(get(mpvState).frameReady).toBe(true)
    expect(get(mpvState).buffering).toBe(false)

    mocks.event?.({ id: 20 })
    expect(get(mpvState).frameReady).toBe(false)
  })

  // FILE_LOADED used to narrow the direct-torrent file selection to the sidecars. It no longer
  // touches the engine at all: a torrent whose selected pieces are all present is "finished" and
  // sheds its seeders, which starved playback whenever mpv was between HTTP requests.
  it('does not call into the native player when FILE_LOADED arrives', () => {
    mocks.event?.({ id: 8 })

    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('treats END_FILE as EOF when the observed property never changes', () => {
    mpvState.update((s) => ({ ...s, eof: false, pos: 0, dur: 0 }))

    mocks.event?.({ id: 7 })

    expect(get(mpvState).eof).toBe(true)
  })

  it('ignores the outgoing file tail while replacing it with the next episode', async () => {
    await mpvLoad({ url: 'https://example.com/episode-2.mkv' })

    // `loadfile` is accepted before libmpv drains the old file's final observations/events.
    mocks.progress?.({ property: 'duration', value: 1000 })
    mocks.progress?.({ property: 'eof-reached', value: true })
    mocks.event?.({ id: 7 })
    expect(get(mpvState)).toMatchObject({ pos: 0, dur: 0, eof: false, buffering: true })

    // START_FILE hands event ownership to the replacement. Its own immediate failure must still
    // reach the recovery path, including sources that never update eof-reached.
    mocks.event?.({ id: 6 })
    mocks.progress?.({ property: 'duration', value: 1400 })
    mocks.event?.({ id: 7 })
    expect(get(mpvState)).toMatchObject({ dur: 1400, eof: true })
  })
})
