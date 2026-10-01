import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  os: 'windows' as string,
  invoke: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => mocks.os }))
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke: mocks.invoke,
}))

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

/** Fresh instances: platform.ts (nativeAndroid) and android-mpv.ts (the probe cache) keep module state. */
async function load() {
  const platform = await import('$lib/platform')
  const mpv = await import('./android-mpv')
  const gate = await import('./in-app-player')
  return { platform, mpv, gate }
}

beforeEach(() => {
  vi.resetModules()
  mocks.os = 'windows'
  mocks.invoke.mockReset()
})

describe('inAppPlayerAvailable', () => {
  it('counts every desktop build as the in-app player', async () => {
    const { platform, mpv, gate } = await load()
    platform.isAndroid.set(false)
    expect(get(gate.inAppPlayerAvailable)).toBe(true)
    mpv.androidPlayerPlugin.set(false)
    expect(get(gate.inAppPlayerAvailable)).toBe(true)
  })

  it('on Android, shows in-app rows only once the plugin probe has answered yes', async () => {
    const { platform, mpv, gate } = await load()
    platform.isAndroid.set(true)
    expect(get(mpv.androidPlayerPlugin)).toBeNull()
    expect(get(gate.inAppPlayerAvailable)).toBe(false)
    mpv.androidPlayerPlugin.set(false)
    expect(get(gate.inAppPlayerAvailable)).toBe(false)
    mpv.androidPlayerPlugin.set(true)
    expect(get(gate.inAppPlayerAvailable)).toBe(true)
  })

  it('treats the desktop preview of the Android UI as the full build', async () => {
    const { platform, gate } = await load()
    platform.isAndroid.set(true)
    platform.androidUiPreview.set(true)
    expect(get(gate.inAppPlayerAvailable)).toBe(true)
  })
})

describe('probeInAppPlayer', () => {
  it('does nothing off native Android', async () => {
    const { platform, mpv, gate } = await load()
    platform.initPlatform()
    expect(platform.isNativeAndroid()).toBe(false)
    await gate.probeInAppPlayer()
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(get(mpv.androidPlayerPlugin)).toBeNull()
  })

  it('records the full build on a native Android device', async () => {
    mocks.os = 'android'
    mocks.invoke.mockResolvedValue({ value: null })
    const { platform, mpv, gate } = await load()
    expect(platform.isNativeAndroid()).toBe(false)
    platform.initPlatform()
    expect(platform.isNativeAndroid()).toBe(true)
    expect(get(gate.inAppPlayerAvailable)).toBe(false)
    await gate.probeInAppPlayer()
    expect(mocks.invoke).toHaveBeenCalledWith('plugin:mpv|mpv_get', { payload: { property: 'idle-active' } })
    expect(get(mpv.androidPlayerPlugin)).toBe(true)
    expect(get(gate.inAppPlayerAvailable)).toBe(true)
  })

  it('records the lite build when the plugin is not compiled in', async () => {
    mocks.os = 'android'
    mocks.invoke.mockRejectedValue(new Error('plugin mpv not found'))
    const { platform, mpv, gate } = await load()
    platform.initPlatform()
    await gate.probeInAppPlayer()
    expect(get(mpv.androidPlayerPlugin)).toBe(false)
    expect(get(gate.inAppPlayerAvailable)).toBe(false)
  })

  it('keeps the full-build rows after the core fails to prepare', async () => {
    mocks.os = 'android'
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'plugin:mpv|mpv_prepare') throw new Error('libmpv failed to initialize')
      return { value: null }
    })
    const { platform, mpv, gate } = await load()
    platform.initPlatform()
    await mpv.prepareEmbeddedPlayer()
    await gate.probeInAppPlayer()
    expect(mpv.embeddedCoreFailed()).toBe(true)
    expect(get(gate.inAppPlayerAvailable)).toBe(true)
  })
})

describe('boot probe wiring', () => {
  it('probes right after the platform is resolved in the app layout', () => {
    const layout = read('../../routes/app/+layout.svelte')
    expect(layout).toContain("import { probeInAppPlayer } from '$lib/player/in-app-player'")
    expect(layout).toContain([
      '    initPlatform() // resolve isAndroid/isMobile FIRST — playback + nav branch on it',
      '    void probeInAppPlayer() // Android full vs lite build: gates the in-app rows of Player settings',
    ].join('\n'))
    expect(layout.split('probeInAppPlayer()').length - 1).toBe(1)
  })
})
