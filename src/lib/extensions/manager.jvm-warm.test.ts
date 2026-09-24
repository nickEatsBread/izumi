import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('$lib/settings/ui', () => ({
  enabledExtensionUrls: writable<string[]>([]),
  disabledPlugins: writable<string[]>([]),
}))
vi.mock('$lib/stremio/online-cache', () => ({ clearProviderCache: vi.fn() }))

const installed = {
  id: 'eu.kanade.one',
  name: 'Example',
  version: '1',
  backend: 'aniyomi-jvm' as const,
  sourceId: '101',
  sourceIds: ['101'],
  signed: true,
}

const source = {
  id: '101',
  name: 'Example',
  type: 'anime' as const,
  pkgName: installed.id,
  iconUrl: 'data:image/png;base64,icon',
}

beforeEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  mocks.invoke.mockReset()
})

describe('JVM boot warming', () => {
  it('starts installed JVM packages during the ordinary extension warm', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'extension_list') return [installed]
      if (command === 'jvm_extension_sources') return [source]
      throw new Error(`Unexpected command: ${command}`)
    })

    const { warmExtensions } = await import('./manager')
    await warmExtensions()

    expect(mocks.invoke).toHaveBeenCalledWith('jvm_extension_sources')
  })

  it('keeps a slow initialization warming after the UI deadline', async () => {
    vi.useFakeTimers()
    let finish!: (sources: typeof source[]) => void
    const slowSources = new Promise<typeof source[]>((resolve) => { finish = resolve })
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'extension_list') return [installed]
      if (command === 'jvm_extension_sources') return slowSources
      throw new Error(`Unexpected command: ${command}`)
    })

    const { jvmExtensionIcons, warmExtensions } = await import('./manager')
    const warm = warmExtensions()
    await vi.advanceTimersByTimeAsync(15_000)
    await warm

    finish([source])
    await vi.advanceTimersByTimeAsync(0)
    expect(await jvmExtensionIcons()).toEqual(new Map([[installed.id, source.iconUrl]]))
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'jvm_extension_sources')).toHaveLength(1)
  })
})

describe('JVM cold start on the play path', () => {
  it('waits past the browse deadline for a runtime that is still starting', async () => {
    vi.useFakeTimers()
    let finish!: (sources: typeof source[]) => void
    const slowSources = new Promise<typeof source[]>((resolve) => { finish = resolve })
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'extension_list') return [installed]
      if (command === 'jvm_extension_sources') return slowSources
      throw new Error(`Unexpected command: ${command}`)
    })

    const { runningStreamExtensions, jvmRuntimeColdStartPending } = await import('./manager')
    const { jvmRuntimeState, JVM_SOURCES_PLAY_DEADLINE_MS } = await import('./jvm-runtime-state')
    const { get } = await import('svelte/store')
    expect(await jvmRuntimeColdStartPending()).toBe(true)
    const providers = runningStreamExtensions(undefined, { jvmDeadlineMs: JVM_SOURCES_PLAY_DEADLINE_MS })
    // The old 15s browse deadline used to turn this into a silent [] — "no sources" — while the
    // enumeration kept going and made the SECOND play work.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(get(jvmRuntimeState)).toBe('starting')
    finish([source])
    await vi.advanceTimersByTimeAsync(0)
    const resolved = await providers
    expect(resolved.map((p) => p.id)).toEqual(['101'])
    expect(get(jvmRuntimeState)).toBe('ready')
    expect(await jvmRuntimeColdStartPending()).toBe(false)
  })

  it('reports a runtime that never answered so the picker can name the cause', async () => {
    vi.useFakeTimers()
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'extension_list') return [installed]
      if (command === 'jvm_extension_sources') return new Promise<never>(() => {})
      throw new Error(`Unexpected command: ${command}`)
    })

    const { runningStreamExtensions } = await import('./manager')
    const { jvmRuntimeState } = await import('./jvm-runtime-state')
    const { get } = await import('svelte/store')
    const providers = runningStreamExtensions(undefined, { jvmDeadlineMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await providers).toEqual([])
    expect(get(jvmRuntimeState)).toBe('starting')
  })
})
