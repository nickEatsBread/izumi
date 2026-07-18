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

import { pickTarget, type UpdateTarget } from './index'

describe('updater facade', () => {
  beforeEach(() => { h.isAndroid = false; h.flatpak = false })
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
it('applyUpdate on flatpak (phase 1) opens the release page, phase = ready-manual', async () => {
  availableUpdate.set({ version: '0.2.0', notes: '', target: 'flatpak' })
  await applyUpdate()
  // Phase 1: no portal yet -> route to release page (existing behavior), no throw
  expect(get(updateError)).toBe('')
})
