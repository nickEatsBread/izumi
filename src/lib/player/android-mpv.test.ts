import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

import {
  getChapterList, mpvLoad, mpvPreparationSnapshot, mpvState, mpvStop, prepareEmbeddedPlayer,
  seekRelative, startMpvEvents, waitForMpvFirstFrame,
} from './android-mpv'

const nativePlugin = readFileSync(fileURLToPath(new URL(
  '../../../src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt',
  import.meta.url,
)), 'utf8')

describe('Android mpv idle preparation', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue({ created: true, durationMs: 42 })
  })

  it('warms the native core without loading media and records only timing state', async () => {
    await expect(prepareEmbeddedPlayer()).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('plugin:mpv|mpv_prepare')
    expect(mocks.invoke).not.toHaveBeenCalledWith('plugin:mpv|mpv_load', expect.anything())
    expect(mpvPreparationSnapshot()).toEqual({ ready: true, created: true, durationMs: 42 })

    mocks.invoke.mockResolvedValue(undefined)
    await mpvStop()
    expect(mpvPreparationSnapshot().ready).toBe(false)
  })

  it('keeps idle preparation out of the Android view and immersive-mode path', () => {
    const core = nativePlugin.slice(
      nativePlugin.indexOf('private fun ensureCore()'),
      nativePlugin.indexOf('/** Attach the prepared core'),
    )
    const prepare = nativePlugin.slice(
      nativePlugin.indexOf('fun prepare(invoke: Invoke)'),
      nativePlugin.indexOf('// --- Picture-in-picture'),
    )
    expect(core).not.toContain('findViewById')
    expect(core).not.toContain('IzumiMpvView')
    expect(core).not.toContain('setImmersive')
    expect(prepare).toContain('ensureCore()')
    expect(prepare).not.toMatch(/\bensure\(\)/)
  })

  it('builds the idle core off the UI thread, under the lock a load and a teardown share', () => {
    // Tauri delivers commands on the main looper, so `runOnUiThread` in `prepare` ran the whole
    // libmpv initialization inline on the thread painting the browse page.
    const prepare = nativePlugin.slice(
      nativePlugin.indexOf('fun prepare(invoke: Invoke)'),
      nativePlugin.indexOf('private fun inspectionTrackType'),
    )
    expect(prepare).not.toContain('runOnUiThread')
    expect(prepare).toContain('Thread(')
    expect(nativePlugin).toContain('private fun ensureCore(): MPVLib = synchronized(coreLock)')
    const teardown = nativePlugin.slice(
      nativePlugin.indexOf('private fun teardownCore(invoke: Invoke)'),
      nativePlugin.indexOf('// --- MPVLib.EventObserver'),
    )
    expect(teardown).toContain('synchronized(coreLock)')
    expect(nativePlugin).toContain('setOptionString("keep-open", "yes")')
  })
})

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
      sid: '',
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

  it('restores the playhead when the native seek command is rejected', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('seek rejected'))

    await expect(seekRelative(10)).rejects.toThrow('seek rejected')
    expect(get(mpvState).pos).toBe(100)
    expect(get(mpvState).seekBusy).toBe(false)
    expect(get(mpvState).frameReady).toBe(true)
  })
})

describe('Android mpv pause intent across a load', () => {
  beforeAll(async () => {
    await startMpvEvents()
  })

  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('carries a paused Next through both optimistic resets', async () => {
    // Next pressed while paused: the core is already paused, so mpv emits no pause change for the
    // new file, and a reset to `paused: false` would stand forever.
    await mpvLoad({ url: 'https://host/next.mkv', autoplay: false })
    expect(get(mpvState).paused).toBe(true)
    mocks.event?.({ id: 6 })
    expect(get(mpvState).paused).toBe(true)
  })

  it('starts an autoplaying load as playing', async () => {
    await mpvLoad({ url: 'https://host/next.mkv', autoplay: true })
    expect(get(mpvState).paused).toBe(false)
    mocks.event?.({ id: 6 })
    expect(get(mpvState).paused).toBe(false)
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
      sid: '',
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

  it('resolves the startup gate only when playback restart presents a frame', async () => {
    mpvState.update((s) => ({ ...s, frameReady: false, buffering: true }))
    const firstFrame = waitForMpvFirstFrame(1_000)

    mocks.event?.({ id: 8 }) // FILE_LOADED is metadata, not a visible frame.
    expect(get(mpvState).frameReady).toBe(false)
    mocks.event?.({ id: 21 })

    await expect(firstFrame).resolves.toBe(true)
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
    mocks.event?.({ id: 21 })
    expect(get(mpvState)).toMatchObject({ pos: 0, dur: 0, eof: false, buffering: true })
    expect(get(mpvState).frameReady).toBe(false)

    // START_FILE hands event ownership to the replacement. Its own immediate failure must still
    // reach the recovery path, including sources that never update eof-reached.
    mocks.event?.({ id: 6 })
    mocks.progress?.({ property: 'duration', value: 1400 })
    mocks.event?.({ id: 7 })
    expect(get(mpvState)).toMatchObject({ dur: 1400, eof: true })
  })

  it('passes a native AC-4 hint without making it mandatory', async () => {
    await mpvLoad({ url: 'https://example.com/episode-ac4.mp4', preferNativeAudio: 'ac4' })

    expect(mocks.invoke).toHaveBeenCalledWith('plugin:mpv|mpv_load', {
      payload: expect.objectContaining({ preferNativeAudio: 'ac4' }),
    })
  })
})

describe('getChapterList', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
  })

  function mockChapterProps(props: Record<string, string>) {
    mocks.invoke.mockImplementation(async (_cmd: string, args?: unknown) => {
      const property = (args as { payload?: { property?: string } })?.payload?.property ?? ''
      return { value: props[property] ?? null }
    })
  }

  it('keeps a chapter that starts at exactly 0:00, matching the desktop chapter list', async () => {
    mockChapterProps({
      'chapter-list/count': '2',
      'chapter-list/0/time': '0',
      'chapter-list/0/title': 'Intro',
      'chapter-list/1/time': '85',
      'chapter-list/1/title': 'OP',
    })

    expect(await getChapterList()).toEqual([
      { time: 0, title: 'Intro' },
      { time: 85, title: 'OP' },
    ])
  })

  it('still drops genuinely invalid times (negative or non-finite)', async () => {
    mockChapterProps({
      'chapter-list/count': '3',
      'chapter-list/0/time': '-5',
      'chapter-list/0/title': 'Negative',
      'chapter-list/1/time': 'not-a-number',
      'chapter-list/1/title': 'Broken',
      'chapter-list/2/time': '0',
      'chapter-list/2/title': 'Intro',
    })

    expect(await getChapterList()).toEqual([{ time: 0, title: 'Intro' }])
  })
})

describe('Android player flavor probe', () => {
  // A fresh module per test: the probe cache and the core-failure flag are module state, and the
  // describes above already prepared a core on the shared instance.
  beforeEach(() => {
    vi.resetModules()
    mocks.invoke.mockReset()
  })

  it('keeps reporting the full flavor after the core fails to prepare', async () => {
    const mpv = await import('./android-mpv')
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'plugin:mpv|mpv_prepare') throw new Error('libmpv failed to initialize')
      return { value: null }
    })
    await expect(mpv.prepareEmbeddedPlayer()).resolves.toBe(false)
    expect(mpv.embeddedCoreFailed()).toBe(true)
    expect(get(mpv.androidPlayerPlugin)).toBeNull()
    await expect(mpv.hasEmbeddedPlayer()).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('plugin:mpv|mpv_get', { payload: { property: 'idle-active' } })
    expect(get(mpv.androidPlayerPlugin)).toBe(true)
  })

  it('reports the lite flavor when the plugin is not compiled in', async () => {
    const mpv = await import('./android-mpv')
    mocks.invoke.mockRejectedValue(new Error('plugin mpv not found'))
    await expect(mpv.hasEmbeddedPlayer()).resolves.toBe(false)
    expect(get(mpv.androidPlayerPlugin)).toBe(false)
  })

  it('asks the plugin once and publishes the cached answer on every call', async () => {
    const mpv = await import('./android-mpv')
    mocks.invoke.mockResolvedValue({ value: null })
    await mpv.hasEmbeddedPlayer()
    mpv.androidPlayerPlugin.set(null)
    await expect(mpv.hasEmbeddedPlayer()).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(get(mpv.androidPlayerPlugin)).toBe(true)
  })

  it('publishes the flavor from the cache when a successful prepare answered first', async () => {
    const mpv = await import('./android-mpv')
    mocks.invoke.mockResolvedValue({ created: true, durationMs: 7 })
    await expect(mpv.prepareEmbeddedPlayer()).resolves.toBe(true)
    expect(get(mpv.androidPlayerPlugin)).toBeNull()
    await expect(mpv.hasEmbeddedPlayer()).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(get(mpv.androidPlayerPlugin)).toBe(true)
  })

  it('clears the core failure once a later prepare succeeds, as routing always recovered', async () => {
    const mpv = await import('./android-mpv')
    mocks.invoke.mockRejectedValueOnce(new Error('transient'))
    await expect(mpv.prepareEmbeddedPlayer()).resolves.toBe(false)
    expect(mpv.embeddedCoreFailed()).toBe(true)
    mocks.invoke.mockResolvedValue({ created: true, durationMs: 7 })
    await expect(mpv.prepareEmbeddedPlayer()).resolves.toBe(true)
    expect(mpv.embeddedCoreFailed()).toBe(false)
  })

  it('routes a failed core to the external player and leaves the updater on the flavor probe', () => {
    const read = (relative: string) =>
      readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    const play = read('../stremio/play.ts')
    const updater = read('../updater/android.ts')
    expect(play).toContain('const androidEmbedded = android ? (await hasEmbeddedPlayer()) && !embeddedCoreFailed() : false')
    expect(updater).toContain("const suffix = (await hasEmbeddedPlayer()) ? 'full.apk' : 'lite.apk'")
    expect(updater).not.toContain('embeddedCoreFailed')
  })
})
