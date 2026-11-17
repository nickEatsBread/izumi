import { describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

const { modules, moduleOnItsWay, modulePercent, moduleProgressText, refreshModules, waitForModule } = await import('./modules')

function status(overrides: Record<string, unknown> = {}) {
  return {
    id: 'widevine',
    name: 'Widevine',
    purpose: '',
    publisher: 'Google',
    approxBytes: 21_970_001,
    licence: '',
    needed: true,
    wanted: true,
    requestedBy: ['pack:a'],
    state: 'downloading' as const,
    received: 0,
    total: 0,
    version: null,
    error: null,
    ...overrides,
  }
}

describe('modules', () => {
  it('counts a module as on its way only when it is wanted, needed here and not ready', () => {
    expect(moduleOnItsWay(status())).toBe(true)
    expect(moduleOnItsWay(status({ state: 'failed' }))).toBe(true)
    expect(moduleOnItsWay(status({ state: 'ready', version: '4.10' }))).toBe(false)
    expect(moduleOnItsWay(status({ wanted: false }))).toBe(false)
    expect(moduleOnItsWay(status({ needed: false }))).toBe(false)
    expect(moduleOnItsWay(undefined)).toBe(false)
  })

  it('describes progress in plain words', () => {
    expect(moduleProgressText(status({ received: 1_048_576 * 5, total: 1_048_576 * 20 }))).toBe('5.0 of 20.0 MB')
    expect(modulePercent(status({ received: 5, total: 20 }))).toBe(25)
    expect(modulePercent(status({ state: 'installing' }))).toBe(100)
    expect(moduleProgressText(status({ state: 'failed', error: 'offline' }))).toBe('Download failed: offline')
    expect(moduleProgressText(status({ state: 'checking' }))).toBe('Starting download…')
  })

  it('waits until the module is ready, or until the wait is abandoned', async () => {
    invoke.mockResolvedValueOnce([status()])
    await refreshModules()
    const ready = waitForModule('widevine')
    modules.update((all) => ({ ...all, widevine: { ...all.widevine, state: 'ready', version: '4.10' } }))
    await expect(ready).resolves.toBe(true)

    modules.update((all) => ({ ...all, widevine: { ...all.widevine, state: 'downloading' } }))
    const abort = new AbortController()
    const abandoned = waitForModule('widevine', abort.signal)
    abort.abort()
    await expect(abandoned).resolves.toBe(false)
    expect(get(modules).widevine.state).toBe('downloading')
  })
})
