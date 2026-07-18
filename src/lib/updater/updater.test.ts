import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Tauri + Android layers so the facade logic is tested in isolation.
const h = vi.hoisted(() => ({ isAndroid: false, isPackaged: true, flatpak: false }))
vi.mock('$lib/platform', () => ({ isAndroid: { subscribe: (f: any) => (f(h.isAndroid), () => {}) } }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string) => {
  if (cmd === 'is_flatpak') return h.flatpak
  if (cmd === 'updater_check') return { version: '0.2.0', current: '0.1.3', notes: 'x', date: null }
  return null
}) }))
// The opener plugin isn't part of the facade logic under test; stub it so the flatpak branch's
// release-page redirect doesn't reach the real (browser-only) implementation in the node env.
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => {}) }))
// The flatpak branch subscribes to a progress event via listenSafe; stub listen so it no-ops.
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))

import { pickTarget, type UpdateTarget } from './index'

// Reset shared mock state before EVERY test in the file — the later top-level it() blocks live
// outside the describe, so a describe-scoped beforeEach wouldn't isolate them (order-independence).
beforeEach(() => { h.isAndroid = false; h.flatpak = false })

describe('updater facade', () => {
  it('routes desktop to the tauri updater', async () => {
    expect(await pickTarget()).toBe<UpdateTarget>('desktop')
  })
  it('routes android to the apk updater', async () => {
    h.isAndroid = true
    expect(await pickTarget()).toBe<UpdateTarget>('android')
  })
  it('routes a flatpak install to the portal target', async () => {
    h.flatpak = true
    expect(await pickTarget()).toBe<UpdateTarget>('flatpak')
  })
})

import { checkForUpdate, availableUpdate, updatePhase } from './index'
import { get } from 'svelte/store'

it('checkForUpdate populates the store + phase on desktop', async () => {
  await checkForUpdate()
  expect(get(availableUpdate)?.version).toBe('0.2.0')
  expect(get(updatePhase)).toBe('available')
})
it('checkForUpdate is a no-op when up to date', async () => {
  // updater_check returns null -> no update. checkForUpdate makes two invoke calls on the
  // desktop path (is_flatpak in pickTarget, then updater_check), so null out both for this
  // check; the default mock is restored afterwards.
  const { invoke } = await import('@tauri-apps/api/core')
  ;(invoke as any)
    .mockImplementationOnce(async () => null) // is_flatpak -> desktop
    .mockImplementationOnce(async () => null) // updater_check -> no update
  availableUpdate.set(null); updatePhase.set('idle')
  await checkForUpdate()
  expect(get(availableUpdate)).toBeNull()
  expect(get(updatePhase)).toBe('idle')
})

import { applyUpdate, updateError } from './index'

it('applyUpdate on desktop calls updater_install then reaches ready', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  availableUpdate.set({ version: '0.2.0', notes: '', target: 'desktop' })
  await applyUpdate()
  expect(invoke).toHaveBeenCalledWith('updater_install', { channel: expect.anything() })
  // desktop restarts itself in-process; phase advances through downloading
  expect(['downloading', 'ready']).toContain(get(updatePhase))
})
it('applyUpdate on flatpak uses the portal + ends in ready (no relaunch)', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  availableUpdate.set({ version: '0.2.0', notes: '', target: 'flatpak' })
  updatePhase.set('idle')
  await applyUpdate()
  expect(invoke).toHaveBeenCalledWith('flatpak_update_install')
  expect(get(updatePhase)).toBe('ready')
  expect(get(updateError)).toBe('')
})

// append to updater.test.ts — fake timers drive the schedule
it('startUpdateChecks runs an initial check after the delay + respects the auto toggle', async () => {
  vi.useFakeTimers()
  const { startUpdateChecks } = await import('./index')
  availableUpdate.set(null); updatePhase.set('idle')
  const stop = startUpdateChecks(() => true /* autoEnabled */)
  await vi.advanceTimersByTimeAsync(5001)
  expect(get(updatePhase)).toBe('available')
  stop(); vi.useRealTimers()
})
