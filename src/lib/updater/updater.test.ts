import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Tauri + Android layers so the facade logic is tested in isolation.
const h = vi.hoisted(() => ({
  isAndroid: false, isPackaged: true, flatpak: false, gameMode: false,
  // Registered Tauri event handlers, so a test can fire a progress payload at the facade.
  handlers: new Map<string, (e: unknown) => void>(),
}))
vi.mock('$lib/platform', () => ({ isAndroid: { subscribe: (f: any) => (f(h.isAndroid), () => {}) } }))
// Only `gameMode` is used from the session module; stub it so the Game-mode branch is drivable.
vi.mock('$lib/player/session', () => ({ gameMode: { subscribe: (f: any) => (f(h.gameMode), () => {}) } }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string) => {
  if (cmd === 'is_flatpak') return h.flatpak
  if (cmd === 'updater_check') return { version: '0.2.0', current: '0.1.3', notes: 'x', date: null }
  return null
}) }))
// The opener plugin isn't part of the facade logic under test; stub it so the flatpak branch's
// release-page redirect doesn't reach the real (browser-only) implementation in the node env.
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => {}) }))
// Download progress arrives on Tauri events (listenSafe). Record the handlers so tests can emit.
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (e: unknown) => void) => {
    h.handlers.set(name, cb)
    return () => h.handlers.delete(name)
  }),
}))

import { pickTarget, type UpdateTarget } from './index'

// Reset shared mock state before EVERY test in the file — the later top-level it() blocks live
// outside the describe, so a describe-scoped beforeEach wouldn't isolate them (order-independence).
beforeEach(() => { h.isAndroid = false; h.flatpak = false; h.gameMode = false; h.handlers.clear() })

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

import { applyUpdate, updateError, updateProgress } from './index'

it('applyUpdate on desktop calls updater_install then reaches ready', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  availableUpdate.set({ version: '0.2.0', notes: '', target: 'desktop' })
  await applyUpdate()
  expect(invoke).toHaveBeenCalledWith('updater_install', { channel: expect.anything() })
  // desktop restarts itself in-process; phase advances through downloading
  expect(['downloading', 'ready']).toContain(get(updatePhase))
})
// The desktop Rust callback used to drop every chunk, so the toast bar sat at 0% for the whole
// download. It now emits `update-download-progress`; the facade has to map that onto the stores.
it('applyUpdate maps download progress onto the progress stores', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  const { updateBytes } = await import('./index')
  // Hold updater_install open so the listener is still live while progress is emitted.
  let release: () => void = () => {}
  ;(invoke as any).mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
  availableUpdate.set({ version: '0.2.0', notes: '', target: 'desktop' })
  updatePhase.set('idle')
  const done = applyUpdate()
  await Promise.resolve() // let listenSafe register

  const fire = (downloaded: number, total: number | null) =>
    h.handlers.get('update-download-progress')?.({ payload: { downloaded, total } })

  fire(512, 2048)
  expect(get(updateProgress)).toBe(0.25)
  expect(get(updateBytes)).toBe(512)
  // No Content-Length -> indeterminate (fraction stays 0) but the byte counter still moves.
  fire(4096, null)
  expect(get(updateProgress)).toBe(0)
  expect(get(updateBytes)).toBe(4096)

  release()
  await done
  expect(get(updateProgress)).toBe(1)
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

// The portal refusing is the common Steam Deck case (bundle install with no update origin, or no
// portal backend). In Game mode there is no browser to send the user to — opening one is exactly
// the reported bug — so the failure has to stay in-app.
it('applyUpdate on flatpak surfaces the reason in Game mode instead of opening a browser', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  ;(openUrl as any).mockClear()
  ;(invoke as any).mockImplementationOnce(async () => { throw new Error('the portal refused the update') })
  h.gameMode = true
  availableUpdate.set({ version: '0.2.0', notes: '', target: 'flatpak' })
  updatePhase.set('idle'); updateError.set('')
  await applyUpdate()
  expect(openUrl).not.toHaveBeenCalled()
  expect(get(updatePhase)).toBe('error')
  expect(get(updateError)).toContain('the portal refused the update')
  expect(get(updateError)).toContain('flatpak update com.nicho.izumi')
})

it('applyUpdate on flatpak still falls back to the release page outside Game mode', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  ;(openUrl as any).mockClear()
  ;(invoke as any).mockImplementationOnce(async () => { throw new Error('nope') })
  h.gameMode = false
  availableUpdate.set({ version: '0.2.0', notes: '', target: 'flatpak' })
  updatePhase.set('idle'); updateError.set('')
  await applyUpdate()
  expect(openUrl).toHaveBeenCalled()
  expect(get(updatePhase)).toBe('idle')
})

// append to updater.test.ts — fake timers drive the schedule
it('startUpdateChecks runs an initial check after the delay', async () => {
  vi.useFakeTimers()
  const { startUpdateChecks } = await import('./index')
  availableUpdate.set(null); updatePhase.set('idle')
  const stop = startUpdateChecks()
  await vi.advanceTimersByTimeAsync(5001)
  expect(get(updatePhase)).toBe('available')
  stop(); vi.useRealTimers()
})
