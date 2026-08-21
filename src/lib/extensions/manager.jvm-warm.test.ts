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
